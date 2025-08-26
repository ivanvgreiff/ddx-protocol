// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SimuOracle.sol";
import "./FuturesBook.sol";

/**
 * @title LinearFiniteFutures
 * @notice Cash-settled finite futures with linear payoff: payout magnitude is |S-K| * positionSize / 1e18,
 *         paid to the winning side (long if S>K, short if S<K). All amounts are 1e18-scaled.
 */
contract LinearFiniteFutures {
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

    // Introspection
    string public constant futureType = "LINEAR_FINITE_FUTURES";

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

    // Access control
    modifier onlyBook() {
        require(msg.sender == futuresBook, "Only FuturesBook");
        _;
    }

    /**
     * @dev Initialize a newly cloned futures instance. Called once by the FuturesBook.
     */
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

        // Set whichever side the maker chose; leave the counterparty slot empty
        if (makerIsLongFlag) {
            long  = _short;        // maker is long now
            short = address(0);    // taker to be filled on enter
        } else {
            short = _short;        // maker is short now
            long  = address(0);    // taker to be filled on enter
        }

        emit FutureCreated(maker);
    }

    /**
     * @dev Finalize funding after the book has transferred tokens in.
     */
    function fund(uint256 strikeNotional, uint256 expirySeconds) external onlyBook {
        require(!isFunded, "Already funded");
        require(strikeNotional > 0, "FUT: strikeNotional=0");
        require(expirySeconds > 0, "FUT: expirySeconds=0");

        if (makerIsLongFlag) {
            // LONG maker funds with strike tokens
            require(strikeToken.balanceOf(address(this)) == strikeNotional, "FUT: bad strike funding");
        } else {
            // SHORT maker funds with underlying tokens
            require(underlyingToken.balanceOf(address(this)) >= positionSize, "FUT: bad underlying funding");
        }

        // Fix strike from notional and size (1e18 scaling)
        strikePrice = (strikeNotional * 1e18) / positionSize;
        makerExpirySeconds = expirySeconds;

        isFunded = true;
        emit FutureFunded(maker, positionSize);
    }

    /**
     * @notice Counterparty enters; fill only the vacant role based on maker intent.
     */
    function enterAsLong(address realLong) external onlyBook {
        require(isFunded, "Not funded yet");
        require(!isActive, "Already active");

        if (makerIsLongFlag) {
            // maker already long; short must be empty
            require(short == address(0), "Already entered");
            short = realLong;
        } else {
            // maker is short; long must be empty
            require(long == address(0), "Already entered");
            long = realLong;
        }

        isActive = true;
        expiry = block.timestamp + makerExpirySeconds;

        emit FutureActivated(long, 0, expiry);
    }

    /**
     * @notice Resolve the settlement price from the oracle at/after expiry.
     */
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

    /**
     * @notice Cash settlement: linear magnitude, book transfers strike between parties.
     */
    function exercise(uint256 /* mtkAmount */, address realLong) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(isResolved, "Not resolved");
        require(realLong == long, "Not authorized long");

        uint256 p0 = strikePrice;
        uint256 p1 = priceAtExpiry;
        require(p0 > 0 && p1 > 0, "Bad prices");

        uint256 diff = p1 > p0 ? (p1 - p0) : (p0 - p1); // 1e18
        uint256 payout = (diff * positionSize) / 1e18;  // strike units

        isExercised = true;

        _refundFundingToMaker();

        FuturesBook(futuresBook).notifyExercised(payout);

        emit FutureSettled(realLong, payout, payout);
    }

    /**
     * @notice If unexercised after expiry, the short (maker) can reclaim funded assets and end the position.
     */
    function reclaim(address realShort) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(realShort == short, "Not authorized short");

        isExercised = true; // terminal state
        _refundFundingToMaker();

        emit FutureExpiredUnused(realShort);
    }

    function getOracleAddress() external view returns (address) {
        return address(oracle);
    }

    // ==== internal helpers ====
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
}
