// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./SinusoidalGenie.sol";
import "./hPolynomialGenie.sol";

contract GenieBook {
    using SafeERC20 for IERC20;

    // Implementation addresses for different Genie payoff types
    address public sinusoidalGenieImpl;    // SinusoidalGenie implementation
    address public polynomialGenieImpl;    // PolynomialGenie implementation

    address[] public genieContracts;

    mapping(address => bool) public isKnownGenieClone;
    mapping(address => address) public longPosition;
    mapping(address => address) public shortPosition;

    struct GenieMeta {
        address genieAddress;

        address underlyingToken;
        address strikeToken;
        string underlyingSymbol;
        string strikeSymbol;

        uint256 strikePrice;     // fixed strike (1e18-scaled)
        uint256 positionSize;    // quantity of underlying (1e18 units)
        uint256 premium;         // always 0 for Genie contracts

        uint256 expiry;
        uint256 priceAtExpiry;
        uint256 exercisedAmount; // stored as "long's payout" reported by clone
        bool isExercised;
        bool isResolved;

        address long;
        address short;

        // e.g. "SinusoidalGenie" | "PolynomialGenie"
        string payoffType;
        uint8 payoffPower;       // unused (kept for struct compatibility)
    }

    mapping(address => GenieMeta) public genieMetadata;

    // Events for Genie contract creation and lifecycle
    event SinusoidalGenieCreated(
        address indexed creator,
        address indexed instance,
        bool makerIsLong,
        uint256 strikeNotional,
        uint256 positionSize,
        uint256 amplitude1e18,
        uint256 period1e18
    );

    event PolynomialGenieCreated(
        address indexed creator,
        address indexed instance,
        bool makerIsLong,
        uint256 strikeNotional,
        uint256 positionSize,
        uint256 fullPayLine1e18
    );

    // Shared events
    event GenieActivated(address indexed instance, address indexed long, address indexed short, uint256 expiry);

    /// @notice Emitted after net settlement is executed.
    /// @param instance The Genie clone.
    /// @param longPayout The long's *raw* payout reported by the clone (before netting).
    /// @param payer The address that actually paid after netting (0x0 if no net transfer).
    /// @param receiver The address that actually received after netting (0x0 if no net transfer).
    /// @param netAmount The net ERC20 amount moved (0 if perfectly balanced).
    event GenieExercised(address indexed instance, uint256 longPayout, address payer, address receiver, uint256 netAmount);

    constructor(address _sinusoidalGenieImpl, address _polynomialGenieImpl) {
        sinusoidalGenieImpl = _sinusoidalGenieImpl;
        polynomialGenieImpl = _polynomialGenieImpl;
    }

    // ------------------------------------------------------------------------
    // SINUSOIDAL GENIE
    // ------------------------------------------------------------------------
    function createAndFundSinusoidalGenie(
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
        uint256 _amplitude1e18,
        uint256 _period1e18
    ) external returns (address clone) {
        require(_premiumMustBe0 == 0, "GENIE: premium must be 0");
        require(sinusoidalGenieImpl != address(0), "Sinusoidal impl not set");

        clone = Clones.clone(sinusoidalGenieImpl);
        SinusoidalGenie(clone).initialize(
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

        // Configure sinusoidal params before funding
        SinusoidalGenie(clone).setSinusoidalParameters(_amplitude1e18, _period1e18);

        // Move maker funding into the clone
        if (_makerIsLong) {
            IERC20(_strikeToken).safeTransferFrom(msg.sender, clone, _strikeNotional);
        } else {
            IERC20(_underlyingToken).safeTransferFrom(msg.sender, clone, _positionSize);
        }

        // Lock strike & set expiry on the clone
        SinusoidalGenie(clone).fund(_strikeNotional, _expirySeconds);

        uint256 fixedStrike = _readStrike(clone);

        // Register
        genieContracts.push(clone);
        isKnownGenieClone[clone] = true;
        if (_makerIsLong) {
            longPosition[clone] = msg.sender;
        } else {
            shortPosition[clone] = msg.sender;
        }

        genieMetadata[clone] = GenieMeta({
            genieAddress: clone,
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
            long: _makerIsLong ? msg.sender : address(0),
            short: _makerIsLong ? address(0) : msg.sender,
            payoffType: "SinusoidalGenie",
            payoffPower: 0
        });

        emit SinusoidalGenieCreated(
            msg.sender,
            clone,
            _makerIsLong,
            _strikeNotional,
            _positionSize,
            _amplitude1e18,
            _period1e18
        );
    }

    // ------------------------------------------------------------------------
    // POLYNOMIAL GENIE
    // ------------------------------------------------------------------------
    function createAndFundPolynomialGenie(
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
        uint256 _fullPayLine1e18
    ) external returns (address clone) {
        require(_premiumMustBe0 == 0, "GENIE: premium must be 0");
        require(polynomialGenieImpl != address(0), "Polynomial impl not set");

        clone = Clones.clone(polynomialGenieImpl);
        PolynomialGenie(clone).initialize(
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

        // Set the ONLY parameter: the vertical 100%-line L
        PolynomialGenie(clone).setFullPayLine(_fullPayLine1e18);

        // Maker funding into the clone
        if (_makerIsLong) {
            IERC20(_strikeToken).safeTransferFrom(msg.sender, clone, _strikeNotional);
        } else {
            IERC20(_underlyingToken).safeTransferFrom(msg.sender, clone, _positionSize);
        }

        // Lock strike & set expiry on the clone
        PolynomialGenie(clone).fund(_strikeNotional, _expirySeconds);

        uint256 fixedStrike = _readStrike(clone);

        // Register
        genieContracts.push(clone);
        isKnownGenieClone[clone] = true;
        if (_makerIsLong) {
            longPosition[clone] = msg.sender;
        } else {
            shortPosition[clone] = msg.sender;
        }

        genieMetadata[clone] = GenieMeta({
            genieAddress: clone,
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
            long: _makerIsLong ? msg.sender : address(0),
            short: _makerIsLong ? address(0) : msg.sender,
            payoffType: "PolynomialGenie",
            payoffPower: 0
        });

        emit PolynomialGenieCreated(
            msg.sender,
            clone,
            _makerIsLong,
            _strikeNotional,
            _positionSize,
            _fullPayLine1e18
        );
    }

    // ------------------------------------------------------------------------
    // SHARED LOGIC FOR ENTRY AND SETTLEMENT
    // ------------------------------------------------------------------------
    function enterAndPayPremium(address genieAddress, uint256 premiumAmount) external {
        require(isKnownGenieClone[genieAddress], "Unknown Genie");
        require(premiumAmount == 0, "GENIE: premium must be 0");

        GenieMeta storage meta = genieMetadata[genieAddress];
        bool longVacant = (meta.long == address(0));
        bool shortVacant = (meta.short == address(0));
        require(longVacant || shortVacant, "Already entered");

        if (longVacant && !shortVacant) {
            meta.long = msg.sender;
        } else if (shortVacant && !longVacant) {
            meta.short = msg.sender;
        } else {
            // If both positions were vacant (shouldn't happen), default to long
            meta.long = msg.sender;
        }

        // Trigger entry on the clone
        (bool okEnter, ) = genieAddress.call(abi.encodeWithSignature("enterAsLong(address)", msg.sender));
        require(okEnter, "enterAsLong failed");

        // Fetch participants and expiry from the clone
        (bool okL, bytes memory dataL) = genieAddress.call(abi.encodeWithSignature("long()"));
        require(okL, "long() failed");
        address finalLong = abi.decode(dataL, (address));

        (bool okS, bytes memory dataS) = genieAddress.call(abi.encodeWithSignature("short()"));
        require(okS, "short() failed");
        address finalShort = abi.decode(dataS, (address));

        (bool okE, bytes memory dataE) = genieAddress.call(abi.encodeWithSignature("expiry()"));
        require(okE, "expiry() failed");
        uint256 finalExpiry = abi.decode(dataE, (uint256));

        meta.long = finalLong;
        meta.short = finalShort;
        meta.expiry = finalExpiry;
        longPosition[genieAddress] = finalLong;
        shortPosition[genieAddress] = finalShort;

        emit GenieActivated(genieAddress, finalLong, finalShort, finalExpiry);
    }

    function resolveAndExercise(address genieAddress, uint256 /* amountIn */) external {
        require(isKnownGenieClone[genieAddress], "Unknown Genie");

        GenieMeta storage meta = genieMetadata[genieAddress];
        require(msg.sender == meta.long || msg.sender == meta.short, "Not a party");

        if (!meta.isResolved) {
            (bool s1, ) = genieAddress.call(abi.encodeWithSignature("resolve()"));
            require(s1, "resolve() failed");

            (bool ok, bytes memory data) = genieAddress.call(abi.encodeWithSignature("priceAtExpiry()"));
            require(ok, "priceAtExpiry() failed");
            meta.priceAtExpiry = abi.decode(data, (uint256));
            meta.isResolved = true;
        }

        // Long side attempts to exercise (payout determined in clone)
        (bool s2, ) = genieAddress.call(abi.encodeWithSignature("exercise(uint256,address)", 0, meta.long));
        require(s2, "exercise() failed");
    }

    function resolveAndReclaim(address genieAddress) external {
        require(isKnownGenieClone[genieAddress], "Unknown Genie");
        require(msg.sender == shortPosition[genieAddress], "Not authorized");

        GenieMeta storage meta = genieMetadata[genieAddress];

        if (!meta.isResolved) {
            (bool s1, ) = genieAddress.call(abi.encodeWithSignature("resolve()"));
            require(s1, "resolve() failed");

            (bool ok, bytes memory data) = genieAddress.call(abi.encodeWithSignature("priceAtExpiry()"));
            require(ok, "priceAtExpiry() failed");
            meta.priceAtExpiry = abi.decode(data, (uint256));
            meta.isResolved = true;
        }

        // Short side reclaims if long never exercised (contract expired without exercise)
        (bool s2, ) = genieAddress.call(abi.encodeWithSignature("reclaim(address)", msg.sender));
        require(s2, "reclaim() failed");
    }

    /**
     * @notice Called by Genie clones during settlement with the **long's payout** in strike tokens.
     * We compute the **net** transfer vs. the short's payout (= notional - longPayout)
     * and move only the difference:
     *   - if longPayout > shortPayout: transfer (longPayout - shortPayout) from SHORT -> LONG
     *   - if shortPayout > longPayout: transfer (shortPayout - longPayout) from LONG -> SHORT
     *   - equal => no net transfer
     *
     * IMPORTANT: Both parties must have granted allowance to this Book for the strike token.
     */
    function notifyExercised(uint256 longPayout) external {
        require(isKnownGenieClone[msg.sender], "Unknown Genie");

        GenieMeta storage meta = genieMetadata[msg.sender];
        require(!meta.isExercised, "Already exercised");

        // Record raw long payout
        meta.isExercised = true;
        meta.exercisedAmount = longPayout;

        // Compute notional in strike tokens (1e18 scale)
        uint256 notional = (meta.strikePrice * meta.positionSize) / 1e18;

        // Safety clamps
        if (longPayout > notional) {
            longPayout = notional;
        }

        uint256 shortPayout = notional - longPayout;

        address payer = address(0);
        address receiver = address(0);
        uint256 net;

        if (longPayout > shortPayout) {
            // Short owes Long
            net = longPayout - shortPayout;
            payer = meta.short;
            receiver = meta.long;
        } else if (shortPayout > longPayout) {
            // Long owes Short
            net = shortPayout - longPayout;
            payer = meta.long;
            receiver = meta.short;
        } else {
            net = 0;
        }

        if (net > 0) {
            IERC20(meta.strikeToken).safeTransferFrom(payer, address(this), net);
            IERC20(meta.strikeToken).safeTransfer(receiver, net);
        }

        emit GenieExercised(msg.sender, longPayout, payer, receiver, net);
    }

    // Helper to read the strike price from a clone (after funding)
    function _readStrike(address genie) internal view returns (uint256 strike) {
        (bool ok, bytes memory data) = genie.staticcall(abi.encodeWithSignature("strikePrice()"));
        require(ok && data.length == 32, "read strike failed");
        strike = abi.decode(data, (uint256));
    }

    // View functions
    function getAllGenies() external view returns (address[] memory) {
        return genieContracts;
    }

    function getGenieMeta(address genieAddress) external view returns (GenieMeta memory) {
        return genieMetadata[genieAddress];
    }

    // Optional admin setters for impl addresses (add access control as needed)
    function setSinusoidalImpl(address _impl) external {
        sinusoidalGenieImpl = _impl;
    }

    function setPolynomialImpl(address _impl) external {
        polynomialGenieImpl = _impl;
    }
}
