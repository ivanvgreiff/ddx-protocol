// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../contracts/GenieBook.sol";
import "../contracts/SinusoidalGenie.sol";
import "../contracts/hPolynomialGenie.sol";
import "../contracts/SimuOracle.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GenieGeniesTest is Test {
    GenieBook public book;
    SinusoidalGenie public sinusoidalImpl;
    PolynomialGenie public polynomialImpl;
    SimuOracle public oracle;

    MockERC20 public twoTK; // underlying (2TK)
    MockERC20 public mtk;   // strike (MTK)

    address public maker = address(0x1);
    address public taker = address(0x2);

    // Common knobs
    uint256 constant SIZE = 100e18;              // positionSize = 100 units of underlying
    uint256 constant EXPIRY_SECONDS = 5 minutes; // maker-chosen expiry

    // Sinusoidal params
    uint256 constant AMP_1E18    = 1e18; // 100% amplitude
    uint256 constant PERIOD_1E18 = 1e18; // arbitrary default "price units" period
    // Polynomial param
    uint256 constant FULLPAYLINE_1E18 = 1e18; // L = 1.0 (wad)

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

        // Deploy impls & book
        sinusoidalImpl = new SinusoidalGenie();
        polynomialImpl = new PolynomialGenie();
        book = new GenieBook(address(sinusoidalImpl), address(polynomialImpl));
    }

    // ======================== SINUSOIDAL: EXERCISE MATRIX ========================

    function testSinusoidalGenie_Exercise_Matrix() public {
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
                _runExerciseScenarioSinusoidal(
                    makerIsLongArray[i],
                    desiredStrike,
                    expiryPrices[j],
                    AMP_1E18,
                    PERIOD_1E18
                );
            }
        }
    }

    // ======================== SINUSOIDAL: RECLAIM (no exercise) ========================

    function testSinusoidalGenie_Reclaim_LongMaker() public {
        _runReclaimScenarioSinusoidal({
            makerIsLong: true,
            desiredStrike: 2e18,
            amplitude1e18: AMP_1E18,
            period1e18: PERIOD_1E18
        });
    }

    function testSinusoidalGenie_Reclaim_ShortMaker() public {
        _runReclaimScenarioSinusoidal({
            makerIsLong: false,
            desiredStrike: 4e18,
            amplitude1e18: AMP_1E18,
            period1e18: PERIOD_1E18
        });
    }

    // ======================== POLYNOMIAL: EXERCISE MATRIX ========================

    function testPolynomialGenie_Exercise_Matrix() public {
        bool[2] memory makerIsLongArray = [true, false];

        // test around K with several outcomes
        uint256[5] memory expiryPrices = [
            uint256(1e18),
            uint256(2e18),
            uint256(3e18),
            uint256(4e18),
            uint256(5e18)
        ];

        uint256 desiredStrike = 3e18;

        for (uint256 i = 0; i < makerIsLongArray.length; i++) {
            for (uint256 j = 0; j < expiryPrices.length; j++) {
                _runExerciseScenarioPolynomial(
                    makerIsLongArray[i],
                    desiredStrike,
                    expiryPrices[j],
                    FULLPAYLINE_1E18
                );
            }
        }
    }

    // ======================== POLYNOMIAL: RECLAIM (no exercise) ========================

    function testPolynomialGenie_Reclaim_LongMaker() public {
        _runReclaimScenarioPolynomial({
            makerIsLong: true,
            desiredStrike: 2e18,
            fullPayLine1e18: FULLPAYLINE_1E18
        });
    }

    function testPolynomialGenie_Reclaim_ShortMaker() public {
        _runReclaimScenarioPolynomial({
            makerIsLong: false,
            desiredStrike: 4e18,
            fullPayLine1e18: FULLPAYLINE_1E18
        });
    }

    // ======================== INTERNAL HELPERS (SINUSOIDAL) ========================

    function _runExerciseScenarioSinusoidal(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18
        uint256 resolvedPrice,   // 1e18
        uint256 amplitude1e18,   // 1e18 = 100%
        uint256 period1e18       // 1e18
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Maker funding approvals
        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(book), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(book), SIZE);
            vm.stopPrank();
        }

        // --- Create as MAKER (Sinusoidal path) ---
        vm.prank(maker);
        address g = book.createAndFundSinusoidalGenie(
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
            amplitude1e18,
            period1e18
        );

        SinusoidalGenie inst = SinusoidalGenie(g);

        // Wiring checks BEFORE activation
        assertTrue(inst.isFunded(), "sin: should be funded");
        assertFalse(inst.isActive(), "sin: should not be active yet");
        assertEq(inst.strikePrice(), desiredStrike, "sin: strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.contractType())), keccak256(bytes("SINUSOIDAL_GENIE")), "wrong instance type");

        // --- Taker enters (no premium) ---
        uint256 tsBeforeEnter = block.timestamp;
        vm.prank(taker);
        book.enterAndPayPremium(g, 0);

        assertTrue(inst.isActive(), "sin: instance should be active");
        assertEq(inst.expiry(), tsBeforeEnter + EXPIRY_SECONDS, "sin: bad expiry");

        address finalLong  = inst.long();
        address finalShort = inst.short();
        assertTrue(finalLong != address(0) && finalShort != address(0), "sin: roles not assigned");

        // Refund amount (maker funds strike if makerIsLong)
        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        // Set expiry price and jump past expiry
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        oracle.setPrice(address(twoTK), "2TK", resolvedPrice / 1e18);

        // Both parties approve the book to pull strike for settlement
        vm.startPrank(maker);
        mtk.approve(address(book), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        mtk.approve(address(book), type(uint256).max);
        vm.stopPrank();

        // Snapshot balances
        uint256 longBefore  = mtk.balanceOf(finalLong);
        uint256 shortBefore = mtk.balanceOf(finalShort);

        // Exercise (as long)
        vm.prank(finalLong);
        book.resolveAndExercise(g, 0);

        // After settle: ensure oracle price was used
        uint256 priceAtExpiry = inst.priceAtExpiry();
        assertEq(priceAtExpiry, resolvedPrice, "sin: oracle mismatch");

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        // ===== Expected payout (sinusoidal) with NET SETTLEMENT =====
        uint256 notional = strikeNotional; // = desiredStrike * SIZE / 1e18

        int256 diff = int256(resolvedPrice) - int256(desiredStrike);
        int256 angle = ((diff * TWO_PI) / int256(period1e18)); // phaseShift=0 in test
        int256 angleNorm = _normalizeAngle(angle);

        int256 sinVal = _sinWad(angleNorm);             // [-1e18, +1e18]
        int256 scaled = (sinVal * int256(amplitude1e18)) / int256(1e18); // [-A, +A]
        // ratio = (1 + scaled)/2 clamped to [0,1]
        int256 ratio1e18 = (scaled + int256(1e18)) / 2;
        if (ratio1e18 < 0) ratio1e18 = 0;
        if (ratio1e18 > int256(1e18)) ratio1e18 = int256(1e18);

        uint256 longPayout = (uint256(ratio1e18) * notional) / 1e18;
        uint256 shortPayout = notional - longPayout;

        // Net movement
        int256 net = int256(longPayout) - int256(shortPayout); // >0 -> Long receives; <0 -> Long pays

        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        // Add maker refund effect (strike refund if maker was long)
        int256 expectedLongDelta  = net + int256(refundAmount);
        int256 expectedShortDelta = -net;

        assertEq(longDelta,  expectedLongDelta,  "SIN: LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "SIN: SHORT net delta mismatch");

        // Conservation between LONG & SHORT: total changes by refundAmount (refund comes from the instance)
        assertEq(
            longAfter + shortAfter,
            longBefore + shortBefore + refundAmount,
            "SIN: MTK conservation (+refund) failed"
        );

        // Maker's funded asset must be refunded on exercise
        if (makerIsLong) {
            assertEq(mtk.balanceOf(g), 0, "SIN: strike funding should be refunded");
        } else {
            assertEq(twoTK.balanceOf(g), 0, "SIN: underlying funding should be refunded");
        }
    }

    function _runReclaimScenarioSinusoidal(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18
        uint256 amplitude1e18,   // 1e18
        uint256 period1e18       // 1e18
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Maker funding approvals
        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(book), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(book), SIZE);
            vm.stopPrank();
        }

        // Create as maker (sinusoidal path)
        vm.prank(maker);
        address g = book.createAndFundSinusoidalGenie(
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
            amplitude1e18,
            period1e18
        );

        SinusoidalGenie inst = SinusoidalGenie(g);

        // Instance wiring BEFORE activation
        assertTrue(inst.isFunded(), "sin: should be funded");
        assertEq(inst.strikePrice(), desiredStrike, "sin: strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.contractType())), keccak256(bytes("SINUSOIDAL_GENIE")), "wrong instance type");

        // Counterparty enters (activates with expiry)
        vm.prank(taker);
        book.enterAndPayPremium(g, 0);

        address finalShort = inst.short();

        // Record maker funding balances before reclaim
        uint256 makerStrikeBefore = mtk.balanceOf(maker);
        uint256 makerUnderBefore  = twoTK.balanceOf(maker);

        // Jump past expiry (no resolve/exercise)
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);

        // Short (current short) reclaims
        vm.prank(finalShort);
        book.resolveAndReclaim(g);

        // Maker funding should be refunded
        if (makerIsLong) {
            uint256 makerStrikeAfter = mtk.balanceOf(maker);
            assertGt(makerStrikeAfter, makerStrikeBefore, "sin: maker strike should be refunded");
            assertEq(mtk.balanceOf(g), 0, "sin: no strike left in instance");
        } else {
            uint256 makerUnderAfter = twoTK.balanceOf(maker);
            assertGt(makerUnderAfter, makerUnderBefore, "sin: maker underlying should be refunded");
            assertEq(twoTK.balanceOf(g), 0, "sin: no underlying left in instance");
        }
    }

    // ======================== INTERNAL HELPERS (POLYNOMIAL) ========================

    function _runExerciseScenarioPolynomial(
        bool makerIsLong,
        uint256 desiredStrike,     // 1e18
        uint256 resolvedPrice,     // 1e18
        uint256 fullPayLine1e18    // L
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Maker funding approvals
        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(book), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(book), SIZE);
            vm.stopPrank();
        }

        // --- Create as MAKER (Polynomial path) ---
        vm.prank(maker);
        address g = book.createAndFundPolynomialGenie(
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
            fullPayLine1e18
        );

        PolynomialGenie inst = PolynomialGenie(g);

        // Wiring checks BEFORE activation
        assertTrue(inst.isFunded(), "poly: should be funded");
        assertFalse(inst.isActive(), "poly: should not be active yet");
        assertEq(inst.strikePrice(), desiredStrike, "poly: strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.contractType())), keccak256(bytes("POLYNOMIAL_GENIE")), "wrong instance type");

        // --- Taker enters (no premium) ---
        uint256 tsBeforeEnter = block.timestamp;
        vm.prank(taker);
        book.enterAndPayPremium(g, 0);

        assertTrue(inst.isActive(), "poly: instance should be active");
        assertEq(inst.expiry(), tsBeforeEnter + EXPIRY_SECONDS, "poly: bad expiry");

        address finalLong  = inst.long();
        address finalShort = inst.short();
        assertTrue(finalLong != address(0) && finalShort != address(0), "poly: roles not assigned");

        // Refund amount (maker funds strike if makerIsLong)
        bool refundToLong = makerIsLong && (finalLong == maker);
        uint256 refundAmount = refundToLong ? strikeNotional : 0;

        // Set expiry price and jump past expiry
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);
        oracle.setPrice(address(twoTK), "2TK", resolvedPrice / 1e18);

        // Both parties approve the book to pull strike for settlement
        vm.startPrank(maker);
        mtk.approve(address(book), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(taker);
        mtk.approve(address(book), type(uint256).max);
        vm.stopPrank();

        // Snapshot balances
        uint256 longBefore  = mtk.balanceOf(finalLong);
        uint256 shortBefore = mtk.balanceOf(finalShort);

        // Exercise (as long)
        vm.prank(finalLong);
        book.resolveAndExercise(g, 0);

        // After settle: ensure oracle price was used
        uint256 priceAtExpiry = inst.priceAtExpiry();
        assertEq(priceAtExpiry, resolvedPrice, "poly: oracle mismatch");

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        // ===== Expected payout (polynomial) with NET SETTLEMENT =====
        uint256 notional = strikeNotional;

        // x = (S - K) / K (wad)
        int256 xWad = (int256(resolvedPrice) - int256(desiredStrike)) * int256(1e18) / int256(desiredStrike);

        // optional clamp in PolynomialGenie (we mirrored 10e18)
        int256 X_CLAMP = 10 * 1e18;
        if (xWad > X_CLAMP) xWad = X_CLAMP;
        if (xWad < -X_CLAMP) xWad = -X_CLAMP;

        // y = x^5 - 5x^3 + 4x (wad)
        int256 yWad = _polyWad(xWad);

        // scaled = clamp(y / L, -1, +1)
        int256 scaled = (yWad * int256(1e18)) / int256(fullPayLine1e18);
        if (scaled < -int256(1e18)) scaled = -int256(1e18);
        if (scaled >  int256(1e18)) scaled =  int256(1e18);

        // ratio = (1 + scaled) / 2
        int256 ratio1e18 = (scaled + int256(1e18)) / 2;
        if (ratio1e18 < 0) ratio1e18 = 0;
        if (ratio1e18 > int256(1e18)) ratio1e18 = int256(1e18);

        uint256 longPayout = (uint256(ratio1e18) * notional) / 1e18;
        uint256 shortPayout = notional - longPayout;

        // Net movement
        int256 net = int256(longPayout) - int256(shortPayout); // >0 -> Long receives; <0 -> Long pays

        int256 longDelta  = int256(longAfter)  - int256(longBefore);
        int256 shortDelta = int256(shortAfter) - int256(shortBefore);

        int256 expectedLongDelta  = net + int256(refundAmount);
        int256 expectedShortDelta = -net;

        assertEq(longDelta,  expectedLongDelta,  "POLY: LONG net delta mismatch");
        assertEq(shortDelta, expectedShortDelta, "POLY: SHORT net delta mismatch");

        // Conservation between LONG & SHORT: total changes by refundAmount (refund comes from the instance)
        assertEq(
            longAfter + shortAfter,
            longBefore + shortBefore + refundAmount,
            "POLY: MTK conservation (+refund) failed"
        );

        // Maker's funded asset must be refunded on exercise
        if (makerIsLong) {
            assertEq(mtk.balanceOf(g), 0, "POLY: strike funding should be refunded");
        } else {
            assertEq(twoTK.balanceOf(g), 0, "POLY: underlying funding should be refunded");
        }
    }

    function _runReclaimScenarioPolynomial(
        bool makerIsLong,
        uint256 desiredStrike,     // 1e18
        uint256 fullPayLine1e18    // 1e18
    ) internal {
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Maker funding approvals
        if (makerIsLong) {
            vm.startPrank(maker);
            mtk.approve(address(book), strikeNotional);
            vm.stopPrank();
        } else {
            vm.startPrank(maker);
            twoTK.approve(address(book), SIZE);
            vm.stopPrank();
        }

        // Create as maker (polynomial path)
        vm.prank(maker);
        address g = book.createAndFundPolynomialGenie(
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
            fullPayLine1e18
        );

        PolynomialGenie inst = PolynomialGenie(g);

        // Instance wiring BEFORE activation
        assertTrue(inst.isFunded(), "poly: should be funded");
        assertEq(inst.strikePrice(), desiredStrike, "poly: strike should equal desiredStrike");
        assertEq(keccak256(bytes(inst.contractType())), keccak256(bytes("POLYNOMIAL_GENIE")), "wrong instance type");

        // Counterparty enters (activates with expiry)
        vm.prank(taker);
        book.enterAndPayPremium(g, 0);

        address finalShort = inst.short();

        // Record maker funding balances before reclaim
        uint256 makerStrikeBefore = mtk.balanceOf(maker);
        uint256 makerUnderBefore  = twoTK.balanceOf(maker);

        // Jump past expiry (no resolve/exercise)
        vm.warp(block.timestamp + EXPIRY_SECONDS + 1);

        // Short (current short) reclaims
        vm.prank(finalShort);
        book.resolveAndReclaim(g);

        // Maker funding should be refunded
        if (makerIsLong) {
            uint256 makerStrikeAfter = mtk.balanceOf(maker);
            assertGt(makerStrikeAfter, makerStrikeBefore, "poly: maker strike should be refunded");
            assertEq(mtk.balanceOf(g), 0, "poly: no strike left in instance");
        } else {
            uint256 makerUnderAfter = twoTK.balanceOf(maker);
            assertGt(makerUnderAfter, makerUnderBefore, "poly: maker underlying should be refunded");
            assertEq(twoTK.balanceOf(g), 0, "poly: no underlying left in instance");
        }
    }

    // ======================== Math helpers (mirror contract scaling) ========================

    // Constants for π and 2π in 1e18 fixed-point representation
    int256 internal constant PI  = 3141592653589793238;
    int256 internal constant TWO_PI = 6283185307179586476;

    function _normalizeAngle(int256 x) internal pure returns (int256) {
        int256 y = x % TWO_PI;
        if (y < 0) y += TWO_PI;
        if (y > PI) y -= TWO_PI;
        return y;
    }

    // Fixed-point sine approximation (same Taylor form as in contract), input in radians (1e18-scaled).
    function _sinWad(int256 x) internal pure returns (int256 sinApprox) {
        int256 x1 = x;
        int256 x2 = (x1 * x1) / 1e18;

        sinApprox = x1;
        // x^3 term
        int256 term = (x2 * x1) / 1e18;
        sinApprox -= term / 6;            // - x^3/3!
        // x^5 term
        term = (term * x2) / 1e18;
        sinApprox += term / 120;          // + x^5/5!
        // x^7 term
        term = (term * x2) / 1e18;
        sinApprox -= term / 5040;         // - x^7/7!
        // x^9 term
        term = (term * x2) / 1e18;
        sinApprox += term / 362880;       // + x^9/9!
        // x^11 term
        term = (term * x2) / 1e18;
        sinApprox -= term / 39916800;     // - x^11/11!
        // x^13 term
        term = (term * x2) / 1e18;
        sinApprox += term / 6227020800;   // + x^13/13!

        return sinApprox;
    }

    // Polynomial y = x^5 - 5x^3 + 4x with wad math
    function _polyWad(int256 x) internal pure returns (int256) {
        int256 x2 = (x * x) / 1e18;        // x^2
        int256 x3 = (x2 * x) / 1e18;       // x^3
        int256 x5 = (x3 * x2) / 1e18;      // x^5
        // y = x^5 - 5x^3 + 4x
        return x5 - (x3 * 5) + (x * 4);
    }
}

// Simple ERC20 for mocking
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
