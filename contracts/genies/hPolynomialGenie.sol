// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../oracles/SimuOracle.sol";
import "../core/GenieBook.sol";

/**
 * @title PolynomialGenie
 * @notice Cash-settled contract with polynomial payoff.
 *         Polynomial: y = x^5 - 5x^3 + 4x, with x = (S - K) / K  (dimensionless; all 1e18-fixed).
 *         The only parameter is the vertical 100%-line L = fullPayLine1e18 (>0).
 *         Mapping to long's payout fraction:
 *            scaled = clamp(y / L, -1, +1)
 *            ratio  = (1 + scaled) / 2  in [0,1]
 *         scaled=+1 => long takes 100%; scaled=-1 => short takes 100%.
 */
contract PolynomialGenie {
    using SafeERC20 for IERC20;

    // Roles and contract references
    address public short;
    address public long;
    address public genieBook;      // factory/controller (GenieBook)

    // Tokens and symbols
    IERC20 public underlyingToken;
    IERC20 public strikeToken;
    string public underlyingSymbol;
    string public strikeSymbol;

    // Economic parameters
    uint256 public strikePrice;    // fixed strike (1e18-scaled)
    uint256 public positionSize;   // underlying quantity (1e18 units)
    uint256 public premium;        // always 0 for Genie contracts

    // Timeline
    uint256 public expiry;         // timestamp of expiry (set on activation)
    bool public isActive;
    bool public isExercised;
    bool public isFunded;

    // Settlement data
    SimuOracle public oracle;
    uint256 public priceAtExpiry;
    bool public isResolved;

    // Initialization flags and maker info
    bool private initialized;
    bool private makerIsLongFlag;
    address public maker;
    uint256 public makerExpirySeconds;

    // Funding refund tracking
    bool private fundingRefunded;

    // ---- Polynomial configuration ----
    // The *only* user-set parameter: vertical 100%-line (|y| reaching this means full payout)
    uint256 public fullPayLine1e18;              // L, >0 (1e18 = "unit" y)
    uint256 public constant MIN_FULLPAYLINE = 1; // avoid div by zero

    // Contract type identifier
    string public constant contractType = "POLYNOMIAL_GENIE";

    // Events
    event GenieCreated(address indexed maker);
    event GenieFunded(address indexed maker, uint256 positionSize);
    event GenieActivated(address indexed long, uint256 premiumPaid, uint256 expiry);
    event GenieSettled(address indexed long, uint256 payout, uint256 sameAsPayout);
    event GenieExpiredUnused(address indexed short);
    event PriceResolved(
        string underlyingSymbol,
        string strikeSymbol,
        uint256 priceAtExpiry,
        uint256 resolvedAt
    );
    event FundingRefunded(address indexed maker, address token, uint256 amount);
    event FullPayLineSet(uint256 fullPayLine1e18);

    modifier onlyBook() {
        require(msg.sender == genieBook, "Only GenieBook");
        _;
    }

    /**
     * @dev Initializes the PolynomialGenie contract clone. Called via the GenieBook.
     */
    function initialize(
        address _short,
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _sideFlag,          // 1 => maker is long; 0 => maker is short
        uint256 _positionSize,
        uint256 _premiumMustBeZero, // must be 0
        address _oracle,
        address _genieBook
    ) external {
        require(!initialized, "Already initialized");
        initialized = true;
        require(_premiumMustBeZero == 0, "GENIE: premium must be 0");
        require(_positionSize > 0, "GENIE: positionSize=0");

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
        genieBook = _genieBook;

        if (makerIsLongFlag) {
            long = _short;
            short = address(0);
        } else {
            long = address(0);
        }

        // Default 100%-line: 1.0 in wad (you can change via setFullPayLine)
        fullPayLine1e18 = 1e18;

        emit GenieCreated(maker);
    }

    /**
     * @dev Sets the vertical 100%-line L (>0). When |y|>=L, one side gets 100%.
     */
    function setFullPayLine(uint256 _fullPayLine1e18) external onlyBook {
        require(!isFunded && !isActive, "Too late to set parameters");
        require(_fullPayLine1e18 >= MIN_FULLPAYLINE, "Invalid fullPayLine");
        fullPayLine1e18 = _fullPayLine1e18;
        emit FullPayLineSet(_fullPayLine1e18);
    }

    /**
     * @dev Funds the contract and sets strike price (same logic as previous Genie).
     * @param strikeNotional Amount of strike token provided if maker is long.
     * @param expirySeconds Relative seconds until expiry.
     */
    function fund(uint256 strikeNotional, uint256 expirySeconds) external onlyBook {
        require(!isFunded, "Already funded");
        require(strikeNotional > 0, "GENIE: strikeNotional=0");
        require(expirySeconds > 0, "GENIE: expirySeconds=0");

        if (makerIsLongFlag) {
            require(strikeToken.balanceOf(address(this)) == strikeNotional, "GENIE: incorrect strike funding");
        } else {
            require(underlyingToken.balanceOf(address(this)) >= positionSize, "GENIE: incorrect underlying funding");
        }

        // strikePrice = strikeNotional / positionSize (1e18-scaled)
        strikePrice = (strikeNotional * 1e18) / positionSize;
        makerExpirySeconds = expirySeconds;
        isFunded = true;

        emit GenieFunded(maker, positionSize);
    }

    /**
     * @dev Counterparty joins and activates the contract.
     */
    function enterAsLong(address realLong) external onlyBook {
        require(isFunded, "Not funded yet");
        require(!isActive, "Already active");

        if (makerIsLongFlag) {
            require(short == address(0), "Short already joined");
            short = realLong;
        } else {
            require(long == address(0), "Long already joined");
            long = realLong;
        }

        isActive = true;
        expiry = block.timestamp + makerExpirySeconds;

        emit GenieActivated(long, 0, expiry);
    }

    /**
     * @dev Resolves the price at expiry from the oracle (callable by anyone after expiry).
     */
    function resolve() public {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early to resolve");
        require(!isResolved, "Already resolved");

        uint256 price = oracle.getDerivedPriceBySymbols(underlyingSymbol, strikeSymbol);
        require(price > 0, "Invalid price from oracle");

        priceAtExpiry = price;
        isResolved = true;
        emit PriceResolved(underlyingSymbol, strikeSymbol, price, block.timestamp);
    }

    /**
     * @dev Exercises the contract after resolution, calculating payout based on the polynomial.
     *      x = (S - K) / K            (all 1e18 fixed-point; signed, dimensionless)
     *      y = x^5 - 5x^3 + 4x
     *      scaled = clamp(y / L, -1, +1)
     *      ratio  = (1 + scaled) / 2
     */
    function exercise(uint256 /* _unused */, address realLong) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(isResolved, "Price not resolved");
        require(realLong == long, "Caller not authorized long");

        uint256 p0 = strikePrice;
        uint256 p1 = priceAtExpiry;
        require(p0 > 0 && p1 > 0, "Unset prices");

        // notional in strike tokens
        uint256 notional = (p0 * positionSize) / 1e18;

        // x = (S - K) / K  (wad). Clamp x to avoid absurd growth/overflow in far tails.
        int256 diff = int256(p1) - int256(p0);
        int256 xWad = (diff * int256(1e18)) / int256(p0);

        // Optional safety clamp on |x| (dimensionless), e.g., 10.0
        int256 X_CLAMP = 10 * 1e18;
        if (xWad > X_CLAMP) xWad = X_CLAMP;
        if (xWad < -X_CLAMP) xWad = -X_CLAMP;

        // y = x^5 - 5x^3 + 4x  (wad math)
        int256 yWad = _polyWad(xWad);

        // scaled = clamp(y / L, -1, +1)
        int256 scaled = (yWad * int256(1e18)) / int256(fullPayLine1e18);
        if (scaled < -int256(1e18)) scaled = -int256(1e18);
        if (scaled >  int256(1e18)) scaled =  int256(1e18);

        // Map to [0, 1]: (1 + scaled) / 2
        int256 ratio1e18 = (scaled + int256(1e18)) / 2;
        if (ratio1e18 < 0) ratio1e18 = 0;
        if (ratio1e18 > int256(1e18)) ratio1e18 = int256(1e18);

        uint256 payout = (uint256(ratio1e18) * notional) / 1e18;

        isActive = false;
        isExercised = true;
        _refundFundingToMaker();

        // Notify the book to transfer payout between parties
        GenieBook(genieBook).notifyExercised(payout);

        emit GenieSettled(realLong, payout, payout);
    }

    /**
     * @dev Allows the short side to reclaim funds if the contract expires without exercise.
     */
    function reclaim(address realShort) external onlyBook {
        require(isActive, "Not active");
        require(block.timestamp >= expiry, "Too early");
        require(!isExercised, "Already exercised");
        require(realShort == short, "Caller not authorized short");

        isActive = false;
        isExercised = true;
        _refundFundingToMaker();

        emit GenieExpiredUnused(realShort);
    }

    /**
     * @dev Returns the oracle address used by this contract.
     */
    function getOracleAddress() external view returns (address) {
        return address(oracle);
    }

    /**
     * @dev Internal helper to refund the maker's original funding after settlement or expiry.
     */
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

    // -------- Internal math --------

    /**
     * @dev Fixed-point polynomial y = x^5 - 5x^3 + 4x with 1e18 scaling ("wad").
     *      Be mindful: for large |x| the value grows ~x^5; we clamp x earlier.
     */
    function _polyWad(int256 x) internal pure returns (int256) {
        int256 x2 = (x * x) / 1e18;        // x^2
        int256 x3 = (x2 * x) / 1e18;       // x^3
        int256 x5 = (x3 * x2) / 1e18;      // x^5
        // y = x^5 - 5x^3 + 4x
        return x5 - (x3 * 5) + (x * 4);
    }
}
