// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../oracles/SimuOracle.sol";
import "../core/FuturesBook.sol";

// PRBMath signed 59.18-decimal fixed-point library
import { SD59x18, sd } from "@prb/math/src/SD59x18.sol";
import { exp } from "@prb/math/src/sd59x18/Math.sol";

/**
 * @title SigmoidFiniteFutures
 * @notice Cash-settled finite futures with sigmoid-style payoff:
 *         payout = | sigmoid(I*(S-K)) - 0.5 | * 2 * notional,
 *         where notional = positionSize * strikePrice / 1e18.
 *         Direction still follows S ? K (long if S>K, short if S<K).
 *         All monetary values are 1e18-scaled.
 */
contract SigmoidFiniteFutures {
    using SafeERC20 for IERC20;

    // Roles
    address public short;          // initialized to maker
    address public long;
    address public futuresBook;    // factory/controller

    // Tokens and market identifiers
    IERC20 public underlyingToken;
    IERC20 public strikeToken;
    string public underlyingSymbol;
    string public strikeSymbol;

    // Economics
    uint256 public strikePrice;    // fixed at funding, 1e18-scaled (strikeNotional / positionSize)
    uint256 public positionSize;   // quantity in underlying units (1e18)
    uint256 public premium;        // always 0 for futures (kept for interface parity)

    // Lifecycle
    uint256 public expiry;         // set on activation using maker-chosen relative seconds
    bool public isActive;
    bool public isExercised;
    bool public isFunded;

    // Settlement
    SimuOracle public oracle;
    uint256 public priceAtExpiry;
    bool public isResolved;

    // Init & maker intent
    bool private initialized;
    bool private makerIsLongFlag;
    address public maker;          // equals initial short at initialize
    uint256 public makerExpirySeconds;

    // Bookkeeping
    bool private fundingRefunded;

    // Sigmoid payoff control (I)
    uint256 public sigmoidIntensity1e18 = 1e18;         // default I = 1.0
    uint256 public constant MAX_INTENSITY_1E18 = 100e18;

    // Introspection
    string public constant futureType = "SIGMOID_FINITE_FUTURES";

    // Events
    event FutureCreated(address indexed maker);
    event FutureFunded(address indexed maker, uint256 positionSize);
    event FutureActivated(address indexed long, uint256 premiumPaid, uint256 expiry);
    event FutureSettled(address indexed long, uint256 pnlPaid, uint256 sameAsPnl);
    event FutureExpiredUnused(address indexed short);
    event PriceResolved(
        string underlyingSymbol,
        string strikeSymbol,
        uint256 priceAtExpiry,
        uint256 resolvedAt
    );
    event FundingRefunded(address indexed maker, address token, uint256 amount);
    event SigmoidIntensitySet(uint256 intensity1e18);

    modifier onlyBook() {
        require(msg.sender == futuresBook, "Only FuturesBook");
        _;
    }

    function initialize(
        address _short,
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _sideFlag,
        uint256 _positionSize,
        uint256 _premiumMustBeZero,
        address _oracle,
        address _futuresBook
    ) external {
        require(!initialized, "Already initialized");
        initialized = true;
        require(_premiumMustBeZero == 0, "FUT: premium must be 0");
        require(_positionSize > 0, "FUT: size=0");

        short = _short;
        maker = _short;

        underlyingToken = IERC20(_underlyingToken);
        strikeToken     = IERC20(_strikeToken);
        underlyingSymbol = _underlyingSymbol;
        strikeSymbol     = _strikeSymbol;

        makerIsLongFlag = (_sideFlag != 0);
        positionSize = _positionSize;
        premium = 0;

        oracle = SimuOracle(_oracle);
        futuresBook = _futuresBook;

        if (makerIsLongFlag) {
            long  = _short;
            short = address(0);
        } else {
            short = _short;
            long  = address(0);
        }

        emit FutureCreated(maker);
    }

    function setSigmoidIntensity(uint256 intensity1e18) external onlyBook {
        require(!isFunded && !isActive, "Too late");
        require(intensity1e18 > 0 && intensity1e18 <= MAX_INTENSITY_1E18, "Invalid intensity");
        sigmoidIntensity1e18 = intensity1e18;
        emit SigmoidIntensitySet(intensity1e18);
    }

    function fund(uint256 strikeNotional, uint256 expirySeconds) external onlyBook {
        require(!isFunded, "Already funded");
        require(strikeNotional > 0, "FUT: strikeNotional=0");
        require(expirySeconds > 0, "FUT: expirySeconds=0");

        if (makerIsLongFlag) {
            require(strikeToken.balanceOf(address(this)) == strikeNotional, "FUT: bad strike funding");
        } else {
            require(underlyingToken.balanceOf(address(this)) >= positionSize, "FUT: bad underlying funding");
        }

        strikePrice = (strikeNotional * 1e18) / positionSize;
        makerExpirySeconds = expirySeconds;

        isFunded = true;
        emit FutureFunded(maker, positionSize);
    }

    function enterAsLong(address realLong) external onlyBook {
        require(isFunded, "Not funded yet");
        require(!isActive, "Already active");

        if (makerIsLongFlag) {
            require(short == address(0), "Already entered");
            short = realLong;
        } else {
            require(long == address(0), "Already entered");
            long = realLong;
        }

        isActive = true;
        expiry = block.timestamp + makerExpirySeconds;

        emit FutureActivated(long, 0, expiry);
    }

    function resolve() public {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isResolved, "Resolved");

        uint256 price = oracle.getDerivedPriceBySymbols(underlyingSymbol, strikeSymbol);
        require(price > 0, "Invalid price");

        priceAtExpiry = price;
        isResolved = true;

        emit PriceResolved(underlyingSymbol, strikeSymbol, price, block.timestamp);
    }

    function exercise(uint256 /* mtkAmount */, address realLong) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(isResolved, "Not resolved");
        require(realLong == long, "Not authorized long");

        uint256 p0 = strikePrice;
        uint256 p1 = priceAtExpiry;
        require(p0 > 0 && p1 > 0, "Bad prices");

        uint256 notional = (p0 * positionSize) / 1e18;

        // z = I*(S-K) in 1e18 fixed-point
        int256 z = _mulWadSigned(int256(sigmoidIntensity1e18), int256(p1) - int256(p0));

        // sigmoid using PRBMath exp
        uint256 s = _sigmoidWad(z);

        uint256 half = 5e17;
        uint256 delta = s >= half ? (s - half) : (half - s);

        uint256 payout = (delta * 2 * notional) / 1e18;

        isExercised = true;

        _refundFundingToMaker();

        FuturesBook(futuresBook).notifyExercised(payout);

        emit FutureSettled(realLong, payout, payout);
    }

    function reclaim(address realShort) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(realShort == short, "Not authorized short");

        isExercised = true;
        _refundFundingToMaker();

        emit FutureExpiredUnused(realShort);
    }

    function getOracleAddress() external view returns (address) {
        return address(oracle);
    }

    function _refundFundingToMaker() internal {
        if (fundingRefunded) return;
        fundingRefunded = true;

        if (makerIsLongFlag) {
            uint256 bal = strikeToken.balanceOf(address(this));
            if (bal > 0) {
                strikeToken.safeTransfer(maker, bal);
                emit FundingRefunded(maker, address(strikeToken), bal);
            }
        } else {
            uint256 bal = underlyingToken.balanceOf(address(this));
            if (bal > 0) {
                underlyingToken.safeTransfer(maker, bal);
                emit FundingRefunded(maker, address(underlyingToken), bal);
            }
        }
    }

    /* ========= math helpers ========= */

    function _mulWadSigned(int256 a, int256 b) internal pure returns (int256) {
        return (a * b) / int256(1e18);
    }

    function _sigmoidWad(int256 zWad) internal pure returns (uint256) {
        // e^{-z}
        SD59x18 eneg = exp(sd(-zWad));
        // 1 / (1 + e^{-z})
        SD59x18 one = sd(1e18);
        SD59x18 s = one / (one + eneg);
        return uint256(SD59x18.unwrap(s));
    }
}
