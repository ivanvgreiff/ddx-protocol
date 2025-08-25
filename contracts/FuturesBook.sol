// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./LinearFiniteFutures.sol";

contract FuturesBook {
    using SafeERC20 for IERC20;

    address public futuresImpl;

    address[] public futuresContracts;

    mapping(address => bool) public isKnownClone;
    mapping(address => address) public longPosition;
    mapping(address => address) public shortPosition;

    struct FuturesMeta {
        address futureAddress;

        address underlyingToken;
        address strikeToken;
        string underlyingSymbol;
        string strikeSymbol;

        // strikePrice stores the FIXED strike determined from funding (1e18)
        uint256 strikePrice;
        // optionSize stores QUANTITY (1e18 underlying units)
        uint256 optionSize;
        // premium kept for parity; always 0 for futures
        uint256 premium;

        uint256 expiry;
        uint256 priceAtExpiry;
        uint256 exercisedAmount;
        bool isExercised;
        bool isResolved;

        address long;
        address short;

        string payoffType; // "LinearFiniteFutures"
    }

    mapping(address => FuturesMeta) public futuresMetadata;

    event FutureCreated(
        address indexed creator,
        address indexed instance,
        string futureType,
        bool makerIsLong,
        uint256 strikeNotional,
        uint256 optionSize
    );
    event FutureActivated(address indexed instance, address indexed long, address indexed short, uint256 expiry);
    event FutureExercised(address indexed instance, uint256 strikeTokenAmount);

    constructor(address _futuresImpl) {
        futuresImpl = _futuresImpl;
    }

    /**
     * @notice Maker creates and funds a futures contract (no premiums, no collateral matching).
     *
     * Funding rules (mirrors Options model):
     * - If maker wants LONG  → maker funds with STRIKE tokens equal to strikeNotional (= desiredStrike * optionSize).
     * - If maker wants SHORT → maker funds with UNDERLYING tokens equal to optionSize.
     *
     * The fixed strike is computed from the given strikeNotional:
     *   strikePrice = (strikeNotional * 1e18) / optionSize
     *
     * @param _underlyingToken  ERC20 of the underlying
     * @param _strikeToken      ERC20 of the strike token (e.g., USDC)
     * @param _underlyingSymbol Symbol string used by the oracle
     * @param _strikeSymbol     Symbol string used by the oracle
     * @param _optionSize       size in 1e18 underlying units
     * @param _premiumMustBe0   must be 0 for futures
     * @param _oracle           oracle address
     * @param _strikeNotional   amount in strike tokens used to compute strike (desiredStrike * optionSize)
     * @param _makerIsLong      whether the maker wants to be the long at activation
     * @param _expirySeconds    maker-chosen time-to-expiry applied when the counterparty enters
     */
    function createAndFundLinearFuture(
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _optionSize,
        uint256 _premiumMustBe0,
        address _oracle,
        uint256 _strikeNotional,
        bool _makerIsLong,
        uint256 _expirySeconds
    ) external returns (address clone) {
        require(_premiumMustBe0 == 0, "FUT: premium must be 0");
        require(_optionSize > 0, "FUT: size=0");
        require(_strikeNotional > 0, "FUT: strikeNotional=0");
        require(_expirySeconds > 0, "FUT: expirySeconds=0");

        clone = Clones.clone(futuresImpl);

        // Initialize (flag only for side; strike set on fund)
        LinearFiniteFutures(clone).initialize(
            msg.sender, // maker recorded as initial "short" var for parity
            _underlyingToken,
            _strikeToken,
            _underlyingSymbol,
            _strikeSymbol,
            _makerIsLong ? 1 : 0,
            _optionSize,
            0, // premium is always 0 for futures
            _oracle,
            address(this)
        );

        // Pull maker funding into the instance:
        if (_makerIsLong) {
            // LONG maker funds with STRIKE tokens (strikeNotional)
            IERC20(_strikeToken).safeTransferFrom(msg.sender, clone, _strikeNotional);
        } else {
            // SHORT maker funds with UNDERLYING tokens (optionSize)
            IERC20(_underlyingToken).safeTransferFrom(msg.sender, clone, _optionSize);
        }

        // Tell the instance to finalize funding, fix the strike, and store maker's desired expiry seconds.
        LinearFiniteFutures(clone).fund(_strikeNotional, _expirySeconds);

        futuresContracts.push(clone);
        isKnownClone[clone] = true;

        // Temporarily set maker as short; true mapping is fixed after enter()
        shortPosition[clone] = msg.sender;

        // Record metadata now (strikePrice will be read after activation to stay consistent)
        futuresMetadata[clone] = FuturesMeta({
            futureAddress: clone,
            underlyingToken: _underlyingToken,
            strikeToken: _strikeToken,
            underlyingSymbol: _underlyingSymbol,
            strikeSymbol: _strikeSymbol,
            strikePrice: 0, // will read from instance after enter
            optionSize: _optionSize,
            premium: 0,
            expiry: 0,
            priceAtExpiry: 0,
            exercisedAmount: 0,
            isExercised: false,
            isResolved: false,
            long: address(0),
            short: msg.sender,
            payoffType: "LinearFiniteFutures"
        });

        emit FutureCreated(msg.sender, clone, "LINEAR_FUT", _makerIsLong, _strikeNotional, _optionSize);
    }

    /**
     * @notice Counterparty enters. For futures, premium is always 0.
     * Keep the same signature style as options but the amount must be 0.
     */
    function enterAndPayPremium(address futureAddress, uint256 premiumAmount) external {
        require(isKnownClone[futureAddress], "Unknown future");
        require(premiumAmount == 0, "FUT: premium must be 0");

        FuturesMeta storage meta = futuresMetadata[futureAddress];
        require(meta.long == address(0), "Already entered");

        // Tentative long = msg.sender (instance will assign roles per maker flag)
        meta.long = msg.sender;

        // Activate in the instance (no token movement here)
        LinearFiniteFutures(futureAddress).enterAsLong(msg.sender);

        // Sync metadata from instance
        (bool okP, bytes memory dataP) = futureAddress.call(abi.encodeWithSignature("strikePrice()"));
        require(okP, "strikePrice() failed");
        meta.strikePrice = abi.decode(dataP, (uint256));

        (bool okL, bytes memory dataL) = futureAddress.call(abi.encodeWithSignature("long()"));
        require(okL, "long() failed");
        address finalLong = abi.decode(dataL, (address));

        (bool okS, bytes memory dataS) = futureAddress.call(abi.encodeWithSignature("short()"));
        require(okS, "short() failed");
        address finalShort = abi.decode(dataS, (address));

        (bool okE, bytes memory dataE) = futureAddress.call(abi.encodeWithSignature("expiry()"));
        require(okE, "expiry() failed");
        uint256 finalExpiry = abi.decode(dataE, (uint256));

        meta.long = finalLong;
        meta.short = finalShort;
        meta.expiry = finalExpiry;

        longPosition[futureAddress] = finalLong;
        shortPosition[futureAddress] = finalShort;

        emit FutureActivated(futureAddress, finalLong, finalShort, finalExpiry);
    }

    function resolveAndExercise(address futureAddress, uint256 /* amountIn */) external {
        require(isKnownClone[futureAddress], "Unknown future");

        FuturesMeta storage meta = futuresMetadata[futureAddress];
        // Either party may trigger settlement per your spec ("Either party can call resolveAndExercise()")
        require(msg.sender == meta.long || msg.sender == meta.short, "Not a party");

        if (!meta.isResolved) {
            (bool s1, ) = futureAddress.call(abi.encodeWithSignature("resolve()"));
            require(s1, "resolve() failed");

            (bool ok, bytes memory data) = futureAddress.call(abi.encodeWithSignature("priceAtExpiry()"));
            require(ok, "priceAtExpiry() failed");
            meta.priceAtExpiry = abi.decode(data, (uint256));
            meta.isResolved = true;
        }

        (bool s2, ) = futureAddress.call(
            abi.encodeWithSignature("exercise(uint256,address)", 0, meta.long)
        );
        require(s2, "exercise() failed");
    }

    function resolveAndReclaim(address futureAddress) external {
        require(isKnownClone[futureAddress], "Unknown future");
        require(msg.sender == shortPosition[futureAddress], "Not authorized");

        FuturesMeta storage meta = futuresMetadata[futureAddress];

        if (!meta.isResolved) {
            (bool s1, ) = futureAddress.call(abi.encodeWithSignature("resolve()"));
            require(s1, "resolve() failed");

            (bool ok, bytes memory data) = futureAddress.call(abi.encodeWithSignature("priceAtExpiry()"));
            require(ok, "priceAtExpiry() failed");
            meta.priceAtExpiry = abi.decode(data, (uint256));
            meta.isResolved = true;
        }

        (bool s2, ) = futureAddress.call(abi.encodeWithSignature("reclaim(address)", msg.sender));
        require(s2, "reclaim() failed");
    }

    /**
     * Instance reports absolute payout in strike token.
     * We move funds loser → winner by pulling from the payer and forwarding to receiver.
     */
    function notifyExercised(uint256 strikeTokenAmount) external {
        require(isKnownClone[msg.sender], "Unknown future");

        FuturesMeta storage meta = futuresMetadata[msg.sender];
        require(!meta.isExercised, "Already marked exercised");

        meta.isExercised = true;
        meta.exercisedAmount = strikeTokenAmount;

        bool longWins = (meta.priceAtExpiry >= meta.strikePrice);
        address payer = longWins ? meta.short : meta.long;
        address receiver = longWins ? meta.long : meta.short;

        if (strikeTokenAmount > 0) {
            IERC20(meta.strikeToken).safeTransferFrom(payer, address(this), strikeTokenAmount);
            IERC20(meta.strikeToken).safeTransfer(receiver, strikeTokenAmount);
        }

        emit FutureExercised(msg.sender, strikeTokenAmount);
    }

    function isKnownFuture(address query) public view returns (bool) {
        return isKnownClone[query];
    }

    function getAllFutures() external view returns (address[] memory) {
        return futuresContracts;
    }

    function getFuturesMeta(address futureAddress) external view returns (FuturesMeta memory) {
        return futuresMetadata[futureAddress];
    }
}
