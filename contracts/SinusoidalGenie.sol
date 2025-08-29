// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SimuOracle.sol";
import "./GenieBook.sol";

/**
 * @title SinusoidalGenie
 * @notice A cash-settled contract with sinusoidal payoff. At expiry, 
 *         the payout is determined by a sinusoidal curve with user-defined amplitude and period.
 *         Payout (in strike tokens) is a fraction of the notional, based on |sin| of the price difference.
 */
contract SinusoidalGenie {
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

    // Sinusoidal payoff parameters
    uint256 public amplitude1e18;                   // amplitude as fraction of notional (1e18 = 100%)
    uint256 public period1e18;                      // period of the sinusoid in price units (1e18-scaled)
    uint256 public constant MAX_AMPLITUDE_1E18 = 1e18;
    int256 public phaseShift1e18;                   // radians, 1e18-scaled (applied as angle offset)

    // Contract type identifier (for introspection)
    string public constant contractType = "SINUSOIDAL_GENIE";

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
    event SinusoidalParametersSet(uint256 amplitude1e18, uint256 period1e18);
    event SinusoidalOffsetSet(int256 phaseShift1e18);

    modifier onlyBook() {
        require(msg.sender == genieBook, "Only GenieBook");
        _;
    }

    /**
     * @dev Initializes the SinusoidalGenie contract clone. This should be called via the GenieBook.
     * @param _short The address of the maker (initial short position holder, or long if makerIsLongFlag is true)
     * @param _underlyingToken Address of the ERC20 underlying asset token
     * @param _strikeToken Address of the ERC20 strike asset token (payout currency)
     * @param _underlyingSymbol Symbol or identifier of the underlying asset
     * @param _strikeSymbol Symbol or identifier of the strike asset
     * @param _sideFlag If 1, the maker is taking the long side; if 0, maker is short
     * @param _positionSize Quantity of underlying (1e18 units) for the contract
     * @param _premiumMustBeZero Must be 0 (no premium for these contracts)
     * @param _oracle Address of price oracle contract (SimuOracle)
     * @param _genieBook Address of the GenieBook (factory) contract
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
            // short remains _short as initialized
        }

        // Initialize with default parameters (can be overridden via setSinusoidalParameters)
        amplitude1e18 = 1e18;   // default 100% amplitude
        period1e18 = 1e18;      // default period (arbitrary initial value, should be set by maker)
        phaseShift1e18 = 0;     // default: no phase offset

        emit GenieCreated(maker);
    }

    /**
     * @dev Sets the sinusoidal payoff parameters (amplitude and period) before funding.
     * @param _amplitude1e18 Amplitude as a fraction of notional (scaled 1e18, >0 up to 1e18)
     * @param _period1e18 Period of the sinusoidal payoff curve in price difference units (scaled 1e18)
     */
    function setSinusoidalParameters(uint256 _amplitude1e18, uint256 _period1e18) external onlyBook {
        require(!isFunded && !isActive, "Too late to set parameters");
        require(_amplitude1e18 > 0 && _amplitude1e18 <= MAX_AMPLITUDE_1E18, "Invalid amplitude");
        require(_period1e18 > 0, "Invalid period");
        amplitude1e18 = _amplitude1e18;
        period1e18 = _period1e18;
        emit SinusoidalParametersSet(_amplitude1e18, _period1e18);
    }

    /**
     * @dev Sets a phase offset (in radians, 1e18-scaled) applied to the sinusoidal angle.
     *      Can be called before funding/activation by the GenieBook.
     * @param _phaseShift1e18 Phase offset in radians, 1e18-scaled.
     */
    function setSinusoidalOffset(int256 _phaseShift1e18) external onlyBook {
        phaseShift1e18 = _phaseShift1e18;
        emit SinusoidalOffsetSet(phaseShift1e18);
    }

    /**
     * @dev Funds the contract with the strike notional (if maker is long) or underlying (if maker is short), and locks in the strike price.
     * @param strikeNotional The amount of strike token funding provided (if maker is long). Must correspond to desired strike price.
     * @param expirySeconds Relative number of seconds until expiry.
     */
    function fund(uint256 strikeNotional, uint256 expirySeconds) external onlyBook {
        require(!isFunded, "Already funded");
        require(strikeNotional > 0, "GENIE: strikeNotional=0");
        require(expirySeconds > 0, "GENIE: expirySeconds=0");

        if (makerIsLongFlag) {
            // Maker (long) should have deposited strikeNotional of strikeToken to this contract
            require(strikeToken.balanceOf(address(this)) == strikeNotional, "GENIE: incorrect strike funding");
        } else {
            // Maker (short) should have deposited the full underlying position to this contract
            require(underlyingToken.balanceOf(address(this)) >= positionSize, "GENIE: incorrect underlying funding");
        }

        // Determine the strike price (strikeNotional per unit of underlying)
        strikePrice = (strikeNotional * 1e18) / positionSize;
        makerExpirySeconds = expirySeconds;
        isFunded = true;

        emit GenieFunded(maker, positionSize);
    }

    /**
     * @dev Allows the second party to take the opposing side (long or short) and activate the contract.
     * @param realLong The address of the user taking the long side (if maker was short, this will be msg.sender).
     */
    function enterAsLong(address realLong) external onlyBook {
        require(isFunded, "Not funded yet");
        require(!isActive, "Already active");

        if (makerIsLongFlag) {
            // Maker was long, so we expect the short side to join
            require(short == address(0), "Short already joined");
            short = realLong;
        } else {
            // Maker was short, so the long side joins
            require(long == address(0), "Long already joined");
            long = realLong;
        }

        isActive = true;
        expiry = block.timestamp + makerExpirySeconds;

        emit GenieActivated(long, 0, expiry);
    }

    /**
     * @dev Resolve fetches the price at expiry from the oracle (callable by anyone after expiry).
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
     * @dev Exercises the contract after resolution, calculating payout based on the sinusoidal payoff curve.
     *      Can only be called by the GenieBook, which passes in the long's address for authorization.
     * param _unused Placeholder (not used, premium always 0 for futures)
     * @param realLong The address of the long position (for verification)
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

        // Calculate notional = strikePrice * positionSize (in strike token units)
        uint256 notional = (p0 * positionSize) / 1e18;

        // Compute the sinusoidal payout fraction
        int256 diff = int256(p1) - int256(p0);
        // Angle = 2π * (S - K) / P   (in 1e18-fixed radians) + phase offset
        int256 angle = ((diff * TWO_PI) / int256(period1e18)) + phaseShift1e18;
        // Wrap angle into [-π, π] for stable computation
        int256 angleNorm = angle % TWO_PI;
        if (angleNorm < 0) {
            angleNorm += TWO_PI;
        }
        if (angleNorm > PI) {
            angleNorm -= TWO_PI;
        }

        int256 sinVal = _sinWad(angleNorm); // [-1e18, +1e18]
        // Scale by amplitude: [-A, +A]
        int256 scaled = (sinVal * int256(amplitude1e18)) / 1e18;
        // Map to [0, 1] fraction: (1 + scaled) / 2
        int256 ratio1e18 = (scaled + int256(1e18)) / 2;
        // Clamp just in case of rounding
        if (ratio1e18 < 0) ratio1e18 = 0;
        if (ratio1e18 > int256(1e18)) ratio1e18 = int256(1e18);
        // Long’s payout
        uint256 payout = (uint256(ratio1e18) * notional) / 1e18;


        isActive = false;
        isExercised = true;
        _refundFundingToMaker();

        // Notify the book to transfer payout between parties
        GenieBook(genieBook).notifyExercised(payout);

        emit GenieSettled(realLong, payout, payout);
    }

    /**
     * @dev Allows the short side to reclaim their funds if the contract expires without exercise (no payout).
     * @param realShort The address of the short position (for verification)
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
            // Maker was long, refund any remaining strike tokens to maker
            uint256 bal = strikeToken.balanceOf(address(this));
            if (bal > 0) {
                strikeToken.safeTransfer(maker, bal);
                emit FundingRefunded(maker, address(strikeToken), bal);
            }
        } else {
            // Maker was short, refund any remaining underlying tokens to maker
            uint256 bal = underlyingToken.balanceOf(address(this));
            if (bal > 0) {
                underlyingToken.safeTransfer(maker, bal);
                emit FundingRefunded(maker, address(underlyingToken), bal);
            }
        }
    }

    // Constants for π and 2π in 1e18 fixed-point representation
    int256 internal constant PI  = 3141592653589793238;
    int256 internal constant TWO_PI = 6283185307179586476;

    /**
     * @dev Fixed-point sine function approximation for input in radians (1e18-scaled).
     *      Uses a Taylor series expansion around 0, accurate for angles in [-π, π].
     * @param x The angle in radians, scaled by 1e18.
     * @return sinApprox The approximate sine of x, in 1e18 fixed-point form (range [-1e18, 1e18]).
     */
    function _sinWad(int256 x) internal pure returns (int256 sinApprox) {
        // Compute sine using Taylor series: x - x^3/3! + x^5/5! - x^7/7! + ...
        // Terms will alternate in sign. We accumulate up to x^13 term for good accuracy.
        int256 x1 = x;
        int256 x2 = (x1 * x1) / 1e18;

        sinApprox = x1;
        // x^3 term
        int256 term = (x2 * x1) / 1e18;
        sinApprox -= term / 6;            // subtract x^3/3!
        // x^5 term
        term = (term * x2) / 1e18;
        sinApprox += term / 120;          // add x^5/5!
        // x^7 term
        term = (term * x2) / 1e18;
        sinApprox -= term / 5040;         // subtract x^7/7!
        // x^9 term
        term = (term * x2) / 1e18;
        sinApprox += term / 362880;       // add x^9/9!
        // x^11 term
        term = (term * x2) / 1e18;
        sinApprox -= term / 39916800;     // subtract x^11/11!
        // x^13 term
        term = (term * x2) / 1e18;
        sinApprox += term / 6227020800;   // add x^13/13!

        return sinApprox;
    }
}