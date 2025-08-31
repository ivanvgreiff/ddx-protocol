// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../futures/LinearFiniteFutures.sol";
import "../futures/PowerFiniteFutures.sol";
import "../futures/SigmoidFiniteFutures.sol";

contract FuturesBook {
    using SafeERC20 for IERC20;

    // Implementation addresses
    address public futuresImpl;        // linear impl
    address public powerFuturesImpl;   // power impl
    address public sigmoidFuturesImpl; // sigmoid impl   <-- NEW

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

        uint256 strikePrice;   // fixed strike determined from funding
        uint256 positionSize;  // quantity (1e18 units)
        uint256 premium;       // always 0 for futures

        uint256 expiry;
        uint256 priceAtExpiry;
        uint256 exercisedAmount;
        bool isExercised;
        bool isResolved;

        address long;
        address short;

        string payoffType;     // "LinearFiniteFutures" | "PowerFiniteFutures" | "SigmoidFiniteFutures"
        uint8 payoffPower;     // 1 for linear, N>=1 for power, 0 for sigmoid (unused)
    }

    mapping(address => FuturesMeta) public futuresMetadata;

    // Events (renamed for clarity)
    event LinearFuturesCreated(
        address indexed creator,
        address indexed instance,
        bool makerIsLong,
        uint256 strikeNotional,
        uint256 positionSize
    );

    event PowerFuturesCreated(
        address indexed creator,
        address indexed instance,
        bool makerIsLong,
        uint256 strikeNotional,
        uint256 positionSize,
        uint8 payoffPower
    );

    // NEW: Sigmoid event
    event SigmoidFuturesCreated(
        address indexed creator,
        address indexed instance,
        bool makerIsLong,
        uint256 strikeNotional,
        uint256 positionSize,
        uint256 intensity1e18
    );

    // Shared events (apply to all types)
    event FutureActivated(address indexed instance, address indexed long, address indexed short, uint256 expiry);
    event FutureExercised(address indexed instance, uint256 strikeTokenAmount);

    // NOTE: constructor signature changed to add _sigmoidFuturesImpl
    constructor(address _futuresImpl, address _powerFuturesImpl, address _sigmoidFuturesImpl) {
        futuresImpl = _futuresImpl;
        powerFuturesImpl = _powerFuturesImpl;
        sigmoidFuturesImpl = _sigmoidFuturesImpl; // NEW
    }

    // ------------------------------------------------------------------------
    // LINEAR FUTURES (unchanged)
    // ------------------------------------------------------------------------
    function createAndFundLinearFuture(
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _positionSize,
        uint256 _premiumMustBe0,
        address _oracle,
        uint256 _strikeNotional,
        bool _makerIsLong,
        uint256 _expirySeconds
    ) external returns (address clone) {
        require(_premiumMustBe0 == 0, "FUT: premium must be 0");

        clone = Clones.clone(futuresImpl);

        LinearFiniteFutures(clone).initialize(
            msg.sender,
            _underlyingToken,
            _strikeToken,
            _underlyingSymbol,
            _strikeSymbol,
            _makerIsLong ? 1 : 0,
            _positionSize,
            0,
            _oracle,
            address(this)
        );

        if (_makerIsLong) {
            IERC20(_strikeToken).safeTransferFrom(msg.sender, clone, _strikeNotional);
        } else {
            IERC20(_underlyingToken).safeTransferFrom(msg.sender, clone, _positionSize);
        }

        LinearFiniteFutures(clone).fund(_strikeNotional, _expirySeconds);

        uint256 fixedStrike = _readStrike(clone);

        futuresContracts.push(clone);
        isKnownClone[clone] = true;
        if (_makerIsLong) {
            longPosition[clone] = msg.sender;
        } else {
            shortPosition[clone] = msg.sender;
        }

        futuresMetadata[clone] = FuturesMeta({
            futureAddress: clone,
            underlyingToken: _underlyingToken,
            strikeToken: _strikeToken,
            underlyingSymbol: _underlyingSymbol,
            strikeSymbol: _strikeSymbol,
            strikePrice: fixedStrike,
            positionSize: _positionSize,
            premium: 0,
            expiry: 0,
            priceAtExpiry: 0,
            exercisedAmount: 0,
            isExercised: false,
            isResolved: false,
            long:  _makerIsLong ? msg.sender : address(0),
            short: _makerIsLong ? address(0)  : msg.sender,
            payoffType: "LinearFiniteFutures",
            payoffPower: 1
        });

        emit LinearFuturesCreated(msg.sender, clone, _makerIsLong, _strikeNotional, _positionSize);
    }

    // ------------------------------------------------------------------------
    // POWER FUTURES (unchanged)
    // ------------------------------------------------------------------------
    function createAndFundPowerFuture(
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _positionSize,
        uint256 _premiumMustBe0,
        address _oracle,
        uint256 _strikeNotional,
        bool _makerIsLong,
        uint256 _expirySeconds,
        uint8 _power
    ) external returns (address clone) {
        require(_premiumMustBe0 == 0, "FUT: premium must be 0");
        require(_power >= 1, "FUT: invalid power");

        clone = Clones.clone(powerFuturesImpl);

        PowerFiniteFutures(clone).initialize(
            msg.sender,
            _underlyingToken,
            _strikeToken,
            _underlyingSymbol,
            _strikeSymbol,
            _makerIsLong ? 1 : 0,
            _positionSize,
            0,
            _oracle,
            address(this)
        );

        PowerFiniteFutures(clone).setPayoffPower(_power);

        if (_makerIsLong) {
            IERC20(_strikeToken).safeTransferFrom(msg.sender, clone, _strikeNotional);
        } else {
            IERC20(_underlyingToken).safeTransferFrom(msg.sender, clone, _positionSize);
        }

        PowerFiniteFutures(clone).fund(_strikeNotional, _expirySeconds);

        uint256 fixedStrike = _readStrike(clone);

        futuresContracts.push(clone);
        isKnownClone[clone] = true;
        if (_makerIsLong) {
            longPosition[clone] = msg.sender;
        } else {
            shortPosition[clone] = msg.sender;
        }

        futuresMetadata[clone] = FuturesMeta({
            futureAddress: clone,
            underlyingToken: _underlyingToken,
            strikeToken: _strikeToken,
            underlyingSymbol: _underlyingSymbol,
            strikeSymbol: _strikeSymbol,
            strikePrice: fixedStrike,
            positionSize: _positionSize,
            premium: 0,
            expiry: 0,
            priceAtExpiry: 0,
            exercisedAmount: 0,
            isExercised: false,
            isResolved: false,
            long:  _makerIsLong ? msg.sender : address(0),
            short: _makerIsLong ? address(0)  : msg.sender,
            payoffType: "PowerFiniteFutures",
            payoffPower: _power
        });

        emit PowerFuturesCreated(msg.sender, clone, _makerIsLong, _strikeNotional, _positionSize, _power);
    }

    // ------------------------------------------------------------------------
    // SIGMOID FUTURES (NEW)
    // ------------------------------------------------------------------------
    function createAndFundSigmoidFuture(
        address _underlyingToken,
        address _strikeToken,
        string memory _underlyingSymbol,
        string memory _strikeSymbol,
        uint256 _positionSize,
        uint256 _premiumMustBe0,
        address _oracle,
        uint256 _strikeNotional,
        bool _makerIsLong,
        uint256 _expirySeconds,
        uint256 _intensity1e18               // I, 1e18-scaled
    ) external returns (address clone) {
        require(_premiumMustBe0 == 0, "FUT: premium must be 0");

        clone = Clones.clone(sigmoidFuturesImpl);

        SigmoidFiniteFutures(clone).initialize(
            msg.sender,
            _underlyingToken,
            _strikeToken,
            _underlyingSymbol,
            _strikeSymbol,
            _makerIsLong ? 1 : 0,
            _positionSize,
            0,
            _oracle,
            address(this)
        );

        // Set intensity before funding
        SigmoidFiniteFutures(clone).setSigmoidIntensity(_intensity1e18);

        // Pull maker funding (same pattern as others)
        if (_makerIsLong) {
            IERC20(_strikeToken).safeTransferFrom(msg.sender, clone, _strikeNotional);
        } else {
            IERC20(_underlyingToken).safeTransferFrom(msg.sender, clone, _positionSize);
        }

        SigmoidFiniteFutures(clone).fund(_strikeNotional, _expirySeconds);

        uint256 fixedStrike = _readStrike(clone);

        futuresContracts.push(clone);
        isKnownClone[clone] = true;
        if (_makerIsLong) {
            longPosition[clone] = msg.sender;
        } else {
            shortPosition[clone] = msg.sender;
        }

        futuresMetadata[clone] = FuturesMeta({
            futureAddress: clone,
            underlyingToken: _underlyingToken,
            strikeToken: _strikeToken,
            underlyingSymbol: _underlyingSymbol,
            strikeSymbol: _strikeSymbol,
            strikePrice: fixedStrike,
            positionSize: _positionSize,
            premium: 0,
            expiry: 0,
            priceAtExpiry: 0,
            exercisedAmount: 0,
            isExercised: false,
            isResolved: false,
            long:  _makerIsLong ? msg.sender : address(0),
            short: _makerIsLong ? address(0)  : msg.sender,
            payoffType: "SigmoidFiniteFutures",
            payoffPower: 0 // not used for sigmoid
        });

        emit SigmoidFuturesCreated(msg.sender, clone, _makerIsLong, _strikeNotional, _positionSize, _intensity1e18);
    }

    // ------------------------------------------------------------------------
    // SHARED LOGIC (unchanged)
    // ------------------------------------------------------------------------
    function enterAndPayPremium(address futureAddress, uint256 premiumAmount) external {
        require(isKnownClone[futureAddress], "Unknown future");
        require(premiumAmount == 0, "FUT: premium must be 0");

        FuturesMeta storage meta = futuresMetadata[futureAddress];

        bool longVacant = (meta.long == address(0));
        bool shortVacant = (meta.short == address(0));
        require(longVacant || shortVacant, "Already entered");

        if (longVacant && !shortVacant) {
            meta.long = msg.sender;
        } else if (shortVacant && !longVacant) {
            meta.short = msg.sender;
        } else {
            meta.long = msg.sender;
        }

        (bool okEnter, ) = futureAddress.call(abi.encodeWithSignature("enterAsLong(address)", msg.sender));
        require(okEnter, "enterAsLong failed");

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

    function notifyExercised(uint256 strikeTokenAmount) external {
        require(isKnownClone[msg.sender], "Unknown future");

        FuturesMeta storage meta = futuresMetadata[msg.sender];
        require(!meta.isExercised, "Already marked exercised");

        meta.isExercised = true;
        meta.exercisedAmount = strikeTokenAmount;

        bool longWins = (meta.priceAtExpiry > meta.strikePrice);
        address payer = longWins ? meta.short : meta.long;
        address receiver = longWins ? meta.long : meta.short;

        if (strikeTokenAmount > 0) {
            IERC20(meta.strikeToken).safeTransferFrom(payer, address(this), strikeTokenAmount);
            IERC20(meta.strikeToken).safeTransfer(receiver, strikeTokenAmount);
        }

        emit FutureExercised(msg.sender, strikeTokenAmount);
    }

    // Helpers
    function _readStrike(address future) internal view returns (uint256 strike) {
        (bool ok, bytes memory data) = future.staticcall(
            abi.encodeWithSignature("strikePrice()")
        );
        require(ok && data.length == 32, "read strike failed");
        strike = abi.decode(data, (uint256));
    }

    function getAllFutures() external view returns (address[] memory) {
        return futuresContracts;
    }

    function getFuturesMeta(address futureAddress) external view returns (FuturesMeta memory) {
        return futuresMetadata[futureAddress];
    }
}
