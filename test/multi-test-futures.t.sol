// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import "../contracts/FuturesBook.sol";
import "../contracts/LinearFiniteFutures.sol";
import "../contracts/SimuOracle.sol";

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ComprehensiveFuturesTest is Test {
    FuturesBook public futuresBook;
    LinearFiniteFutures public linearImpl;
    SimuOracle public oracle;

    MockERC20 public twoTK; // underlying (2TK)
    MockERC20 public mtk;   // strike (MTK)

    address public maker = address(0x1);
    address public taker = address(0x2);

    // Common knobs
    uint256 constant SIZE = 100e18;              // optionSize = 100 units of underlying
    uint256 constant EXPIRY_SECONDS = 5 minutes; // uses your _expirySeconds param

    function setUp() public {
        // Deploy tokens and mint balances
        twoTK = new MockERC20("TwoToken", "2TK");
        mtk   = new MockERC20("MoneyToken", "MTK");

        // Mint balances to test actors
        twoTK.mint(maker, 10_000e18);
        mtk.mint(maker,   20_000e18);
        mtk.mint(taker,   20_000e18);
        twoTK.mint(taker, 20_000e18);

        // Simple oracle: price(2TK)=2, price(MTK)=1 → derived(2TK/MTK) ≈ 2e18
        oracle = new SimuOracle();
        oracle.setPrice(address(twoTK), "2TK", 2);
        oracle.setPrice(address(mtk),   "MTK", 1);

        // Deploy impl & book
        linearImpl  = new LinearFiniteFutures();
        futuresBook = new FuturesBook(address(linearImpl));
    }

    // ======================== MATRIX (exercise) ========================

    function testFutures_Exercise_Matrix() public {
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
                _runExerciseScenario(makerIsLongArray[i], desiredStrike, expiryPrices[j]);
            }
        }
    }

    // ======================== RECLAIM (no exercise) ========================

    function testFutures_Reclaim_LongMaker() public {
        _runReclaimScenario({makerIsLong: true,  desiredStrike: 2e18});
    }

    function testFutures_Reclaim_ShortMaker() public {
        _runReclaimScenario({makerIsLong: false, desiredStrike: 4e18});
    }

    // ======================== INTERNAL HELPERS ========================

    function _runExerciseScenario(
        bool makerIsLong,
        uint256 desiredStrike,   // 1e18 scaled
        uint256 resolvedPrice    // 1e18 scaled
    ) internal {
        // Compute maker strike notional to fund the fixed strike:
        // strikeNotional = desiredStrike * SIZE / 1e18
        uint256 strikeNotional = (desiredStrike * SIZE) / 1e18;

        // Approvals for maker funding (depends on which asset the maker must deposit)
        if (makerIsLong) {
            // LONG maker funds strike tokens
            vm.startPrank(maker);
            mtk.approve(address(futuresBook), strikeNotional);
            vm.stopPrank();
        } else {
            // SHORT maker funds underlying tokens
            vm.startPrank(maker);
            twoTK.approve(address(futuresBook), SIZE);
            vm.stopPrank();
        }

        // --- Create as MAKER ---
        // Your FuturesBook.createAndFundLinearFuture has **10 args** in this order:
        // (_underlyingToken, _strikeToken, _underlyingSymbol, _strikeSymbol,
        //  _optionSize, _premiumMustBe0, _oracle, _strikeNotional, _makerIsLong, _expirySeconds)
        vm.prank(maker);
        address fut = futuresBook.createAndFundLinearFuture(
            address(twoTK),
            address(mtk),
            "2TK",
            "MTK",
            SIZE,            // _optionSize
            0,               // _premiumMustBe0
            address(oracle), // _oracle
            strikeNotional,  // _strikeNotional
            makerIsLong,     // _makerIsLong
            EXPIRY_SECONDS   // _expirySeconds
        );

        LinearFiniteFutures inst = LinearFiniteFutures(fut);

        // Taker enters (no premium, pass 0)
        uint256 tsBeforeEnter = block.timestamp;
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        // Check strike fixed from maker funding and expiry applied at activation
        uint256 entryStrike = inst.strikePrice();
        assertEq(entryStrike, desiredStrike, "strike should equal desiredStrike");
        assertEq(inst.expiry(), tsBeforeEnter + EXPIRY_SECONDS, "bad expiry");

        // Whose long/short after activation?
        address finalLong  = inst.long();
        address finalShort = inst.short();

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

        // Anyone can trigger settle; call as long (matches FuturesBook.exercise signature)
        vm.prank(finalLong);
        futuresBook.resolveAndExercise(fut, 0);

        uint256 longAfter  = mtk.balanceOf(finalLong);
        uint256 shortAfter = mtk.balanceOf(finalShort);

        // Expected absolute payout in strike token
        uint256 diff = resolvedPrice > entryStrike ? (resolvedPrice - entryStrike) : (entryStrike - resolvedPrice);
        uint256 expectedPayout = (diff * SIZE) / 1e18;

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

    function _runReclaimScenario(
        bool makerIsLong,
        uint256 desiredStrike // 1e18 scaled
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

        // Create as maker (10-arg function, exact order)
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

        // Counterparty enters (activates with expiry)
        vm.prank(taker);
        futuresBook.enterAndPayPremium(fut, 0);

        LinearFiniteFutures inst = LinearFiniteFutures(fut);
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
            // Maker had deposited strike tokens
            uint256 makerStrikeAfter = mtk.balanceOf(maker);
            assertGt(makerStrikeAfter, makerStrikeBefore, "maker strike should be refunded");
            assertEq(mtk.balanceOf(fut), 0, "no strike left in instance");
        } else {
            // Maker had deposited underlying tokens
            uint256 makerUnderAfter = twoTK.balanceOf(maker);
            assertGt(makerUnderAfter, makerUnderBefore, "maker underlying should be refunded");
            assertEq(twoTK.balanceOf(fut), 0, "no underlying left in instance");
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
