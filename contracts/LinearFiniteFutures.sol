// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SimuOracle.sol";
import "./FuturesBook.sol";

contract LinearFiniteFutures {
    using SafeERC20 for IERC20;

    // keep the same variable names as CallOptionContract for parity
    address public short;      // initialized to maker
    address public long;
    address public optionsBook;

    IERC20 public underlyingToken;
    IERC20 public strikeToken;

    string public underlyingSymbol;
    string public strikeSymbol;

    // strikePrice is FIXED from funding (1e18)
    uint256 public strikePrice;
    // optionSize stores QUANTITY (1e18 underlying units)
    uint256 public optionSize;

    // futures have no premium; keep the variable for parity (always 0)
    uint256 public premium;

    uint256 public expiry;     // set on activation using maker-chosen seconds
    bool public isActive;
    bool public isExercised;
    bool public isFunded;

    SimuOracle public oracle;
    uint256 public priceAtExpiry;
    bool public isResolved;

    bool private initialized;

    // Maker intent (set at initialize)
    bool private makerIsLongFlag;
    address public maker; // equals initial short at initialize

    // maker-chosen relative expiry (seconds), applied when counterparty enters
    uint256 public makerExpirySeconds;

    // Track whether we've returned the maker's funding (to avoid trapping tokens)
    bool private fundingRefunded;

    string public constant optionType = "LINEAR_FINITE_FUTURES";

    event OptionCreated(address indexed maker);
    event ShortFunded(address indexed maker, uint256 optionSize);
    event OptionActivated(address indexed long, uint256 premiumPaid, uint256 expiry);
    event OptionExercised(address indexed long, uint256 pnlPaid, uint256 sameAsPnl);
    event OptionExpiredUnused(address indexed short);
    event PriceResolved(string underlyingSymbol, string strikeSymbol, uint256 priceAtExpiry, uint256 resolvedAt);
    event FundingRefunded(address indexed maker, address token, uint256 amount);

    modifier onlyBook() {
        require(msg.sender == optionsBook, "Only OptionsBook");
        _;
    }

    function initialize(
        address _short,
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _sideFlag, // 1 => maker wants to be long, 0 => maker wants to be short
        uint256 _optionSize,
        uint256 _premiumMustBeZero,
        address _oracle,
        address _optionsBook
    ) external {
        require(!initialized, "Already initialized");
        initialized = true;
        require(_premiumMustBeZero == 0, "FUT: premium must be 0");
        require(_optionSize > 0, "FUT: size=0");

        // Record maker and default roles (parity with options naming)
        short = _short;
        maker = _short;

        underlyingToken = IERC20(_underlyingToken);
        strikeToken     = IERC20(_strikeToken);
        underlyingSymbol = _underlyingSymbol;
        strikeSymbol     = _strikeSymbol;

        makerIsLongFlag = (_sideFlag != 0);
        optionSize = _optionSize;
        premium = 0;

        oracle = SimuOracle(_oracle);
        optionsBook = _optionsBook;

        emit OptionCreated(maker);
    }

    /**
     * @dev Finalize funding after the book has transferred tokens in.
     * @param strikeNotional amount in strike tokens used to compute the fixed strike (desiredStrike * optionSize)
     * @param expirySeconds  maker-chosen relative expiry, applied when the counterparty enters
     *
     * Funding checks:
     *  - If maker wants LONG  → this contract must currently hold exactly 'strikeNotional' strike tokens.
     *  - If maker wants SHORT → this contract must currently hold >= 'optionSize' underlying tokens.
     */
    function fund(uint256 strikeNotional, uint256 expirySeconds) external onlyBook {
        require(!isFunded, "Already funded");
        require(strikeNotional > 0, "FUT: strikeNotional=0");
        require(expirySeconds > 0, "FUT: expirySeconds=0");

        if (makerIsLongFlag) {
            // LONG maker funded with strike tokens
            require(strikeToken.balanceOf(address(this)) == strikeNotional, "FUT: bad strike funding");
        } else {
            // SHORT maker funded with underlying tokens
            require(underlyingToken.balanceOf(address(this)) >= optionSize, "FUT: bad underlying funding");
        }

        // Fix the strike from notional and size (1e18 scaling)
        strikePrice = (strikeNotional * 1e18) / optionSize;
        makerExpirySeconds = expirySeconds;

        isFunded = true;
        emit ShortFunded(maker, optionSize);
    }

    /**
     * @notice Counterparty enters; roles are assigned per maker intent; expiry is applied from maker's chosen seconds.
     * No tokens move here; futures have no premium.
     */
    function enterAsLong(address realLong) external onlyBook {
        require(isFunded, "Not funded yet");
        require(!isActive, "Already active");
        require(long == address(0), "Already entered");

        if (makerIsLongFlag) {
            // Maker is the long; entrant becomes short.
            long = maker;
            short = realLong;
        } else {
            // Maker is the short; entrant becomes long.
            long = realLong;
            // short remains maker
        }

        isActive = true;
        expiry = block.timestamp + makerExpirySeconds;

        emit OptionActivated(long, 0, expiry);
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

    /**
     * @notice Cash settlement: absolute PnL in strike token.
     * Either party may ask the book to settle; the book will transfer strike from loser → winner.
     * We also refund maker’s funded tokens (so nothing remains trapped in the instance).
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

        uint256 diff = p1 > p0 ? (p1 - p0) : (p0 - p1);
        uint256 payout = (diff * optionSize) / 1e18;

        isExercised = true;

        // Always refund the maker's funded asset; futures are cash-settled in strike tokens.
        _refundFundingToMaker();

        // Inform the book of the absolute payout to move strike tokens loser → winner.
        FuturesBook(optionsBook).notifyExercised(payout);

        emit OptionExercised(realLong, payout, payout);
    }

    /**
     * @notice If unexercised after expiry, the short (maker) can reclaim.
     * This refunds the maker's funded tokens and ends the position.
     */
    function reclaim(address realShort) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(realShort == short, "Not authorized short");

        isExercised = true; // terminal state
        _refundFundingToMaker();

        emit OptionExpiredUnused(realShort);
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
