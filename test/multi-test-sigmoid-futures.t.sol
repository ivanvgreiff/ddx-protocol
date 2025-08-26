// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../contracts/FuturesBook.sol";
import "../contracts/LinearFiniteFutures.sol";
import "../contracts/PowerFiniteFutures.sol";
import "../contracts/SigmoidFiniteFutures.sol";
import "../contracts/SimuOracle.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// PRBMath (for expected-value checks of sigmoid payoff)
import { SD59x18, sd } from "@prb/math/src/SD59x18.sol";
import { exp } from "@prb/math/src/sd59x18/Math.sol";

contract PowerFuturesTest is Test {
    FuturesBook public futuresBook;
    LinearFiniteFutures public linearImpl;
    PowerFiniteFutures public powerImpl;
    SigmoidFiniteFutures public sigmoidImpl;
    SimuOracle public oracle;

    MockERC20 public twoTK; // underlying (2TK)
    MockERC20 public mtk;   // strike (MTK)

    address public maker = address(0x1);
    address public taker = address(0x2);

    // Common knobs
    uint256 constant SIZE = 100e18;              // positionSize = 100 units of underlying
    uint256 constant EXPIRY_SECONDS = 5 minutes; // maker-chosen expiry
    uint8   constant POWER = 2;                  // test a quadratic payoff
    uint256 constant INTENSITY = 1e18;           // I = 1.0 (1e18-scaled) for sigmoid tests

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

        // Deploy impls & book (constructor takes three impls now)
        linearImpl   = new LinearFiniteFutures();
        powerImpl    = new PowerFiniteFutures();
        sigmoidImpl  = new SigmoidFiniteFutures();
        futuresBook  = new FuturesBook(address(linearImpl), address(powerImpl), address(sigmoidImpl));

        // --- Sanity: the book must be wired to all impls ---
        assertEq(futuresBook.futuresImpl(), address(linearImpl), "book linear impl mismatch");
        assertEq(futuresBook.powerFuturesImpl(), address(powerImpl), "book power impl mismatch");
        assertEq(futuresBook.sigmoidFuturesImpl(), address(sigmoidImpl), "book sigmoid impl mismatch");
    }

    // ======================== SIGMOID: EXERCISE MATRIX ========================

    function testSigmoidFutures_Exercise_Matrix() public {
        bool[2] memory makerIsLongArray = [true, false];

        // expiry prices to test (1e18 scaled)
        uint256[4] memory expiryPrices = [
            uint256(1e18),
            uint256(2e18),
            uint256(3e18),
            uint256(4e18)
        ];

        // choose a desired strike to encode via funding
        uint256 desiredStrike = 3e18;

        for (uint256 i = 0; i < makerIsLongArray.length; i++) {
            for (uint256 j = 0; j < expiryPrices.length; j++) {
                _runExerciseScenarioSigmoid(makerIsLongArray[i], desiredStrike, expiryPrices[j], INTENSITY);
            }
        }
    }

    // ======================== SIGMOID: RECLAIM (no exercise) ========================

    function testSigmoidFutures_Reclaim_LongMaker() public {
        _runReclaimScenarioSigmoid({makerIsLong: true,  desiredStrike: 2e18, intensity1e18: INTENSITY});
    }

    function testSigmoidFutures_Reclaim_ShortMaker() public {
        _runReclaimScenarioSigmoid({makerIsLong: false, desiredStrike: 4e18, intensity1e18: INTENSITY});
    }

    // ======================== POWER: EXERCISE MATRIX (unchanged) ========================
    function testPowerFutures_Exercise_Matrix() public {
        bool[2] memory makerIsLongArray = [true, false];
        uint256[4] memory expiryPrices = [uint256(1e18), uint256(2e18), uint256(3e18), uint256(4e18)];
        uint256 desiredStrike = 3e18;

        for (uint256 i = 0; i < makerIsLongArray.length; i++) {
            for (uint256 j = 0; j < expiryPrices.length; j++) {
                _runExerciseScenarioPower(makerIsLongArray[i], desiredStrike, expiryPrices[j], POWER);
            }
        }
    }

    function testPowerFutures_Exercise_Cubic() public {
        _runExerciseScenarioPower(true, 1e18, 3e18, 3);
    }

    function testPowerFutures_Reclaim_LongMaker() public {
        _runReclaimScenarioPower({makerIsLong: true,  desiredStrike: 2e18, power: POWER});
    }

    function testPowerFutures_Reclaim_ShortMaker() public {
        _runReclaimScenarioPower({makerIsLong: false, desiredStrike: 4e18, power: POWER});
    }

    // ======================== LINEAR: PAYOFF CHECKS (unchanged) ========================
    function testLinearFutures_Exercise_Basics() public {
        _runExerciseScenarioLinear(true, 2e18, 5e18);
        _runExerciseScenarioLinear(false, 4e18, 1e18);
        _runExerciseScenarioLinear(true, 2e18, 2e18);
    }

    // ======================== INTERNAL HELPERS (SIGMOID) ========================

    function _runExerciseScenarioSigmoid(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18
        uint256 resolvedPrice,   // 1e18
        uint256 intensity1e18    // 1e18
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

        // --- Create as MAKER (SIGMOID path) ---
        vm.prank(maker);
        address fut = futuresBook.createAndFundSigmoidFuture(
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
            intensity1e18
        );

        SigmoidFiniteFutures inst = SigmoidFiniteFutures(fut);

        // Wiring checks BEFORE activation
        assertEq(inst.futuresBook(), address(futuresBook), "sigmoid: futuresBook not set");
        assertTrue(inst.isFunded(), "sigmoid: should be funded");
        assertFalse(inst.isActive(), "sigmoid: should not be active yet");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("SIGMOID_FINITE_FUTURES")), "wrong instance type");

        // Strike fixed from funding
        uint256 entryStrike = inst.strikePrice();
        assertEq(entryStrike, desiredStrike, "sigmoid: strike should equal desiredStrike");

        // Metadata (optional sanity)
        FuturesBook.FuturesMeta memory metaBefore = futuresBook.getFuturesMeta(fut);
        assertEq(keccak256(bytes(metaBefore.payoffType)), keccak256(bytes("SigmoidFiniteFutures")), "book payoffType mismatch");
        assertEq(metaBefore.strikePrice, desiredStrike, "book strike not cached correctly");

        // --- Taker enters (no premium) ---
        uint256 tsBeforeEnter = block.timestamp;
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        assertTrue(inst.isActive(), "sigmoid: instance should be active");
        assertEq(inst.expiry(), tsBeforeEnter + EXPIRY_SECONDS, "sigmoid: bad expiry");

        address finalLong  = inst.long();
        address finalShort = inst.short();
        assertTrue(finalLong != address(0) && finalShort != address(0), "sigmoid: roles not assigned");

        // Refund amount (maker funds strike if makerIsLong)
        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        // Set expiry price and jump past expiry
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
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

        // Exercise (as long)
        vm.prank(finalLong);
        futuresBook.resolveAndExercise(fut, 0);

        // After settle: ensure oracle price was used
        uint256 priceAtExpiry = inst.priceAtExpiry();
        assertEq(priceAtExpiry, resolvedPrice, "sigmoid: oracle mismatch");

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        // ===== Expected payout (sigmoid) =====
        uint256 notional = strikeNotional; // = desiredStrike * SIZE / 1e18
        // z = I*(S-K)  (signed 1e18)
        int256 z = _mulWadSigned(int256(intensity1e18), int256(resolvedPrice) - int256(entryStrike));
        // s = 1 / (1 + exp(-z))
        uint256 s = _sigmoidWad(z);
        uint256 half = 5e17;
        uint256 delta = s >= half ? (s - half) : (half - s);
        uint256 expectedPayout = (delta * 2 * notional) / 1e18;

        // Deltas
        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        bool longWins = resolvedPrice > entryStrike;
        int256 expectedLongDelta  = (longWins ? int256(expectedPayout) : -int256(expectedPayout)) + int256(refundAmount);
        int256 expectedShortDelta = (longWins ? -int256(expectedPayout) :  int256(expectedPayout));

        assertEq(longDelta,  expectedLongDelta,  "SIGMOID: LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "SIGMOID: SHORT net delta mismatch");

        // Conservation between LONG & SHORT: total changes by refundAmount (refund comes from the instance)
        assertEq(
            longAfter + shortAfter,
            longBefore + shortBefore + refundAmount,
            "SIGMOID: MTK conservation (+refund) failed"
        );

        // Maker's funded asset must be refunded on exercise
        if (makerIsLong) {
            assertEq(mtk.balanceOf(fut), 0, "SIGMOID: strike funding should be refunded");
        } else {
            assertEq(twoTK.balanceOf(fut), 0, "SIGMOID: underlying funding should be refunded");
        }
    }

    function _runReclaimScenarioSigmoid(
        bool makerIsLong,
        uint256 desiredStrike, // 1e18
        uint256 intensity1e18  // 1e18
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

        // Create as maker (sigmoid path)
        vm.prank(maker);
        address fut = futuresBook.createAndFundSigmoidFuture(
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
            intensity1e18
        );

        SigmoidFiniteFutures inst = SigmoidFiniteFutures(fut);

        // Instance wiring BEFORE activation
        assertEq(inst.futuresBook(), address(futuresBook), "sigmoid: futuresBook not set");
        assertTrue(inst.isFunded(), "sigmoid: should be funded");
        assertEq(inst.strikePrice(), desiredStrike, "sigmoid: strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("SIGMOID_FINITE_FUTURES")), "wrong instance type");

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
            assertGt(makerStrikeAfter, makerStrikeBefore, "sigmoid: maker strike should be refunded");
            assertEq(mtk.balanceOf(fut), 0, "sigmoid: no strike left in instance");
        } else {
            uint256 makerUnderAfter = twoTK.balanceOf(maker);
            assertGt(makerUnderAfter, makerUnderBefore, "sigmoid: maker underlying should be refunded");
            assertEq(twoTK.balanceOf(fut), 0, "sigmoid: no underlying left in instance");
        }
    }

    // ======================== INTERNAL HELPERS (POWER) ========================
    function _runExerciseScenarioPower(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18 scaled
        uint256 resolvedPrice,   // 1e18 scaled
        uint8 power
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(futuresBook), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(futuresBook), SIZE);
            vm.stopPrank();
        }

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

        assertEq(inst.futuresBook(), address(futuresBook), "instance.futuresBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertFalse(inst.isActive(), "instance should not be active yet");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("POWER_FINITE_FUTURES")), "wrong instance type");
        assertEq(inst.payoffPower(), power, "payoffPower not set on instance");

        uint256 entryStrike = inst.strikePrice();
        assertEq(entryStrike, desiredStrike, "strike should equal desiredStrike");

        FuturesBook.FuturesMeta memory metaBefore = futuresBook.getFuturesMeta(fut);
        assertEq(metaBefore.payoffPower, power, "book payoffPower mismatch");
        assertEq(keccak256(bytes(metaBefore.payoffType)), keccak256(bytes("PowerFiniteFutures")), "book payoffType mismatch");
        assertEq(metaBefore.strikePrice, desiredStrike, "book strike not cached correctly");

        uint256 tsBeforeEnter = block.timestamp;
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        assertTrue(inst.isActive(), "instance should be active");
        assertEq(inst.expiry(), tsBeforeEnter + EXPIRY_SECONDS, "bad expiry");

        address finalLong  = inst.long();
        address finalShort = inst.short();

        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        oracle.setPrice(address(twoTK), "2TK", resolvedPrice / 1e18);

        vm.startPrank(maker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();

        uint256 longBefore  = mtk.balanceOf(finalLong);
        uint256 shortBefore = mtk.balanceOf(finalShort);

        vm.prank(finalLong);
        futuresBook.resolveAndExercise(fut, 0);

        uint256 priceAtExpiry = inst.priceAtExpiry();
        assertEq(priceAtExpiry, resolvedPrice, "priceAtExpiry != resolvedPrice (oracle mismatch)");

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        uint256 diff = resolvedPrice > entryStrike ? (resolvedPrice - entryStrike) : (entryStrike - resolvedPrice); // 1e18
        uint256 poweredDiff = _pow1e18(diff, power); // 1e18
        uint256 expectedPayout = (poweredDiff * SIZE) / 1e18;

        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        bool longWins = resolvedPrice > entryStrike;
        int256 expectedLongDelta  = (longWins ? int256(expectedPayout) : -int256(expectedPayout)) + int256(refundAmount);
        int256 expectedShortDelta = (longWins ? -int256(expectedPayout) :  int256(expectedPayout));

        assertEq(longDelta,  expectedLongDelta,  "LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "SHORT net delta mismatch");

        assertEq(
            longAfter + shortAfter,
            longBefore + shortBefore + refundAmount,
            "MTK conservation between LONG and SHORT (+refund) failed"
        );

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

        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(futuresBook), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(futuresBook), SIZE);
            vm.stopPrank();
        }

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

        assertEq(inst.futuresBook(), address(futuresBook), "instance.futuresBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertEq(inst.payoffPower(), power, "payoffPower not set on instance");
        assertEq(inst.strikePrice(), desiredStrike, "strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("POWER_FINITE_FUTURES")), "wrong instance type");

        FuturesBook.FuturesMeta memory metaBefore = futuresBook.getFuturesMeta(fut);
        assertEq(metaBefore.payoffPower, power, "book payoffPower mismatch");
        assertEq(keccak256(bytes(metaBefore.payoffType)), keccak256(bytes("PowerFiniteFutures")), "book payoffType mismatch");
        assertEq(metaBefore.strikePrice, desiredStrike, "book strike not cached correctly");

        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        address finalShort = inst.short();

        uint256 makerStrikeBefore = mtk.balanceOf(maker);
        uint256 makerUnderBefore  = twoTK.balanceOf(maker);

        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);

        vm.prank(finalShort);
        futuresBook.resolveAndReclaim(fut);

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

    // ===== shared helpers for sigmoid expected value =====

    // a * b / 1e18, signed
    function _mulWadSigned(int256 a, int256 b) internal pure returns (int256) {
        return (a * b) / int256(1e18);
    }

    // PRBMath-based sigmoid in 1e18 wad
    function _sigmoidWad(int256 zWad) internal pure returns (uint256) {
        SD59x18 eneg = exp(sd(-zWad));     // e^{-z}
        SD59x18 one = sd(1e18);
        SD59x18 s = one / (one + eneg);    // 1 / (1 + e^{-z})
        return uint256(SD59x18.unwrap(s)); // 0..1e18
    }

    // ======================== INTERNAL HELPERS (LINEAR) ========================
    function _runExerciseScenarioLinear(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18
        uint256 resolvedPrice    // 1e18
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(futuresBook), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(futuresBook), SIZE);
            vm.stopPrank();
        }

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

        assertEq(inst.futuresBook(), address(futuresBook), "instance.futuresBook not set to book");
        assertTrue(inst.isFunded(), "instance should be funded");
        assertFalse(inst.isActive(), "instance should not be active yet");
        assertEq(keccak256(bytes(inst.futureType())), keccak256(bytes("LINEAR_FINITE_FUTURES")), "wrong instance type");

        uint256 entryStrike = inst.strikePrice();
        assertEq(entryStrike, desiredStrike, "strike should equal desiredStrike");

        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        address finalLong  = inst.long();
        address finalShort = inst.short();

        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        oracle.setPrice(address(twoTK), "2TK", resolvedPrice / 1e18);

        vm.startPrank(maker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        mtk.approve(address(futuresBook), type(uint256).max);
        vm.stopPrank();

        uint256 longBefore  = mtk.balanceOf(finalLong);
        uint256 shortBefore = mtk.balanceOf(finalShort);

        vm.prank(finalLong);
        futuresBook.resolveAndExercise(fut, 0);

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        uint256 diff = resolvedPrice > entryStrike ? (resolvedPrice - entryStrike) : (entryStrike - resolvedPrice); // 1e18
        uint256 expectedPayout = (diff * SIZE) / 1e18;

        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        bool longWins = resolvedPrice > entryStrike;
        int256 expectedLongDelta  = (longWins ? int256(expectedPayout) : -int256(expectedPayout)) + int256(refundAmount);
        int256 expectedShortDelta = (longWins ? -int256(expectedPayout) :  int256(expectedPayout));

        assertEq(longDelta,  expectedLongDelta,  "Linear: LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "Linear: SHORT net delta mismatch");

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
