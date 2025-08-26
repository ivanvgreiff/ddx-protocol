// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../contracts/FuturesBook.sol";
import "../contracts/LinearFiniteFutures.sol";
import "../contracts/PowerFiniteFutures.sol";
import "../contracts/SimuOracle.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PowerFuturesTest is Test {
    FuturesBook public futuresBook;
    LinearFiniteFutures public linearImpl;
    PowerFiniteFutures public powerImpl;
    SimuOracle public oracle;

    MockERC20 public twoTK; // underlying (2TK)
    MockERC20 public mtk;   // strike (MTK)

    address public maker = address(0x1);
    address public taker = address(0x2);

    // Common knobs
    uint256 constant SIZE = 100e18;              // optionSize = 100 units of underlying
    uint256 constant EXPIRY_SECONDS = 5 minutes; // maker-chosen expiry
    uint8   constant POWER = 2;                  // test a quadratic payoff

    function setUp() public {
        // Deploy tokens and mint balances
        twoTK = new MockERC20("TwoToken", "2TK");
        mtk   = new MockERC20("MoneyToken", "MTK");

        // Mint balances to test actors
        twoTK.mint(maker, 10_000e18);
        mtk.mint(maker,   20_000e18);
        mtk.mint(taker,   20_000e18);
        twoTK.mint(taker, 20_000e18);

        // Simple oracle: price(2TK)=2, price(MTK)=1 → derived(2TK/MTK) = 2e18
        oracle = new SimuOracle();
        oracle.setPrice(address(twoTK), "2TK", 2);
        oracle.setPrice(address(mtk),   "MTK", 1);

        // Deploy impls & book (note the constructor takes both impls)
        linearImpl  = new LinearFiniteFutures();
        powerImpl   = new PowerFiniteFutures();
        futuresBook = new FuturesBook(address(linearImpl), address(powerImpl));

        // --- Sanity: the book must be wired to both impls ---
        assertEq(futuresBook.futuresImpl(), address(linearImpl), "book linear impl mismatch");
        assertEq(futuresBook.powerFuturesImpl(), address(powerImpl), "book power impl mismatch");
    }

    // ======================== MATRIX (exercise) ========================

    function testPowerFutures_Exercise_Matrix() public {
        bool[2] memory makerIsLongArray = [true, false];

        // expiry prices to test (1e18 scaled, in underlying/strike terms)
        uint256[4] memory expiryPrices = [
            uint256(1e18),
            uint256(2e18),
            uint256(3e18),
            uint256(4e18)
        ];

        // choose a desired strike to encode via funding
        uint256 desiredStrike = 3e18; // 3 strike tokens per unit underlying

        for (uint256 i = 0; i < makerIsLongArray.length; i++) {
            for (uint256 j = 0; j < expiryPrices.length; j++) {
                _runExerciseScenarioPower(makerIsLongArray[i], desiredStrike, expiryPrices[j], POWER);
            }
        }
    }

    // Sanity check for different powers
    function testPowerFutures_Exercise_Cubic() public {
        _runExerciseScenarioPower(true, 1e18, 3e18, 3); // |3-1|^3 = 8, size=100 → payout = 800
    }

    // ======================== RECLAIM (no exercise) ========================

    function testPowerFutures_Reclaim_LongMaker() public {
        _runReclaimScenarioPower({makerIsLong: true,  desiredStrike: 2e18, power: POWER});
    }

    function testPowerFutures_Reclaim_ShortMaker() public {
        _runReclaimScenarioPower({makerIsLong: false, desiredStrike: 4e18, power: POWER});
    }

    // ======================== INTERNAL HELPERS ========================

    function _runExerciseScenarioPower(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18 scaled
        uint256 resolvedPrice,   // 1e18 scaled
        uint8 power
    ) internal {
        // Compute maker strike notional to fund the fixed strike:
        // strikeNotional = desiredStrike * SIZE / 1e18
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Approvals for maker funding (depends on which asset the maker must deposit)
        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(futuresBook), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(futuresBook), SIZE);
            vm.stopPrank();
        }

        // --- Create as MAKER (POWER path) ---
        vm.prank(maker);
        address fut = futuresBook.createAndFundPowerFuture(
            address(twoTK),
            address(mtk),
            "2TK",
            "MTK",
            SIZE,            // _optionSize
            0,               // _premiumMustBe0
            address(oracle), // _oracle
            strikeNotional,  // _strikeNotional
            makerIsLong,     // _makerIsLong
            EXPIRY_SECONDS,  // _expirySeconds
            power            // _power
        );

        PowerFiniteFutures inst = PowerFiniteFutures(fut);

        // --- Instance wiring checks BEFORE activation ---
        assertEq(inst.optionsBook(), address(futuresBook), "instance.optionsBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertFalse(inst.isActive(), "instance should not be active yet");

        // Must be the POWER instance, not linear
        string memory optType = inst.optionType();
        assertEq(keccak256(bytes(optType)), keccak256(bytes("POWER_FINITE_FUTURES")), "wrong instance type");

        // Power should be set as requested
        assertEq(inst.payoffPower(), power, "payoffPower not set on instance");

        // Strike must be fixed from funding
        uint256 entryStrike = inst.strikePrice();
        assertEq(entryStrike, desiredStrike, "strike should equal desiredStrike");

        // Book metadata must reflect power + strike now (Option A caching)
        FuturesBook.FuturesMeta memory metaBefore = futuresBook.getFuturesMeta(fut);
        assertEq(metaBefore.payoffPower, power, "book payoffPower mismatch");
        assertEq(keccak256(bytes(metaBefore.payoffType)), keccak256(bytes("PowerFiniteFutures")), "book payoffType mismatch");
        assertEq(metaBefore.strikePrice, desiredStrike, "book strike not cached correctly");

        // --- Taker enters (no premium) ---
        uint256 tsBeforeEnter = block.timestamp;
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        // Check activation state & expiry
        assertTrue(inst.isActive(), "instance should be active");
        assertEq(inst.expiry(), tsBeforeEnter + EXPIRY_SECONDS, "bad expiry");

        // Whose long/short after activation?
        address finalLong  = inst.long();
        address finalShort = inst.short();
        assertTrue(finalLong != address(0) && finalShort != address(0), "roles not assigned");

        // Set expiry price and jump past expiry
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        // SimuOracle expects integer ratios; resolvedPrice is 1e18 scaled → divide by 1e18
        oracle.setPrice(address(twoTK), "2TK", resolvedPrice / 1e18);

        // Both parties approve the book to pull strike for settlement
        vm.startPrank(maker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();

        // Snapshot balances
        uint256 longBefore  = mtk.balanceOf(finalLong);
        uint256 shortBefore = mtk.balanceOf(finalShort);

        // Anyone can trigger settle; call as long
        vm.prank(finalLong);
        futuresBook.resolveAndExercise(fut, 0);

        // After settle: check resolved price matches our target
        uint256 priceAtExpiry = inst.priceAtExpiry();
        assertEq(priceAtExpiry, resolvedPrice, "priceAtExpiry != resolvedPrice (oracle mismatch)");

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        // Expected absolute payout in strike token with power payoff
        uint256 diff = resolvedPrice > entryStrike ? (resolvedPrice - entryStrike) : (entryStrike - resolvedPrice); // 1e18
        uint256 poweredDiff = _pow1e18(diff, power); // 1e18
        uint256 expectedPayout = (poweredDiff * SIZE) / 1e18;

        // Emit handy debug numbers (visible only on failure)
        emit log_named_uint("resolvedPrice", resolvedPrice);
        emit log_named_uint("entryStrike", entryStrike);
        emit log_named_uint("diff", diff);
        emit log_named_uint("poweredDiff", poweredDiff);
        emit log_named_uint("expectedPayout", expectedPayout);
        emit log_named_uint("longDelta", longAfter - longBefore);
        emit log_named_uint("shortDeltaAbs", shortBefore - shortAfter);

        // Long wins if price >= strike; else short wins
        bool longWins = resolvedPrice >= entryStrike;
        if (expectedPayout == 0) {
            assertEq(longAfter - longBefore, 0, "no payout expected");
            assertEq(shortBefore - shortAfter, 0, "no payout expected");
        } else if (longWins) {
            assertEq(longAfter - longBefore, expectedPayout, "long should gain payout");
            assertEq(shortBefore - shortAfter, expectedPayout, "short should pay payout");
        } else {
            assertEq(shortAfter - shortBefore, expectedPayout, "short should gain payout");
            assertEq(longBefore - longAfter, expectedPayout, "long should pay payout");
        }

        // Zero-sum between the two parties in strike token
        assertEq(
            longAfter + shortAfter,
            longBefore + shortBefore,
            "MTK not conserved between LONG and SHORT"
        );

        // Maker's funded asset must be refunded on exercise (nothing trapped)
        if (makerIsLong) {
            assertEq(mtk.balanceOf(fut), 0, "strike funding should be refunded");
        } else {
            assertEq(twoTK.balanceOf(fut), 0, "underlying funding should be refunded");
        }
    }

    function _runReclaimScenarioPower(
        bool makerIsLong,
        uint256 desiredStrike, // 1e18 scaled
        uint8 power
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Maker funding approvals
        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(futuresBook), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(futuresBook), SIZE);
            vm.stopPrank();
        }

        // Create as maker (power path)
        vm.prank(maker);
        address fut = futuresBook.createAndFundPowerFuture(
            address(twoTK),
            address(mtk),
            "2TK",
            "MTK",
            SIZE,
            0,
            address(oracle),
            strikeNotional,
            makerIsLong,
            EXPIRY_SECONDS,
            power
        );

        PowerFiniteFutures inst = PowerFiniteFutures(fut);

        // Instance wiring checks BEFORE activation
        assertEq(inst.optionsBook(), address(futuresBook), "instance.optionsBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertEq(inst.payoffPower(), power, "payoffPower not set on instance");
        assertEq(inst.strikePrice(), desiredStrike, "strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.optionType())), keccak256(bytes("POWER_FINITE_FUTURES")), "wrong instance type");

        // Book metadata must reflect power + strike now
        FuturesBook.FuturesMeta memory metaBefore = futuresBook.getFuturesMeta(fut);
        assertEq(metaBefore.payoffPower, power, "book payoffPower mismatch");
        assertEq(keccak256(bytes(metaBefore.payoffType)), keccak256(bytes("PowerFiniteFutures")), "book payoffType mismatch");
        assertEq(metaBefore.strikePrice, desiredStrike, "book strike not cached correctly");

        // Counterparty enters (activates with expiry)
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        address finalShort = inst.short();

        // Record maker funding balances before reclaim
        uint256 makerStrikeBefore = mtk.balanceOf(maker);
        uint256 makerUnderBefore  = twoTK.balanceOf(maker);

        // Jump past expiry (no resolve/exercise)
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);

        // Short (maker or taker depending on side) reclaims
        vm.prank(finalShort);
        futuresBook.resolveAndReclaim(fut);

        // Maker funding should be refunded
        if (makerIsLong) {
            uint256 makerStrikeAfter = mtk.balanceOf(maker);
            assertGt(makerStrikeAfter, makerStrikeBefore, "maker strike should be refunded");
            assertEq(mtk.balanceOf(fut), 0, "no strike left in instance");
        } else {
            uint256 makerUnderAfter = twoTK.balanceOf(maker);
            assertGt(makerUnderAfter, makerUnderBefore, "maker underlying should be refunded");
            assertEq(twoTK.balanceOf(fut), 0, "no underlying left in instance");
        }
    }

    // ===== math helper mirrors contract scaling: x^n / 1e18^(n-1) =====
    function _pow1e18(uint256 x, uint8 n) internal pure returns (uint256) {
        if (n == 1) return x;
        uint256 z = x;
        for (uint8 i = 1; i < n; i++) {
            z = (z * x) / 1e18;
        }
        return z;
    }
}

// Simple ERC20 for mocking
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
