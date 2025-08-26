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
    uint256 constant SIZE = 100e18;              // positionSize = 100 units of underlying
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

        // Deploy impls & book (constructor takes both impls)
        linearImpl  = new LinearFiniteFutures();
        powerImpl   = new PowerFiniteFutures();
        futuresBook = new FuturesBook(address(linearImpl), address(powerImpl));

        // --- Sanity: the book must be wired to both impls ---
        assertEq(futuresBook.futuresImpl(), address(linearImpl), "book linear impl mismatch");
        assertEq(futuresBook.powerFuturesImpl(), address(powerImpl), "book power impl mismatch");
    }

    // ======================== POWER: EXERCISE MATRIX ========================

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
        // |3-1|^3 = 8, size=100 → payout = 800
        _runExerciseScenarioPower(true, 1e18, 3e18, 3);
    }

    // ======================== POWER: RECLAIM (no exercise) ========================

    function testPowerFutures_Reclaim_LongMaker() public {
        _runReclaimScenarioPower({makerIsLong: true,  desiredStrike: 2e18, power: POWER});
    }

    function testPowerFutures_Reclaim_ShortMaker() public {
        _runReclaimScenarioPower({makerIsLong: false, desiredStrike: 4e18, power: POWER});
    }

    // ======================== LINEAR: PAYOFF CHECKS ========================

    function testLinearFutures_Exercise_Basics() public {
        // Long-maker, strike 2, resolve 5 → payout = (5-2)*100 = 300
        _runExerciseScenarioLinear(true, 2e18, 5e18);

        // Short-maker, strike 4, resolve 1 → payout = (4-1)*100 = 300 (to short)
        _runExerciseScenarioLinear(false, 4e18, 1e18);

        // Tie
        _runExerciseScenarioLinear(true, 2e18, 2e18);
    }

    // ======================== INTERNAL HELPERS (POWER) ========================

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
            SIZE,            // positionSize
            0,               // premiumMustBe0
            address(oracle), // oracle
            strikeNotional,  // strikeNotional
            makerIsLong,     // makerIsLong
            EXPIRY_SECONDS,  // expirySeconds
            power            // payoff power
        );

        PowerFiniteFutures inst = PowerFiniteFutures(fut);

        // --- Instance wiring checks BEFORE activation ---
        assertEq(inst.futuresBook(), address(futuresBook), "instance.futuresBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertFalse(inst.isActive(), "instance should not be active yet");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("POWER_FINITE_FUTURES")), "wrong instance type");
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

        // Refund amount (maker funds strike if makerIsLong)
        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        // Set expiry price and jump past expiry
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        // SimuOracle expects integer prices; resolvedPrice is 1e18 scaled → divide by 1e18
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

        // Use signed deltas so we can compare directly, accounting for refund
        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        bool longWins = resolvedPrice > entryStrike;
        int256 expectedLongDelta  = (longWins ? int256(expectedPayout) : -int256(expectedPayout)) + int256(refundAmount);
        int256 expectedShortDelta = (longWins ? -int256(expectedPayout) :  int256(expectedPayout));

        // Assertions (net deltas)
        assertEq(longDelta,  expectedLongDelta,  "LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "SHORT net delta mismatch");

        // Conservation between LONG & SHORT: total changes by refundAmount (refund comes from the instance)
        assertEq(
            longAfter + shortAfter,
            longBefore + shortBefore + refundAmount,
            "MTK conservation between LONG and SHORT (+refund) failed"
        );

        // Maker's funded asset must be refunded on exercise (nothing trapped in instance)
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
        assertEq(inst.futuresBook(), address(futuresBook), "instance.futuresBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertEq(inst.payoffPower(), power, "payoffPower not set on instance");
        assertEq(inst.strikePrice(), desiredStrike, "strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("POWER_FINITE_FUTURES")), "wrong instance type");

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

        // Short (current short) reclaims
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

    // ======================== INTERNAL HELPERS (LINEAR) ========================

    function _runExerciseScenarioLinear(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18
        uint256 resolvedPrice    // 1e18
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

        // Create as maker (linear path)
        vm.prank(maker);
        address fut = futuresBook.createAndFundLinearFuture(
            address(twoTK),
            address(mtk),
            "2TK",
            "MTK",
            SIZE,
            0,
            address(oracle),
            strikeNotional,
            makerIsLong,
            EXPIRY_SECONDS
        );

        LinearFiniteFutures inst = LinearFiniteFutures(fut);

        // Pre-activation sanity
        assertEq(inst.futuresBook(), address(futuresBook), "instance.futuresBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertFalse(inst.isActive(), "instance should not be active yet");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("LINEAR_FINITE_FUTURES")), "wrong instance type");

        // Strike must be fixed from funding
        uint256 entryStrike = inst.strikePrice();
        assertEq(entryStrike, desiredStrike, "strike should equal desiredStrike");

        // Enter as taker
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        // Roles
        address finalLong  = inst.long();
        address finalShort = inst.short();

        // Refund amount if maker was long (funded in strike)
        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        // Move time and set oracle price
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        oracle.setPrice(address(twoTK), "2TK", resolvedPrice / 1e18);

        // Approvals for settlement
        vm.startPrank(maker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();

        // Snapshot balances
        uint256 longBefore  = mtk.balanceOf(finalLong);
        uint256 shortBefore = mtk.balanceOf(finalShort);

        // Exercise (as long)
        vm.prank(finalLong);
        futuresBook.resolveAndExercise(fut, 0);

        // Post balances
        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        // Expected linear payout
        uint256 diff = resolvedPrice > entryStrike ? (resolvedPrice - entryStrike) : (entryStrike - resolvedPrice); // 1e18
        uint256 expectedPayout = (diff * SIZE) / 1e18;

        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        bool longWins = resolvedPrice > entryStrike;
        int256 expectedLongDelta  = (longWins ? int256(expectedPayout) : -int256(expectedPayout)) + int256(refundAmount);
        int256 expectedShortDelta = (longWins ? -int256(expectedPayout) :  int256(expectedPayout));

        assertEq(longDelta,  expectedLongDelta,  "Linear: LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "Linear: SHORT net delta mismatch");

        // No tokens trapped
        if (makerIsLong) {
            assertEq(mtk.balanceOf(fut), 0, "Linear: strike funding should be refunded");
        } else {
            assertEq(twoTK.balanceOf(fut), 0, "Linear: underlying funding should be refunded");
        }
    }
}

// Simple ERC20 for mocking
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
