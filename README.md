# Decentralized Derivatives Exchange Protocol

This work will be pivoting into (Now: Derisking Derivatives & Exchanges) for rate hedging.

---

**DDX** is a fully on-chain protocol for creating, trading, and settling **customizable financial derivatives**. The protocol offers three main contract types: **Options**, **Futures**, and **Genies** - each with multiple payoff curves and settlement mechanisms. All contracts are settled with decentralized oracles.

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- npm or pnpm
- MetaMask browser extension
- Sepolia testnet ETH (for testing)

### One-Command Setup
```bash
git clone <your-repo-url>
cd ddx-protocol
node setup.js
```

### Manual Setup
```bash
# 1. Clone the repository
git clone <your-repo-url>
cd ddx-protocol

# 2. Install all dependencies
npm run install-all

# 3. Configure environment
cp .env.example .env
# Edit .env with your RPC URL and private key

# 4. Start the application
npm run dev
```

### Access the Application
- **Frontend**: http://localhost:3000 (Next.js)
- **Backend API**: http://localhost:3001 (Express)

---

## 📝 Environment Configuration

1. **Get an Infura/Alchemy RPC URL** for Sepolia testnet
2. **Add a private key** for backend transaction signing (use a test wallet)
3. **Update contract addresses** in `.env` (pre-deployed on Sepolia)

---

## Key Features

- **Three Contract Types**: Options (call/put), Futures (linear/power/sigmoid), and Genies (sinusoidal/polynomial)
- **Multiple Payoff Curves**: Linear, quadratic, logarithmic, power, sigmoid, sinusoidal, and polynomial payoffs
- **Physical Settlement**: All contracts settled via delivery of the underlying asset based on oracle price feeds
- **Zero Premium**: Futures and Genies require no upfront premium payment (this will become optional for Genies)
- **Modular Architecture**: Factory pattern with minimal proxy contracts for gas efficiency
- **Oracle Integration**: Uses SimuOracle for price resolution at expiry
- **Modern Frontend**: Next.js with TypeScript, Tailwind CSS, and comprehensive UI components

---

## 🏛️ Protocol Architecture

### **Core Factory Contracts**

**OptionsBook.sol** - Options factory and registry
- Creates call and put option contracts with various payoff curves
- Supports linear, quadratic, and logarithmic payoff functions
- Manages premium payments and traditional option settlement
- Uses minimal proxy pattern (EIP-1167) for gas efficiency

**FuturesBook.sol** - Futures factory and registry  
- Creates linear, power, and sigmoid finite futures contracts
- Zero-premium contracts with symmetric payoffs
- Cash-settled based on |S-K| price differences
- Supports customizable power exponents and sigmoid intensity

**GenieBook.sol** - Advanced derivatives factory
- Creates sinusoidal and polynomial payoff contracts
- Zero-premium "Genie" contracts with exotic payoff curves
- Sinusoidal: sin-wave based payouts with configurable amplitude/period
- Polynomial: custom polynomial payoff functions

**SimuOracle.sol** - Price oracle (test)
- Provides price feeds for all contract types at expiration
- Supports multiple asset pairs with human-readable pricing
- Used for automated settlement across all contract types

### **Contract Lifecycle**

1. **Creation & Funding**: Maker creates contract and deposits collateral via respective Book
2. **Entry**: Taker enters the opposite side (premium for options, zero for futures/genies)
3. **Activation**: Contract becomes active with expiry countdown 
4. **Resolution**: Oracle price is fetched and stored on-chain at expiry
5. **Settlement**: 
   - **Options**: Traditional exercise/reclaim based on long/short perspective rsp.
   - **Futures**: Physical settlement based on |S-K| with winner-takes-all
   - **Genies**: Complex payoff calculation based on mathematical functions

### **Token Flow & Settlement**

**Options** (Premium required):
- **Call Options**: Short deposits underlying, long pays premium + exercise price
- **Put Options**: Short deposits strike tokens, long pays premium + underlying
- Settlement via traditional exercise/reclaim mechanism

**Futures** (Zero premium, physical delivery):
- Maker deposits either underlying OR strike tokens (depending on side)
- Taker enters opposite side with zero premium
- Settlement: Winner receives |S-K| * position size in underlying asset

**Genies** (Optional premium, exotic payoffs):
- Same funding model as futures
- Settlement based on complex mathematical functions:
  - **Sinusoidal**: Payout = amplitude * sin(2π * (S-K) / period)
  - **Polynomial**: Custom polynomial function evaluation

---

## 🏗️ Project Structure

```plaintext
ddx-protocol/
├── contracts/                      # Smart contracts by category
│   ├── core/                       # Factory contracts
│   │   ├── OptionsBook.sol         # Options factory and registry
│   │   ├── FuturesBook.sol         # Futures factory and registry  
│   │   └── GenieBook.sol           # Genies factory and registry
│   ├── options/                    # Option contract implementations
│   │   ├── calls/                  
│   │   │   ├── CallOptionContract.sol      # Standard call options
│   │   │   ├── QuadraticCallOption.sol     # Quadratic payoff calls
│   │   │   └── LogarithmicCallOption.sol   # Logarithmic payoff calls
│   │   └── puts/
│   │       ├── PutOptionContract.sol       # Standard put options
│   │       ├── QuadraticPutOption.sol      # Quadratic payoff puts
│   │       └── LogarithmicPutOption.sol    # Logarithmic payoff puts
│   ├── futures/                    # Futures contract implementations
│   │   ├── LinearFiniteFutures.sol         # Linear payoff futures
│   │   ├── PowerFiniteFutures.sol          # Power payoff futures
│   │   └── SigmoidFiniteFutures.sol        # Sigmoid payoff futures
│   ├── genies/                     # Genie contract implementations
│   │   ├── SinusoidalGenie.sol             # Sinusoidal payoff genies
│   │   └── hPolynomialGenie.sol            # Polynomial payoff genies
│   └── oracles/
│       └── SimuOracle.sol                  # Price oracle for settlement
│
├── utils/                          # Contract ABIs and utilities
│   ├── *BookABI.json               # Factory contract interfaces
│   ├── *OptionContractABI.json     # Option contract interfaces
│   ├── *FuturesABI.json            # Futures contract interfaces
│   ├── *GenieABI.json              # Genie contract interfaces
│   ├── SimuOracleABI.json          # Oracle interface
│   ├── MTKContractABI.json         # Strike token (MTK) interface
│   ├── TwoTKContractABI.json       # Underlying token (2TK) interface
│   ├── MyToken.sol                 # Test token implementations
│   └── DoubleToken.sol
│
├── frontend/                       # Next.js web application
│   ├── components/                 # React components
│   │   ├── ui/                     # Radix UI components (40+ components)
│   │   ├── hero-section.tsx        # Landing page hero
│   │   ├── trading-interface.tsx   # Main trading interface
│   │   ├── stats-section.tsx       # Statistics display
│   │   └── theme-provider.tsx      # Dark/light theme support
│   ├── hooks/                      # Custom React hooks
│   ├── lib/                        # Utility functions
│   ├── styles/                     # Tailwind CSS styles
│   └── package.json                # Next.js dependencies
│
├── backend/                        # Node.js Express API
│   ├── server.js                   # Main server and routes
│   ├── database.js                 # SQLite database operations
│   └── package.json                # Backend dependencies
│
├── script/                         # Deployment and utilities
│   ├── Deploy.s.sol                # Foundry deployment script
│   └── debug-exercise.js           # Testing utilities
│
├── .env.example                    # Environment configuration
├── foundry.toml                    # Foundry configuration
├── package.json                    # Root project configuration
└── README.md                       # This documentation
```

---

## 🧮 Contract Types & Payoff Formulas

### **Options (Premium Required)**
- **Linear Options**: Standard call/put with linear payoffs
- **Quadratic Options**: Payoff scales quadratically with price difference  
- **Logarithmic Options**: Payoff scales logarithmically with price difference

### **Futures (Zero Premium, Physical Delivery)**
- **Linear Futures**: Payout = |S - K| * position size
- **Power Futures**: Payout = |S - K|^n * position size (configurable exponent n)
- **Sigmoid Futures**: Payout follows sigmoid curve with configurable intensity

### **Genies (Zero Premium, Exotic Payoffs)**
- **Sinusoidal Genies**: Payout = amplitude * sin(2π * (S-K) / period) + c
  - Configurable amplitude (0-100% of notional)
  - Configurable period (wave frequency)
  - Configurable phase shift
- **Polynomial Genies**: Custom polynomial payoff functions
  - Configurable coefficients and degree

---

## 🔧 Technology Stack

- **Smart Contracts**: Solidity ^0.8.20, OpenZeppelin libraries
- **Development**: Foundry framework for testing and deployment
- **Frontend**: Next.js 15 with TypeScript, Tailwind CSS 4, Radix UI components
- **Backend**: Node.js/Express with SQLite database
- **Web3 Integration**: ethers.js v6 for blockchain interaction
- **UI Components**: 40+ Radix UI components with dark/light theme support
- **Network**: Sepolia testnet (production-ready for Ethereum)

---
