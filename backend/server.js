const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');
require('dotenv').config({ path: '../.env' });

// Simple in-memory cache for factory contracts
const factoryCache = {
  data: null,
  timestamp: 0,
  ttl: 60000 // 60 seconds cache
};

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);






// FIX DATA INTEGRITY FOR EXERCISED CONTRACTS
app.post('/api/admin/fix-exercised-data', async (req, res) => {
  console.log('FIXING EXERCISED DATA INTEGRITY');
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    // Find all contracts that are marked as exercised but don't have exercised_at timestamp
    const contracts = await resolutionService.db.getAllContracts();
    let fixedCount = 0;
    
    for (const contract of contracts) {
      if (contract.is_exercised && !contract.exercised_at) {
        console.log(`Fixing exercised_at for contract ${contract.address}`);
        
        // Set exercised_at to the resolved_at time (best guess) or current time
        const exercisedAt = contract.resolved_at || new Date().toISOString();
        
        await resolutionService.db.updateContract(contract.address, {
          exercised_at: exercisedAt
        });
        
        fixedCount++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `Fixed exercised_at timestamps for ${fixedCount} contracts`
    });
  } catch (error) {
    console.error('Error fixing exercised data:', error);
    res.status(500).json({ error: 'Failed to fix exercised data' });
  }
});

// SYNC DATABASE WITH BLOCKCHAIN STATE

// Blockchain setup
let provider;
let signer;

// Initialize blockchain connection
async function initializeBlockchain() {
  try {
    // Connect to configured RPC endpoint
    const rpcUrl = process.env.RPC_URL || 'https://your-rpc-endpoint.com';
    console.log('Attempting to connect to RPC URL:', rpcUrl);
    
    // Create provider without ENS resolution
    provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // Test the connection
    const network = await provider.getNetwork();
    console.log('Connected to blockchain network:', network.name, 'Chain ID:', network.chainId);
    
  } catch (error) {
    console.error('Failed to connect to blockchain:', error);
    console.error('Provider will be undefined - blockchain operations will fail');
  }
}

// Contract ABIs (you'll need to import these from your compiled contracts)
const CallOptionContractABI = require('../utils/CallOptionContractABI.json');
const PutOptionContractABI = require('../utils/PutOptionContractABI.json');
const OptionsBookABI = require('../utils/OptionsBookABI.json');
const SimuOracleABI = require('../utils/SimuOracleABI.json');
const MTKABI = require('../utils/MTKContractABI.json');
const TwoTKABI = require('../utils/TwoTKContractABI.json');
const FuturesBookABI = require('../utils/FuturesBookABI.json');
const LinearFiniteFuturesABI = require('../utils/LinearFiniteFuturesABI.json');
const GenieBookABI = require('../utils/GenieBookABI.json');
const PolynomialGenieABI = require('../utils/PolynomialGenieABI.json');

// Utility function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry function with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimitError = error.message.includes('Too Many Requests') || 
                              error.message.includes('-32005') ||
                              error.code === 'BAD_DATA';
      
      if (isRateLimitError && attempt < maxRetries) {
        const delayMs = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`⏳ Rate limit hit, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);
        await delay(delayMs);
        continue;
      }
      throw error;
    }
  }
}

// Helper function to determine contract type and get appropriate ABI
async function getContractTypeAndABI(contractAddress) {
  try {
    
    // First try to check if it's a known option in the OptionsBook
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    
    const isCallOption = await optionsBookContract.isCallOption(contractAddress);
    
    if (isCallOption) {
      return { type: 'call', abi: CallOptionContractABI };
    } else {
      return { type: 'put', abi: PutOptionContractABI };
    }
  } catch (error) {
    console.error('❌ Error determining contract type:', error);
    console.error('❌ Error message:', error.message);
    console.log('🔄 Defaulting to call option ABI');
    // Default to call option ABI if we can't determine the type
    return { type: 'call', abi: CallOptionContractABI };
  }
}

// Contract addresses from environment (NO FALLBACKS - MUST BE IN .env)
const OPTIONSBOOK_ADDRESS = process.env.OPTIONS_BOOK;
const CALL_IMPL_ADDRESS = process.env.CALL_OPTION_IMPL;
const PUT_IMPL_ADDRESS = process.env.PUT_OPTION_IMPL;
const FUTURESBOOK_ADDRESS = process.env.FUTURES_BOOK;
const LINEAR_FINITE_FUTURES_ADDRESS = process.env.LINEAR_FINITE_FUTURES;
const GENIEBOOK_ADDRESS = process.env.GENIE_BOOK;

// Validate that all required addresses are provided
if (!OPTIONSBOOK_ADDRESS) {
  console.error('❌ OPTIONS_BOOK not found in environment variables');
  process.exit(1);
}
if (!CALL_IMPL_ADDRESS) {
  console.error('❌ CALL_OPTION_IMPL not found in environment variables');
  process.exit(1);
}
if (!PUT_IMPL_ADDRESS) {
  console.error('❌ PUT_OPTION_IMPL not found in environment variables');
  process.exit(1);
}
if (!FUTURESBOOK_ADDRESS) {
  console.error('❌ FUTURES_BOOK not found in environment variables');
  process.exit(1);
}
if (!LINEAR_FINITE_FUTURES_ADDRESS) {
  console.error('❌ LINEAR_FINITE_FUTURES not found in environment variables');
  process.exit(1);
}
if (!GENIEBOOK_ADDRESS) {
  console.error('❌ GENIE_BOOK not found in environment variables');
  process.exit(1);
}

console.log('✅ Contract addresses loaded from .env:');
console.log('  OPTIONS_BOOK:', OPTIONSBOOK_ADDRESS);
console.log('  CALL_OPTION_IMPL:', CALL_IMPL_ADDRESS);
console.log('  PUT_OPTION_IMPL:', PUT_IMPL_ADDRESS);
console.log('  FUTURES_BOOK:', FUTURESBOOK_ADDRESS);
console.log('  LINEAR_FINITE_FUTURES:', LINEAR_FINITE_FUTURES_ADDRESS);
console.log('  GENIE_BOOK:', GENIEBOOK_ADDRESS);

// Query current OptionsBook factory for all actual contracts
app.get('/api/factory/all-contracts', async (req, res) => {
  try {
    // Check cache first
    const now = Date.now();
    if (factoryCache.data && (now - factoryCache.timestamp) < factoryCache.ttl) {
      return res.json(factoryCache.data);
    }
    
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    
    // OPTIMIZED: Use single getAllOptionMetadata() call instead of 15+ RPC calls per option
    const [allOptionMetadata, totalVolume] = await Promise.all([
      optionsBookContract.getAllOptionMetadata(),
      optionsBookContract.totalExercisedStrikeTokens()
    ]);
    
    console.log(`✅ Optimized RPC: Got ${allOptionMetadata.length} options in 2 calls instead of ${allOptionMetadata.length * 15 + 3} calls`);
    console.log(`📊 Total volume from OptionsBook: ${totalVolume.toString()} wei (${(Number(totalVolume) / Math.pow(10, 18)).toFixed(6)} MTK)`);
    
    // Transform OptionMeta structs to match expected frontend format
    const currentTime = Math.floor(Date.now() / 1000);
    const allContracts = allOptionMetadata.map(meta => {
      // Determine if the option should be considered active/funded based on long position
      const hasLongPosition = meta.long && meta.long !== '0x0000000000000000000000000000000000000000';
      const isFunded = true; // OptionsBook ensures funded contracts
      const isActive = hasLongPosition;
      
      // Check if option is expired and should be resolved
      const isExpired = meta.expiry > 0 && currentTime > meta.expiry;
      const needsResolution = isExpired && !meta.isResolved && !meta.isExercised;
      
      // Provide resolution status for frontend
      let resolutionStatus = 'active';
      if (!isExpired) {
        resolutionStatus = 'active';
      } else if (meta.isResolved) {
        resolutionStatus = 'resolved';
      } else if (meta.isExercised) {
        resolutionStatus = 'exercised';
      } else {
        resolutionStatus = 'needs_resolution';
      }
      
      return {
        address: meta.optionAddress,
        type: meta.isCall ? 'call' : 'put',
        optionType: meta.isCall ? 'CALL' : 'PUT', // For P&L calculations
        payoffType: meta.payoffType || 'Linear', // Default to Linear if not set
        short: meta.short,
        long: meta.long,
        isFunded,
        isActive,
        isExercised: meta.isExercised,
        isResolved: meta.isResolved,
        needsResolution,
        resolutionStatus,
        expiry: meta.expiry.toString(),
        strikePrice: meta.strikePrice.toString(),
        optionSize: meta.optionSize.toString(),
        premium: meta.premium.toString(),
        priceAtExpiry: meta.priceAtExpiry.toString(),
        exercisedAmount: meta.exercisedAmount.toString(),
        underlyingToken: meta.underlyingToken,
        strikeToken: meta.strikeToken,
        underlyingSymbol: meta.underlyingSymbol,
        strikeSymbol: meta.strikeSymbol
      };
    });
    
    // Count options by type for backwards compatibility
    const callOptionsCount = allContracts.filter(c => c.type === 'call').length;
    const putOptionsCount = allContracts.filter(c => c.type === 'put').length;
    
    const responseData = { 
      optionsBookAddress: OPTIONSBOOK_ADDRESS,
      callOptionsCount,
      putOptionsCount,
      totalVolume: totalVolume.toString(),
      contracts: allContracts
    };
    
    // Cache the response
    factoryCache.data = responseData;
    factoryCache.timestamp = now;
    
    res.json(responseData);
  } catch (error) {
    console.error('Error querying factory contracts:', error);
    res.status(500).json({ error: 'Failed to query factory contracts' });
  }
});

// Cache invalidation endpoint
app.post('/api/factory/clear-cache', (req, res) => {
  factoryCache.data = null;
  factoryCache.timestamp = 0;
  res.json({ success: true, message: 'Cache cleared' });
});

// Debug endpoint to check total volume directly
app.get('/api/debug/total-volume', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const totalVolume = await optionsBookContract.totalExercisedStrikeTokens();
    
    res.json({
      success: true,
      totalVolumeWei: totalVolume.toString(),
      totalVolumeMTK: (Number(totalVolume) / Math.pow(10, 18)).toFixed(6),
      optionsBookAddress: OPTIONSBOOK_ADDRESS,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching total volume directly:', error);
    res.status(500).json({ error: 'Failed to fetch total volume', details: error.message });
  }
});

// Debug endpoint to simulate exact frontend logic
app.get('/api/debug/frontend-volume-logic', async (req, res) => {
  try {
    // Get the same data that the main endpoint returns
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const [allOptionMetadata, totalVolume] = await Promise.all([
      optionsBookContract.getAllOptionMetadata(),
      optionsBookContract.totalExercisedStrikeTokens()
    ]);
    
    // Simulate the response format
    const mockResponse = {
      totalVolume: totalVolume.toString()
    };
    
    console.log('📊 Frontend simulation debug:', {
      responseData: mockResponse,
      totalVolumeRaw: mockResponse.totalVolume,
      totalVolumeType: typeof mockResponse.totalVolume
    });
    
    // Use direct total volume from OptionsBook contract (already in wei)
    const totalVolumeWei = mockResponse.totalVolume || '0';
    
    // Convert from wei to MTK for display
    const totalVolumeNumber = parseFloat(totalVolumeWei);
    const volumeInMTK = totalVolumeNumber / Math.pow(10, 18);
    
    console.log('📊 Frontend volume conversion debug:', {
      totalVolumeWei,
      totalVolumeNumber,
      volumeInMTK,
      finalDisplay: volumeInMTK.toFixed(2)
    });
    
    res.json({
      success: true,
      totalVolumeWei,
      totalVolumeNumber,
      volumeInMTK,
      finalDisplay: volumeInMTK.toFixed(2),
      directFromContract: totalVolume.toString()
    });
  } catch (error) {
    console.error('Error in frontend logic simulation:', error);
    res.status(500).json({ error: 'Failed to simulate frontend logic', details: error.message });
  }
});

// New resolution service with database
const ResolutionService = require('./resolutionService');
let resolutionService;

// API Routes

// Health check

// Get blockchain status
// Backend caching to reduce RPC calls
let blockchainStatusCache = { data: null, timestamp: 0 };
let oraclePricesCache = { data: null, timestamp: 0 };
let factoryContractsCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 30000; // 30 seconds

app.get('/api/blockchain/status', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ error: 'Blockchain provider not initialized' });
    }
    
    // Return cached data if still fresh
    const now = Date.now();
    if (blockchainStatusCache.data && (now - blockchainStatusCache.timestamp) < CACHE_DURATION) {
      return res.json({...blockchainStatusCache.data, cached: true});
    }
    
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();
    
    const statusData = {
      connected: true,
      blockNumber,
      network: network.name,
      chainId: network.chainId.toString()
    };

    // Update cache
    blockchainStatusCache = { data: statusData, timestamp: now };
    res.json(statusData);
  } catch (error) {
    console.error('Blockchain status error:', error);
    // Return cached data if available, even if stale
    if (blockchainStatusCache.data) {
      return res.json({...blockchainStatusCache.data, cached: true, stale: true});
    }
    res.status(500).json({ error: 'Failed to get blockchain status' });
  }
});

// Get account balance

// Get token balance

// Get oracle address
app.get('/api/oracle/address', async (req, res) => {
  try {
    const oracleAddress = process.env.ORACLE_ADDRESS;
    if (!oracleAddress) {
      return res.status(500).json({ error: 'Oracle address not configured' });
    }
    
    res.json({
      success: true,
      oracleAddress: oracleAddress
    });
  } catch (error) {
    console.error('Error getting oracle address:', error);
    res.status(500).json({ error: 'Failed to get oracle address' });
  }
});

// Get oracle prices
app.get('/api/oracle/prices', async (req, res) => {
  try {
    const oracleAddress = process.env.ORACLE_ADDRESS;
    if (!oracleAddress) {
      return res.status(500).json({ error: 'Oracle address not configured' });
    }
    
    const oracleContract = new ethers.Contract(oracleAddress, SimuOracleABI, provider);
    const tokenCount = await oracleContract.getTokenCount();
    
    // Bundle all RPC calls to reduce from N+1 calls to 2 batch calls
    console.log(`🔍 Bundling ${tokenCount * 2} oracle RPC calls into 2 batches...`);
    
    const tokenAddressPromises = [];
    for (let i = 0; i < tokenCount; i++) {
      tokenAddressPromises.push(oracleContract.getTokenAt(i));
    }
    
    const tokenAddresses = await Promise.all(tokenAddressPromises);
    
    const priceDataPromises = tokenAddresses.map(tokenAddress => 
      oracleContract.getPrice(tokenAddress)
    );
    
    const priceDataResults = await Promise.all(priceDataPromises);
    
    const prices = [];
    for (let i = 0; i < tokenAddresses.length; i++) {
      const tokenAddress = tokenAddresses[i];
      const [realPrice, price1e18, lastUpdated, symbol] = priceDataResults[i];
      
      prices.push({
        tokenAddress,
        symbol,
        realPrice: realPrice.toString(),
        price1e18: price1e18.toString(),
        lastUpdated: lastUpdated.toString(),
        priceFormatted: ethers.formatUnits(price1e18, 18),
        lastUpdatedDate: new Date(parseInt(lastUpdated.toString()) * 1000).toISOString(),
        timestamp: Date.now()
      });
    }
    
    console.log(`✅ Oracle prices fetched in 2 batched calls instead of ${tokenCount * 2 + 1} sequential calls`);
    
    res.json({ prices });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get oracle prices' });
  }
});

// Get live price for a specific token from oracle
app.get('/api/oracle/price/:tokenAddress', async (req, res) => {
  try {
    const { tokenAddress } = req.params;
    const oracleAddress = process.env.ORACLE_ADDRESS;
    
    if (!oracleAddress) {
      return res.status(500).json({ error: 'Oracle address not configured' });
    }
    
    if (!ethers.isAddress(tokenAddress)) {
      return res.status(400).json({ error: 'Invalid token address' });
    }
    
    const oracleContract = new ethers.Contract(oracleAddress, SimuOracleABI, provider);
    
    try {
      const [realPrice, price1e18, lastUpdated, symbol] = await oracleContract.getPrice(tokenAddress);
      
      res.json({
        tokenAddress,
        symbol,
        realPrice: realPrice.toString(),
        price1e18: price1e18.toString(),
        priceFormatted: ethers.formatUnits(price1e18, 18),
        lastUpdated: lastUpdated.toString(),
        lastUpdatedDate: new Date(parseInt(lastUpdated.toString()) * 1000).toISOString(),
        timestamp: Date.now()
      });
    } catch (oracleError) {
      // Token might not be in oracle
      return res.status(404).json({ 
        error: 'Token not found in oracle',
        tokenAddress,
        details: oracleError.message 
      });
    }
  } catch (error) {
    console.error('Error getting token price from oracle:', error);
    res.status(500).json({ error: 'Failed to get token price from oracle' });
  }
});

// Get option contract details
app.get('/api/option/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    console.log('🔍 Fetching option details for:', contractAddress);
    
    // OPTIMIZED: Use OptionsBook.getOptionMeta() instead of 18 individual RPC calls
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    
    let optionMeta;
    try {
      // Single RPC call to get all option metadata
      optionMeta = await optionsBookContract.getOptionMeta(contractAddress);
      console.log('✅ Optimized RPC: Got option details in 1 call instead of 18 calls');
    } catch (metaError) {
      console.error('❌ Failed to get option metadata from OptionsBook:', metaError.message);
      return res.status(404).json({ 
        error: 'Option not found in OptionsBook',
        details: 'The contract address does not exist in the OptionsBook registry'
      });
    }
    
    // Handle case where option metadata might not be available (for older contracts)
    if (!optionMeta || optionMeta.optionAddress === '0x0000000000000000000000000000000000000000') {
      console.warn('⚠️ Option metadata not found, falling back to individual contract calls');
      
      // Fallback to individual contract calls for older contracts not in metadata
      const { abi: contractABI } = await getContractTypeAndABI(contractAddress);
      const optionContract = new ethers.Contract(contractAddress, contractABI, provider);
      
      const fetchWithRetry = async (retryCount = 0) => {
        try {
          return await Promise.all([
            optionContract.short(),
            optionContract.long(),
            optionContract.underlyingToken(),
            optionContract.strikeToken(),
            optionContract.underlyingSymbol(),
            optionContract.strikeSymbol(),
            optionContract.strikePrice(),
            optionContract.optionSize(),
            optionContract.premium(),
            optionContract.expiry(),
            optionContract.isActive(),
            optionContract.isExercised(),
            optionContract.isFunded(),
            optionContract.isResolved(),
            optionContract.oracle(),
            optionContract.priceAtExpiry(),
            optionContract.optionType(),
            optionContract.getOracleAddress()
          ]);
        } catch (error) {
          if ((error.message.includes('Too Many Requests') || error.code === -32005) && retryCount < 3) {
            const backoffDelay = Math.min(1000 * Math.pow(2, retryCount), 10000);
            console.log(`⏳ Rate limited, retrying in ${backoffDelay}ms (attempt ${retryCount + 1}/3)...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
            return fetchWithRetry(retryCount + 1);
          }
          throw error;
        }
      };
      
      try {
        const [
          short, long, underlyingToken, strikeToken, underlyingSymbol, strikeSymbol,
          strikePrice, optionSize, premium, expiry, isActive, isExercised, 
          isFunded, isResolved, oracle, priceAtExpiry, optionType, oracleAddress
        ] = await fetchWithRetry();
        
        // Transform to match expected format
        optionMeta = {
          optionAddress: contractAddress,
          isCall: optionType === 'CALL',
          underlyingToken, strikeToken, underlyingSymbol, strikeSymbol,
          strikePrice, optionSize, premium, expiry, 
          priceAtExpiry, exercisedAmount: 0,
          isExercised, isResolved, long, short
        };
        
      } catch (error) {
        console.error('Error fetching contract data:', error.message);
        return res.status(500).json({ 
          error: 'Failed to fetch contract data',
          details: error.message 
        });
      }
    }
    
    // Determine active/funded state from metadata
    const hasLongPosition = optionMeta.long && optionMeta.long !== '0x0000000000000000000000000000000000000000';
    const isFunded = true; // OptionsBook ensures all registered contracts are funded
    const isActive = hasLongPosition;
    
    // Check resolution status
    const currentTime = Math.floor(Date.now() / 1000);
    const isExpired = optionMeta.expiry > 0 && currentTime > optionMeta.expiry;
    const needsResolution = isExpired && !optionMeta.isResolved && !optionMeta.isExercised;
    
    let resolutionStatus = 'active';
    if (!isExpired) {
      resolutionStatus = 'active';
    } else if (optionMeta.isResolved) {
      resolutionStatus = 'resolved';
    } else if (optionMeta.isExercised) {
      resolutionStatus = 'exercised';
    } else {
      resolutionStatus = 'needs_resolution';
    }
    
    res.json({
      contractAddress: optionMeta.optionAddress,
      short: optionMeta.short,
      long: optionMeta.long,
      underlyingToken: optionMeta.underlyingToken,
      strikeToken: optionMeta.strikeToken,
      underlyingSymbol: optionMeta.underlyingSymbol,
      strikeSymbol: optionMeta.strikeSymbol,
      strikePrice: optionMeta.strikePrice.toString(),
      optionSize: optionMeta.optionSize.toString(),
      premium: optionMeta.premium.toString(),
      expiry: optionMeta.expiry.toString(),
      isActive,
      isExercised: optionMeta.isExercised,
      isFunded,
      oracle: optionMeta.underlyingToken, // Fallback, will be overridden if individual calls were made
      optionsBook: OPTIONSBOOK_ADDRESS,
      priceAtExpiry: optionMeta.priceAtExpiry.toString(),
      isResolved: optionMeta.isResolved,
      needsResolution,
      resolutionStatus,
      optionType: optionMeta.isCall ? 'CALL' : 'PUT',
      payoffType: optionMeta.payoffType || 'Linear'
    });
  } catch (error) {
    console.error('❌ Error fetching option details:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to get option contract details',
      details: error.message 
    });
  }
});

// Create call option using OptionsBook factory
app.post('/api/option/create-call', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ 
        error: 'Blockchain provider not initialized',
        details: 'The server could not connect to the blockchain network'
      });
    }

    const {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      premium,
      oracle,
      userAddress,
      payoffType
    } = req.body;
    
    if (!underlyingToken || !strikeToken || !oracle || !userAddress) {
      return res.status(400).json({ 
        error: 'Missing required contract addresses or user address' 
      });
    }
    
    const optionSizeWei = ethers.parseUnits(optionSize.toString(), 18);
    const strikePriceWei = ethers.parseUnits(strikePrice.toString(), 18);
    const premiumWei = ethers.parseUnits(premium.toString(), 18);
    
    // Create OptionsBook contract instance
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    
    // For call options, user needs to approve underlying token (2TK) to OptionsBook
    const tokenContract = new ethers.Contract(underlyingToken, TwoTKABI, provider);
    
    // Prepare approve transaction data
    const approveData = tokenContract.interface.encodeFunctionData('approve', [OPTIONSBOOK_ADDRESS, optionSizeWei]);
    
    // Prepare createAndFundCallOption transaction data
    const createData = optionsBookContract.interface.encodeFunctionData('createAndFundCallOption', [
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePriceWei,
      optionSizeWei,
      premiumWei,
      oracle,
      payoffType || 'Linear'
    ]);
    
    res.json({
      success: true,
      message: 'Call option transactions prepared for MetaMask signing',
      data: {
        approveTransaction: {
          to: underlyingToken,
          data: approveData,
          value: '0x0'
        },
        createTransaction: {
          to: OPTIONSBOOK_ADDRESS,
          data: createData,
          value: '0x0'
        },
        tokenToApprove: underlyingToken,
        amountToApprove: optionSizeWei.toString(),
        optionsBookAddress: OPTIONSBOOK_ADDRESS
      }
    });
  } catch (error) {
    console.error('Error creating call option:', error);
    res.status(500).json({ 
      error: 'Failed to create call option contract',
      details: error.message 
    });
  }
});

// Create put option using OptionsBook factory
app.post('/api/option/create-put', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ 
        error: 'Blockchain provider not initialized',
        details: 'The server could not connect to the blockchain network'
      });
    }

    const {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      premium,
      oracle,
      userAddress,
      payoffType
    } = req.body;
    
    if (!underlyingToken || !strikeToken || !oracle || !userAddress) {
      return res.status(400).json({ 
        error: 'Missing required contract addresses or user address' 
      });
    }
    
    const optionSizeWei = ethers.parseUnits(optionSize.toString(), 18);
    const strikePriceWei = ethers.parseUnits(strikePrice.toString(), 18);
    const premiumWei = ethers.parseUnits(premium.toString(), 18);
    
    // For put options, user needs to deposit strike tokens (MTK) = (optionSize * strikePrice) / 1e18
    const mtkToSend = (optionSizeWei * strikePriceWei) / ethers.parseUnits('1', 18);
    
    // Create OptionsBook contract instance
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    
    // For put options, user needs to approve strike token (MTK) to OptionsBook
    const tokenContract = new ethers.Contract(strikeToken, MTKABI, provider);
    
    // Prepare approve transaction data
    const approveData = tokenContract.interface.encodeFunctionData('approve', [OPTIONSBOOK_ADDRESS, mtkToSend]);
    
    // Prepare createAndFundPutOption transaction data
    const createData = optionsBookContract.interface.encodeFunctionData('createAndFundPutOption', [
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePriceWei,
      optionSizeWei,
      premiumWei,
      oracle,
      payoffType || 'Linear'
    ]);
    
    res.json({
      success: true,
      message: 'Put option transactions prepared for MetaMask signing',
      data: {
        approveTransaction: {
          to: strikeToken,
          data: approveData,
          value: '0x0'
        },
        createTransaction: {
          to: OPTIONSBOOK_ADDRESS,
          data: createData,
          value: '0x0'
        },
        tokenToApprove: strikeToken,
        amountToApprove: mtkToSend.toString(),
        optionsBookAddress: OPTIONSBOOK_ADDRESS
      }
    });
  } catch (error) {
    console.error('Error creating put option:', error);
    res.status(500).json({ 
      error: 'Failed to create put option contract',
      details: error.message 
    });
  }
});

// Fund option contract (approval should already be done during creation) - optimized
app.post('/api/option/:contractAddress/fund', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    // OPTIMIZED: Use OptionsBook metadata to determine contract type (1 call instead of checking type)
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const optionMeta = await optionsBookContract.getOptionMeta(contractAddress);
    
    const contractABI = optionMeta.isCall ? CallOptionContractABI : PutOptionContractABI;
    const optionContract = new ethers.Contract(contractAddress, contractABI, provider);
    
    // Prepare fund transaction data
    const fundData = optionContract.interface.encodeFunctionData('fund');
    
    res.json({
      success: true,
      message: 'Fund transaction prepared for MetaMask signing',
      data: {
        to: contractAddress,
        data: fundData,
        value: '0x0'
      }
    });
  } catch (error) {
    console.error('Error preparing fund transaction:', error);
    res.status(500).json({ error: 'Failed to prepare fund transaction' });
  }
});

// Enter as long (buy option) - optimized with OptionsBook metadata
app.post('/api/option/:contractAddress/enter', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    // Validate contract address format
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    console.log('Processing enter request for contract:', contractAddress);
    
    // OPTIMIZED: Use OptionsBook metadata instead of individual contract calls (3 calls → 1 call)
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const optionMeta = await optionsBookContract.getOptionMeta(contractAddress);
    
    console.log('Strike token:', optionMeta.strikeToken);
    console.log('Premium:', optionMeta.premium.toString());
    
    // Prepare approve transaction data (approve OptionsBook to spend premium)
    const tokenContract = new ethers.Contract(optionMeta.strikeToken, MTKABI, provider);
    const approveData = tokenContract.interface.encodeFunctionData('approve', [OPTIONSBOOK_ADDRESS, optionMeta.premium]);
    
    // Prepare enterAndPayPremium transaction data (call OptionsBook, not individual contract)
    const enterData = optionsBookContract.interface.encodeFunctionData('enterAndPayPremium', [contractAddress]);
    
    // Return both transactions for the frontend to execute separately
    res.json({
      success: true,
      message: 'Enter as long transactions prepared for MetaMask signing',
      data: {
        approveTransaction: {
          to: optionMeta.strikeToken,
          data: approveData,
          value: '0x0'
        },
        enterTransaction: {
          to: OPTIONSBOOK_ADDRESS,
          data: enterData,
          value: '0x0'
        },
        premiumToken: optionMeta.strikeToken,
        premiumAmount: optionMeta.premium.toString(),
        optionsBookAddress: OPTIONSBOOK_ADDRESS
      }
    });
  } catch (error) {
    console.error('Error preparing enter transaction:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      error: 'Failed to prepare enter transaction',
      details: error.message 
    });
  }
});



// Resolve option

// Exercise option - optimized with OptionsBook metadata
app.post('/api/option/:contractAddress/exercise', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const { mtkAmount, twoTkAmount } = req.body;
    
    console.log('Processing exercise request for contract:', contractAddress);
    
    // OPTIMIZED: Use OptionsBook metadata instead of individual contract calls (2 calls → 1 call)
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const optionMeta = await optionsBookContract.getOptionMeta(contractAddress);
    
    const contractType = optionMeta.isCall ? 'call' : 'put';
    
    // Determine amount and parameter name based on contract type
    let amountWei, amountParam, logMessage;
    if (contractType === 'call') {
      amountWei = ethers.parseUnits(mtkAmount.toString(), 18);
      amountParam = amountWei;
      logMessage = `MTK amount to spend: ${mtkAmount}`;
    } else if (contractType === 'put') {
      amountWei = ethers.parseUnits(twoTkAmount.toString(), 18);
      amountParam = amountWei;
      logMessage = `2TK amount to spend: ${twoTkAmount}`;
    } else {
      // Fallback for unknown type
      amountWei = ethers.parseUnits((mtkAmount || twoTkAmount).toString(), 18);
      amountParam = amountWei;
      logMessage = `Amount to spend: ${mtkAmount || twoTkAmount}`;
    }
    
    console.log(logMessage);
    console.log('Strike token:', optionMeta.strikeToken);
    console.log('Amount (wei):', amountWei.toString());
    
    // Prepare approve transaction data
    const tokenContract = new ethers.Contract(optionMeta.strikeToken, MTKABI, provider);
    const approveData = tokenContract.interface.encodeFunctionData('approve', [contractAddress, amountWei]);
    
    // Prepare exercise transaction data
    const contractABI = optionMeta.isCall ? CallOptionContractABI : PutOptionContractABI;
    const optionContract = new ethers.Contract(contractAddress, contractABI, provider);
    const exerciseData = optionContract.interface.encodeFunctionData('exercise', [amountWei]);
    
    // Return both transactions for the frontend to execute separately
    res.json({
      success: true,
      message: 'Exercise transactions prepared for MetaMask signing',
      data: {
        approveTransaction: {
          to: optionMeta.strikeToken,
          data: approveData,
          value: '0x0'
        },
        exerciseTransaction: {
          to: contractAddress,
          data: exerciseData,
          value: '0x0'
        },
        strikeToken: optionMeta.strikeToken,
        amount: amountWei.toString(),
        contractType: contractType,
        contractAddress: contractAddress
      }
    });
  } catch (error) {
    console.error('Error preparing exercise transaction:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      error: 'Failed to prepare exercise transaction',
      details: error.message 
    });
  }
});

// Exercise option - calls resolve() then exercise() on the individual contract - optimized
app.post('/api/option/:contractAddress/resolveAndExercise', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const { mtkAmount, twoTkAmount } = req.body;
    
    console.log('Processing resolveAndExercise request for contract:', contractAddress);
    
    // OPTIMIZED: Use OptionsBook metadata instead of 8 individual contract calls (8 calls → 1 call)
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const optionMeta = await optionsBookContract.getOptionMeta(contractAddress);
    
    const contractType = optionMeta.isCall ? 'call' : 'put';
    const currentTime = Math.floor(Date.now() / 1000);
    
    console.log('Option state check:', {
      contractAddress,
      long: optionMeta.long,
      isExercised: optionMeta.isExercised,
      isResolved: optionMeta.isResolved,
      expiry: optionMeta.expiry.toString(),
      strikePrice: optionMeta.strikePrice.toString(),
      priceAtExpiry: optionMeta.priceAtExpiry.toString(),
      currentTime,
      isExpired: Number(optionMeta.expiry) <= currentTime,
      isProfitable: contractType === 'call' ? 
        Number(optionMeta.priceAtExpiry) > Number(optionMeta.strikePrice) :
        Number(optionMeta.priceAtExpiry) < Number(optionMeta.strikePrice)
    });
    
    let amountWei, tokenToApprove, approveTokenContract;
    
    // Always use OptionsBook calculation mode for all option types
    // This ensures consistent behavior and eliminates overspending bugs
    amountWei = 0n;
    const payoffType = optionMeta.payoffType || 'Linear';
    
    if (contractType === 'call') {
      // CALL: User sends MTK to buy 2TK
      tokenToApprove = optionMeta.strikeToken; // MTK
      approveTokenContract = new ethers.Contract(optionMeta.strikeToken, MTKABI, provider);
      console.log(`CALL (${payoffType}) - Using OptionsBook calculation mode`);
    } else {
      // PUT: User sends 2TK to sell for MTK
      tokenToApprove = optionMeta.underlyingToken; // 2TK
      approveTokenContract = new ethers.Contract(optionMeta.underlyingToken, TwoTKABI, provider);
      console.log(`PUT (${payoffType}) - Using OptionsBook calculation mode`);
    }
    
    console.log('Contract address:', contractAddress);
    console.log('Amount (wei):', amountWei.toString());
    
    // Prepare approve transaction (user needs to approve OptionsBook to spend the correct token)
    // Since we always use OptionsBook calculation mode, approve the provided amount from frontend
    const approveAmount = ethers.parseUnits((contractType === 'call' ? mtkAmount : twoTkAmount).toString(), 18);
    const approveData = approveTokenContract.interface.encodeFunctionData('approve', [OPTIONSBOOK_ADDRESS, approveAmount]);
    
    // Prepare resolveAndExercise transaction (call OptionsBook)
    const resolveAndExerciseData = optionsBookContract.interface.encodeFunctionData('resolveAndExercise', [contractAddress, amountWei]);
    
    // Return both transactions for the frontend to execute sequentially
    res.json({
      success: true,
      message: 'Resolve and exercise transactions prepared for MetaMask signing',
      data: {
        approveTransaction: {
          to: tokenToApprove,
          data: approveData,
          value: '0x0'
        },
        resolveAndExerciseTransaction: {
          to: OPTIONSBOOK_ADDRESS,
          data: resolveAndExerciseData,
          value: '0x0'
        },
        tokenToApprove: tokenToApprove,
        amount: amountWei.toString(),
        contractType: contractType,
        contractAddress: contractAddress
      }
    });
  } catch (error) {
    console.error('Error preparing resolveAndExercise transaction:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      error: 'Failed to prepare resolveAndExercise transaction',
      details: error.message 
    });
  }
});

// Reclaim option - calls resolveAndReclaim() on the OptionsBook contract (for short position holders) - optimized
app.post('/api/option/:contractAddress/reclaim', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    console.log('Processing reclaim request for contract:', contractAddress);
    
    // Validate contract address format
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    // OPTIMIZED: Use OptionsBook metadata instead of 8 individual contract calls (8 calls → 1 call)
    const optionsBookContract = new ethers.Contract(OPTIONSBOOK_ADDRESS, OptionsBookABI, provider);
    const optionMeta = await optionsBookContract.getOptionMeta(contractAddress);
    
    const currentTime = Math.floor(Date.now() / 1000);
    
    console.log('Option state check for reclaim:', {
      contractAddress,
      short: optionMeta.short,
      isExercised: optionMeta.isExercised,
      isResolved: optionMeta.isResolved,
      expiry: optionMeta.expiry.toString(),
      currentTime,
      isExpired: Number(optionMeta.expiry) <= currentTime
    });
    
    // Prepare resolveAndReclaim transaction data
    const reclaimData = optionsBookContract.interface.encodeFunctionData('resolveAndReclaim', [contractAddress]);
    
    res.json({
      success: true,
      message: 'Reclaim transaction prepared for MetaMask signing',
      data: {
        to: OPTIONSBOOK_ADDRESS,
        data: reclaimData,
        value: '0x0'
      }
    });
  } catch (error) {
    console.error('Error preparing reclaim transaction:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      error: 'Failed to prepare reclaim transaction',
      details: error.message 
    });
  }
});

// ==================== FUTURES API ENDPOINTS ====================

// Get all futures contracts from FuturesBook factory
app.get('/api/factory/all-futures', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    console.log('🔍 Querying FuturesBook at address:', FUTURESBOOK_ADDRESS);
    const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
    
    // Get all futures contracts
    console.log('📋 Calling getAllFutures()...');
    const allFutures = await futuresBookContract.getAllFutures();
    
    console.log(`✅ Found ${allFutures.length} futures contracts:`, allFutures);
    
    if (allFutures.length === 0) {
      console.log('⚠️ No futures contracts found. This could mean:');
      console.log('   - No futures have been created yet');
      console.log('   - FuturesBook address is incorrect');
      console.log('   - Contract deployment failed');
      console.log('   - Network mismatch');
    }
    
    // OPTIMIZED: Bundle all contract calls into batches to minimize RPC calls
    console.log('🚀 Optimizing RPC calls with batch processing...');
    
    // Step 1: Get all metadata in parallel (N calls -> still N, but parallel)
    const metadataPromises = allFutures.map(address => 
      futuresBookContract.getFuturesMeta(address).catch(error => {
        console.error(`Error fetching metadata for ${address}:`, error);
        return null;
      })
    );
    
    // Step 2: Get all expiry data in parallel 
    const expiryPromises = allFutures.map(address => {
      const futuresContract = new ethers.Contract(address, [
        'function expiry() view returns (uint256)'
      ], provider);
      return futuresContract.expiry().catch(error => {
        console.warn(`Failed to read expiry from ${address}:`, error.message);
        return undefined;
      });
    });
    
    // Step 3: Get position mappings in parallel for contracts that might need them
    const longPositionPromises = allFutures.map(address => 
      futuresBookContract.longPosition(address).catch(() => '0x0000000000000000000000000000000000000000')
    );
    
    const shortPositionPromises = allFutures.map(address => 
      futuresBookContract.shortPosition(address).catch(() => '0x0000000000000000000000000000000000000000')
    );
    
    // Execute all batches in parallel - this reduces from 4N sequential calls to 4 parallel batches
    const [allMetadata, allExpiries, allLongPositions, allShortPositions] = await Promise.all([
      Promise.all(metadataPromises),
      Promise.all(expiryPromises),
      Promise.all(longPositionPromises),
      Promise.all(shortPositionPromises)
    ]);
    
    console.log(`✅ Completed batched RPC calls: ${allFutures.length} contracts processed`);
    
    // Step 4: Process the results
    const futuresMetadata = allFutures.map((futureAddress, index) => {
      const meta = allMetadata[index];
      if (!meta) return null;
      
      const actualExpiry = allExpiries[index];
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Use position mappings to fix metadata bugs
      const actualLong = meta.long === '0x0000000000000000000000000000000000000000' 
        ? allLongPositions[index] 
        : meta.long;
      const actualShort = meta.short === '0x0000000000000000000000000000000000000000' 
        ? allShortPositions[index] 
        : meta.short;
      
      const hasLongPosition = actualLong && actualLong !== '0x0000000000000000000000000000000000000000';
      const isFunded = true;
      const isActive = hasLongPosition;
      const isExpired = actualExpiry && actualExpiry > 0 && currentTime > actualExpiry;
      const needsResolution = isExpired && !meta.isResolved && !meta.isExercised;
      
      let resolutionStatus = 'active';
      if (!isExpired) {
        resolutionStatus = 'active';
      } else if (meta.isResolved) {
        resolutionStatus = 'resolved';
      } else if (meta.isExercised) {
        resolutionStatus = 'exercised';
      } else {
        resolutionStatus = 'needs_resolution';
      }
      
      return {
        address: meta.futureAddress,
        type: 'future',
        contractType: meta.payoffType === 'PowerFiniteFutures' ? 'POWER_FINITE_FUTURES' : 
                     meta.payoffType === 'SigmoidFiniteFutures' ? 'SIGMOID_FINITE_FUTURES' : 'LINEAR_FINITE_FUTURES',
        payoffType: meta.payoffType === 'PowerFiniteFutures' ? 'Power' : 
                   meta.payoffType === 'SigmoidFiniteFutures' ? 'Sigmoid' : 'Linear',
        payoffPower: meta.payoffPower,
        // Sigmoid intensity will be read in next batch
        sigmoidIntensity: undefined,
        short: actualShort,
        long: actualLong,
        isFunded,
        isActive,
        isExercised: meta.isExercised,
        isResolved: meta.isResolved,
        needsResolution,
        resolutionStatus,
        expiry: actualExpiry ? actualExpiry.toString() : '0',
        strikePrice: meta.strikePrice.toString(),
        optionSize: meta.positionSize.toString(),
        premium: meta.premium.toString(), // Always 0 for futures
        priceAtExpiry: meta.priceAtExpiry.toString(),
        exercisedAmount: meta.exercisedAmount.toString(),
        underlyingToken: meta.underlyingToken,
        strikeToken: meta.strikeToken,
        underlyingSymbol: meta.underlyingSymbol,
        strikeSymbol: meta.strikeSymbol
      };
    });
    
    // Filter out null entries (failed metadata fetches)
    const validFutures = futuresMetadata.filter(meta => meta !== null);
    
    // OPTIMIZED: Read sigmoid intensities in parallel batch
    const sigmoidFutures = validFutures.filter(future => future.payoffType === 'Sigmoid');
    console.log(`🔧 Processing ${sigmoidFutures.length} sigmoid contracts...`);
    
    if (sigmoidFutures.length > 0) {
      const sigmoidIntensityPromises = sigmoidFutures.map(future => {
        const sigmoidContract = new ethers.Contract(future.address, [
          'function sigmoidIntensity1e18() view returns (uint256)'
        ], provider);
        return sigmoidContract.sigmoidIntensity1e18().catch(error => {
          console.warn(`Failed to read sigmoid intensity for ${future.address}:`, error.message);
          return undefined;
        });
      });
      
      const allSigmoidIntensities = await Promise.all(sigmoidIntensityPromises);
      
      // Apply the results back to the futures
      sigmoidFutures.forEach((future, index) => {
        const intensity1e18 = allSigmoidIntensities[index];
        if (intensity1e18 !== undefined) {
          future.sigmoidIntensity = parseFloat(ethers.formatUnits(intensity1e18.toString(), 18));
        } else {
          future.sigmoidIntensity = undefined;
        }
      });
      
      console.log(`✅ Completed sigmoid intensity batch: ${sigmoidFutures.length} contracts processed`);
    }
    
    // Debug: Log the data structure to identify BigInt fields
    console.log('📊 Futures data structure debug:', JSON.stringify(validFutures, (key, value) =>
      typeof value === 'bigint' ? `BigInt(${value})` : value
    ));

    // Convert any remaining BigInt values to strings
    const sanitizedFutures = validFutures.map(future => {
      const sanitized = {};
      for (const [key, value] of Object.entries(future)) {
        sanitized[key] = typeof value === 'bigint' ? value.toString() : value;
      }
      return sanitized;
    });

    res.json({
      futuresBookAddress: FUTURESBOOK_ADDRESS,
      futuresCount: sanitizedFutures.length,
      totalVolume: '0', // Futures don't have volume tracking like options
      contracts: sanitizedFutures
    });
  } catch (error) {
    console.error('Error querying futures contracts:', error);
    res.status(500).json({ error: 'Failed to query futures contracts' });
  }
});

// Get specific futures contract details
app.get('/api/futures/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    console.log('🔍 Fetching futures details for:', contractAddress);
    
    const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
    
    let futuresMeta;
    try {
      // Single RPC call to get all futures metadata
      futuresMeta = await futuresBookContract.getFuturesMeta(contractAddress);
      console.log('✅ Got futures details in 1 call instead of multiple individual calls');
    } catch (metaError) {
      console.error('❌ Failed to get futures metadata from FuturesBook:', metaError.message);
      return res.status(404).json({ 
        error: 'Future not found in FuturesBook',
        details: 'The contract address does not exist in the FuturesBook registry'
      });
    }
    
    // Handle case where futures metadata might not be available
    if (!futuresMeta || futuresMeta.futureAddress === '0x0000000000000000000000000000000000000000') {
      console.warn('⚠️ Futures metadata not found');
      return res.status(404).json({ 
        error: 'Future not found',
        details: 'The contract address does not exist in the FuturesBook registry'
      });
    }
    
    // Determine active/funded state from metadata
    const hasLongPosition = futuresMeta.long && futuresMeta.long !== '0x0000000000000000000000000000000000000000';
    const isFunded = true; // FuturesBook ensures all registered contracts are funded
    const isActive = hasLongPosition;
    
    // Read actual expiry from the individual futures contract instance
    let actualExpiry = futuresMeta.expiry;
    try {
      // Read expiry directly from the futures contract instance
      const futuresContract = new ethers.Contract(contractAddress, [
        'function expiry() view returns (uint256)'
      ], provider);
      
      const contractExpiry = await futuresContract.expiry();
      if (contractExpiry && contractExpiry > 0) {
        actualExpiry = contractExpiry;
        console.log(`Read expiry from futures contract ${contractAddress}: ${contractExpiry.toString()}`);
      } else {
        console.log(`Futures contract ${contractAddress} has no expiry set yet, skipping metadata fallback`);
        actualExpiry = undefined;
      }
    } catch (error) {
      console.warn(`Failed to read expiry from futures contract ${contractAddress}:`, error.message);
      // Don't use metadata fallback - set as undefined if contract can't be read
      actualExpiry = undefined;
    }

    // Check resolution status
    const currentTime = Math.floor(Date.now() / 1000);
    const isExpired = actualExpiry && actualExpiry > 0 && currentTime > actualExpiry;
    const needsResolution = isExpired && !futuresMeta.isResolved && !futuresMeta.isExercised;
    
    let resolutionStatus = 'active';
    if (!isExpired) {
      resolutionStatus = 'active';
    } else if (futuresMeta.isResolved) {
      resolutionStatus = 'resolved';
    } else if (futuresMeta.isExercised) {
      resolutionStatus = 'exercised';
    } else {
      resolutionStatus = 'needs_resolution';
    }
    
    // Prepare response data with proper BigInt handling
    const responseData = {
      contractAddress: futuresMeta.futureAddress,
      short: futuresMeta.short,
      long: futuresMeta.long,
      underlyingToken: futuresMeta.underlyingToken,
      strikeToken: futuresMeta.strikeToken,
      underlyingSymbol: futuresMeta.underlyingSymbol,
      strikeSymbol: futuresMeta.strikeSymbol,
      strikePrice: futuresMeta.strikePrice.toString(),
      optionSize: futuresMeta.positionSize.toString(),
      premium: futuresMeta.premium.toString(), // Always 0 for futures
      expiry: actualExpiry ? actualExpiry.toString() : '0',
      isActive,
      isExercised: futuresMeta.isExercised,
      isFunded,
      oracle: futuresMeta.underlyingToken, // Fallback
      futuresBook: FUTURESBOOK_ADDRESS,
      priceAtExpiry: futuresMeta.priceAtExpiry.toString(),
      isResolved: futuresMeta.isResolved,
      needsResolution,
      resolutionStatus,
      contractType: futuresMeta.payoffType === 'PowerFiniteFutures' ? 'POWER_FINITE_FUTURES' : 
                   futuresMeta.payoffType === 'SigmoidFiniteFutures' ? 'SIGMOID_FINITE_FUTURES' : 'LINEAR_FINITE_FUTURES',
      payoffType: futuresMeta.payoffType === 'PowerFiniteFutures' ? 'Power' : 
                 futuresMeta.payoffType === 'SigmoidFiniteFutures' ? 'Sigmoid' : 'Linear',
      payoffPower: futuresMeta.payoffPower || 1,
      sigmoidIntensity: undefined // Will be set below for sigmoid contracts
    };

    // Read sigmoid intensity for sigmoid contracts
    if (responseData.payoffType === 'Sigmoid') {
      try {
        // Create contract instance for the sigmoid futures contract
        const sigmoidContract = new ethers.Contract(contractAddress, [
          'function sigmoidIntensity1e18() view returns (uint256)'
        ], provider);
        
        const intensity1e18 = await sigmoidContract.sigmoidIntensity1e18();
        responseData.sigmoidIntensity = parseFloat(ethers.formatUnits(intensity1e18.toString(), 18));
      } catch (error) {
        console.warn(`Failed to read sigmoid intensity for ${contractAddress}:`, error.message);
        // Don't set a fallback - let it be undefined to indicate data couldn't be read
        responseData.sigmoidIntensity = undefined;
      }
    }

    // Convert any remaining BigInt values to strings
    const sanitizedResponse = {};
    for (const [key, value] of Object.entries(responseData)) {
      sanitizedResponse[key] = typeof value === 'bigint' ? value.toString() : value;
    }

    // Fix contract metadata bug: use position mappings when metadata shows zero addresses
    if (sanitizedResponse.long === '0x0000000000000000000000000000000000000000') {
      try {
        const longResult = await futuresBookContract.longPosition(contractAddress);
        if (longResult && longResult !== '0x0000000000000000000000000000000000000000') {
          sanitizedResponse.long = longResult;
        }
      } catch (error) {
        console.warn('Failed to get longPosition for individual contract', contractAddress, error.message);
      }
    }
    
    if (sanitizedResponse.short === '0x0000000000000000000000000000000000000000') {
      try {
        const shortResult = await futuresBookContract.shortPosition(contractAddress);
        if (shortResult && shortResult !== '0x0000000000000000000000000000000000000000') {
          sanitizedResponse.short = shortResult;
        }
      } catch (error) {
        console.warn('Failed to get shortPosition for individual contract', contractAddress, error.message);
      }
    }

    res.json(sanitizedResponse);
  } catch (error) {
    console.error('❌ Error fetching futures details:', error);
    res.status(500).json({ 
      error: 'Failed to get futures contract details',
      details: error.message 
    });
  }
});

// Create linear finite futures using FuturesBook factory
app.post('/api/futures/create-future', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ 
        error: 'Blockchain provider not initialized',
        details: 'The server could not connect to the blockchain network'
      });
    }

    const {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice, // Used to calculate strikeNotional
      optionSize, // Frontend still sends optionSize
      premium, // Must be 0 for futures
      oracle,
      userAddress,
      payoffType,
      payoffPower, // For Power futures
      makerSide, // 'long' or 'short' - which side maker wants to be
      makerCollateral, // Now used as strikeNotional or ignored for SHORT
      expirySeconds // New: maker-chosen expiry time
    } = req.body;
    
    if (!underlyingToken || !strikeToken || !oracle || !userAddress || !expirySeconds) {
      return res.status(400).json({ 
        error: 'Missing required contract addresses, user address, or expiry seconds' 
      });
    }
    
    // Futures must have 0 premium
    if (premium && premium !== '0' && premium !== 0) {
      return res.status(400).json({ 
        error: 'Futures contracts must have zero premium' 
      });
    }
    
    const optionSizeWei = ethers.parseUnits(optionSize.toString(), 18);
    const makerIsLong = makerSide === 'long';
    const expirySecondsValue = expirySeconds; // Don't provide default - require explicit value
    
    // Calculate strikeNotional based on maker side and user input
    let strikeNotional = 0n;
    let fundingToken = '';
    let fundingAmount = 0n;
    
    if (makerIsLong) {
      // LONG maker funds with strike tokens (strikeNotional = strikePrice * optionSize)
      strikeNotional = ethers.parseUnits((parseFloat(strikePrice) * parseFloat(optionSize)).toString(), 18);
      fundingToken = strikeToken;
      fundingAmount = strikeNotional;
    } else {
      // SHORT maker funds with underlying tokens (optionSize)
      // strikeNotional is still used to calculate strike price
      strikeNotional = ethers.parseUnits((parseFloat(strikePrice) * parseFloat(optionSize)).toString(), 18);
      fundingToken = underlyingToken;
      fundingAmount = optionSizeWei;
    }
    
    // Create FuturesBook contract instance
    const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
    
    // Prepare approval transaction for funding
    const tokenContract = new ethers.Contract(fundingToken, MTKABI, provider);
    const approveData = tokenContract.interface.encodeFunctionData('approve', [FUTURESBOOK_ADDRESS, fundingAmount]);
    
    const approveTransaction = {
      to: fundingToken,
      data: approveData,
      value: '0x0'
    };
    
    // Prepare transaction data - choose between Linear, Power, and Sigmoid futures
    let createData;
    if (payoffType === 'Power') {
      // Validate power parameter for Power futures
      const power = parseInt(payoffPower);
      if (power < 1 || power > 100) {
        return res.status(400).json({ 
          error: 'Invalid payoff power: must be between 1 and 100' 
        });
      }
      
      createData = futuresBookContract.interface.encodeFunctionData('createAndFundPowerFuture', [
        underlyingToken,
        strikeToken,
        underlyingSymbol,
        strikeSymbol,
        optionSizeWei, // _positionSize parameter
        0, // premium must be 0 for futures
        oracle,
        strikeNotional,
        makerIsLong,
        expirySecondsValue,
        power // payoff power parameter
      ]);
    } else if (payoffType === 'Sigmoid') {
      // Validate intensity parameter for Sigmoid futures
      const intensity = parseFloat(req.body.sigmoidIntensity) || 1.0;
      if (intensity <= 0 || intensity > 100) {
        return res.status(400).json({ 
          error: 'Invalid sigmoid intensity: must be between 0.1 and 100' 
        });
      }
      
      // Convert intensity to 1e18 scaled value
      const intensity1e18 = ethers.parseUnits(intensity.toString(), 18);
      
      createData = futuresBookContract.interface.encodeFunctionData('createAndFundSigmoidFuture', [
        underlyingToken,
        strikeToken,
        underlyingSymbol,
        strikeSymbol,
        optionSizeWei, // _positionSize parameter
        0, // premium must be 0 for futures
        oracle,
        strikeNotional,
        makerIsLong,
        expirySecondsValue,
        intensity1e18 // sigmoid intensity parameter (1e18 scaled)
      ]);
    } else {
      // Default to Linear futures
      createData = futuresBookContract.interface.encodeFunctionData('createAndFundLinearFuture', [
        underlyingToken,
        strikeToken,
        underlyingSymbol,
        strikeSymbol,
        optionSizeWei, // _positionSize parameter
        0, // premium must be 0 for futures
        oracle,
        strikeNotional,
        makerIsLong,
        expirySecondsValue
      ]);
    }
    
    const responseData = {
      success: true,
      message: 'Futures contract transactions prepared for MetaMask signing (approval + creation)',
      data: {
        createTransaction: {
          to: FUTURESBOOK_ADDRESS,
          data: createData,
          value: '0x0'
        },
        approveTransaction: approveTransaction,
        tokenToApprove: fundingToken,
        amountToApprove: fundingAmount.toString(),
        futuresBookAddress: FUTURESBOOK_ADDRESS,
        fundingDetails: {
          makerSide: makerSide,
          fundingToken: fundingToken,
          fundingAmount: ethers.formatUnits(fundingAmount, 18),
          strikeNotional: ethers.formatUnits(strikeNotional, 18),
          calculatedStrike: parseFloat(strikePrice).toString()
        }
      }
    };
    
    res.json(responseData);
  } catch (error) {
    console.error('Error creating futures contract:', error);
    res.status(500).json({ 
      error: 'Failed to create futures contract',
      details: error.message 
    });
  }
});

// Enter as counterparty (no collateral needed for futures)
app.post('/api/futures/:contractAddress/enter', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    // Validate contract address format
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    console.log('Processing futures enter request for contract:', contractAddress);
    
    // Get futures metadata from FuturesBook
    const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
    const futuresMeta = await futuresBookContract.getFuturesMeta(contractAddress);
    
    console.log('Futures metadata:', {
      underlyingSymbol: futuresMeta.underlyingSymbol,
      strikeSymbol: futuresMeta.strikeSymbol,
      optionSize: ethers.formatUnits(futuresMeta.positionSize, 18),
      strikePrice: ethers.formatUnits(futuresMeta.strikePrice, 18),
      expiry: futuresMeta.expiry.toString(),
      long: futuresMeta.long,
      short: futuresMeta.short
    });
    
    // For futures, no collateral is needed - counterparty just enters without paying anything
    // The premium amount must be 0 for futures contracts
    
    // Prepare enterAndPayPremium transaction data with premium amount (must be 0 for futures)
    const enterData = futuresBookContract.interface.encodeFunctionData('enterAndPayPremium', [contractAddress, 0]);
    
    const responseData = {
      success: true,
      message: 'Enter futures contract transaction prepared for MetaMask signing',
      data: {
        enterTransaction: {
          to: FUTURESBOOK_ADDRESS,
          data: enterData,
          value: '0x0'
        },
        futuresBookAddress: FUTURESBOOK_ADDRESS,
        contractDetails: {
          underlyingSymbol: futuresMeta.underlyingSymbol,
          strikeSymbol: futuresMeta.strikeSymbol,
          optionSize: ethers.formatUnits(futuresMeta.positionSize, 18),
          strikePrice: ethers.formatUnits(futuresMeta.strikePrice, 18),
          expiry: futuresMeta.expiry.toString()
        }
      }
    };
    
    res.json(responseData);
  } catch (error) {
    console.error('Error preparing futures enter transaction:', error);
    console.error('Error details:', error.message);
    res.status(500).json({ 
      error: 'Failed to prepare futures enter transaction',
      details: error.message 
    });
  }
});

// Resolve and exercise futures contract
app.post('/api/futures/:contractAddress/resolveAndExercise', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    console.log('Processing futures resolveAndExercise request for contract:', contractAddress);
    
    // Get futures metadata from FuturesBook
    const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
    const futuresMeta = await futuresBookContract.getFuturesMeta(contractAddress);
    
    const currentTime = Math.floor(Date.now() / 1000);
    
    console.log('Futures state check:', {
      contractAddress,
      long: futuresMeta.long,
      isExercised: futuresMeta.isExercised,
      isResolved: futuresMeta.isResolved,
      expiry: futuresMeta.expiry.toString(),
      strikePrice: futuresMeta.strikePrice.toString(),
      priceAtExpiry: futuresMeta.priceAtExpiry.toString(),
      currentTime,
      isExpired: Number(futuresMeta.expiry) <= currentTime
    });
    
    // For futures, the payout is calculated automatically by the contract
    // No token approval needed as the contract calculates and transfers the payout
    
    // Prepare resolveAndExercise transaction (call FuturesBook)
    const resolveAndExerciseData = futuresBookContract.interface.encodeFunctionData('resolveAndExercise', [contractAddress]);
    
    res.json({
      success: true,
      message: 'Futures resolve and exercise transaction prepared for MetaMask signing',
      data: {
        resolveAndExerciseTransaction: {
          to: FUTURESBOOK_ADDRESS,
          data: resolveAndExerciseData,
          value: '0x0'
        },
        contractAddress: contractAddress
      }
    });
  } catch (error) {
    console.error('Error preparing futures resolveAndExercise transaction:', error);
    res.status(500).json({ 
      error: 'Failed to prepare futures resolveAndExercise transaction',
      details: error.message 
    });
  }
});

// Resolve and reclaim futures contract
app.post('/api/futures/:contractAddress/reclaim', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    console.log('Processing futures reclaim request for contract:', contractAddress);
    
    // Validate contract address format
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    // Get futures metadata from FuturesBook
    const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
    const futuresMeta = await futuresBookContract.getFuturesMeta(contractAddress);
    
    const currentTime = Math.floor(Date.now() / 1000);
    
    console.log('Futures state check for reclaim:', {
      contractAddress,
      short: futuresMeta.short,
      isExercised: futuresMeta.isExercised,
      isResolved: futuresMeta.isResolved,
      expiry: futuresMeta.expiry.toString(),
      currentTime,
      isExpired: Number(futuresMeta.expiry) <= currentTime
    });
    
    // Prepare resolveAndReclaim transaction data
    const reclaimData = futuresBookContract.interface.encodeFunctionData('resolveAndReclaim', [contractAddress]);
    
    res.json({
      success: true,
      message: 'Futures reclaim transaction prepared for MetaMask signing',
      data: {
        to: FUTURESBOOK_ADDRESS,
        data: reclaimData,
        value: '0x0'
      }
    });
  } catch (error) {
    console.error('Error preparing futures reclaim transaction:', error);
    res.status(500).json({ 
      error: 'Failed to prepare futures reclaim transaction',
      details: error.message 
    });
  }
});

// ==================== GENIE API ENDPOINTS ====================

// Get all genie contracts from GenieBook factory (OPTIMIZED with Multicall)
app.get('/api/factory/all-genies', async (req, res) => {
  try {
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    console.log('🔍 Querying GenieBook with MULTICALL optimization...');
    console.log('GenieBook Address:', GENIEBOOK_ADDRESS);
    
    // Initialize multicall service
    const GenieMulticallService = require('./services/GenieMulticallService');
    const SinusoidalGenieABI = require('../utils/SinusoidalGenie.json');
    
    const genieService = new GenieMulticallService(
      provider,
      GENIEBOOK_ADDRESS,
      GenieBookABI,
      SinusoidalGenieABI,
      PolynomialGenieABI
    );
    
    // Check if multicall is available
    const multicallAvailable = await genieService.isMulticallAvailable();
    console.log(`📡 Multicall availability: ${multicallAvailable ? '✅ Available' : '❌ Not available'}`);
    
    // Get all genies with optimized multicall (2 RPC calls vs 1+3N)
    const validContracts = await genieService.getAllGeniesWithMetadata();
    
    console.log(`✅ Successfully fetched ${validContracts.length} genie contracts`);
    console.log('🚀 RPC OPTIMIZATION: Reduced from 1+3N calls to 2 calls total!');
    
    res.json({
      success: true,
      contracts: validContracts,
      total: validContracts.length,
      multicallUsed: multicallAvailable
    });
  } catch (error) {
    console.error('❌ Error fetching genie contracts:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch genie contracts',
      details: error.message 
    });
  }
});

// Get specific genie contract details
app.get('/api/genie/:contractAddress', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    console.log('🔍 Fetching genie details for:', contractAddress);
    
    const genieBookContract = new ethers.Contract(GENIEBOOK_ADDRESS, GenieBookABI, provider);
    const genieMeta = await genieBookContract.getGenieMeta(contractAddress);
    
    const formattedContract = {
      address: genieMeta.genieAddress,
      underlyingToken: genieMeta.underlyingToken,
      strikeToken: genieMeta.strikeToken,
      underlyingSymbol: genieMeta.underlyingSymbol,
      strikeSymbol: genieMeta.strikeSymbol,
      strikePrice: genieMeta.strikePrice.toString(),
      optionSize: genieMeta.positionSize.toString(),
      premium: genieMeta.premium.toString(),
      expiry: Number(genieMeta.expiry),
      priceAtExpiry: genieMeta.priceAtExpiry.toString(),
      isExercised: genieMeta.isExercised,
      isResolved: genieMeta.isResolved,
      long: genieMeta.long,
      short: genieMeta.short,
      payoffType: genieMeta.payoffType,
      payoffPower: genieMeta.payoffPower,
      isActive: genieMeta.long !== ethers.ZeroAddress && genieMeta.short !== ethers.ZeroAddress,
      isFunded: genieMeta.short !== ethers.ZeroAddress,
      contractType: 'genie'
    };
    
    console.log('✅ Genie contract details fetched successfully');
    
    res.json({
      success: true,
      contract: formattedContract,
      genieBookAddress: GENIEBOOK_ADDRESS,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Error fetching genie contract details:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch genie contract details',
      details: error.message 
    });
  }
});

// Create sinusoidal genie contract
app.post('/api/genie/create-sinusoidal', async (req, res) => {
  try {
    const {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      oracle,
      userAddress,
      sinusoidalAmplitude,
      sinusoidalPeriod,
      expirySeconds = '300'
    } = req.body;
    
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    console.log('🧞 Creating sinusoidal genie contract:', {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      oracle,
      userAddress,
      sinusoidalAmplitude,
      sinusoidalPeriod,
      expirySeconds
    });
    
    console.log('📍 Contract addresses being used:', {
      GENIEBOOK_ADDRESS,
      strikeToken,
      underlyingToken,
      oracle,
      provider: !!provider
    });
    
    // Validate required parameters
    if (!underlyingToken || !strikeToken || !strikePrice || !optionSize || !oracle || !userAddress) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Validate each address individually for better error reporting
    if (!ethers.isAddress(underlyingToken)) {
      return res.status(400).json({ error: 'Invalid underlyingToken address format', address: underlyingToken });
    }
    if (!ethers.isAddress(strikeToken)) {
      return res.status(400).json({ error: 'Invalid strikeToken address format', address: strikeToken });
    }
    if (!ethers.isAddress(oracle)) {
      return res.status(400).json({ error: 'Invalid oracle address format', address: oracle });
    }
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({ error: 'Invalid userAddress format', address: userAddress });
    }
    if (!GENIEBOOK_ADDRESS || !ethers.isAddress(GENIEBOOK_ADDRESS)) {
      return res.status(500).json({ error: 'GenieBook address not configured or invalid', address: GENIEBOOK_ADDRESS });
    }
    
    // Convert parameters to proper format
    const positionSize = ethers.parseUnits(optionSize.toString(), 18);
    const strikePricePerUnit = ethers.parseUnits(strikePrice.toString(), 18);
    // Calculate total strike notional: strikePricePerUnit * positionSize
    const strikeNotional = (strikePricePerUnit * positionSize) / ethers.parseUnits("1", 18);
    const amplitude1e18 = ethers.parseUnits((sinusoidalAmplitude || '1.0').toString(), 18);
    const period1e18 = sinusoidalPeriod ? 
      ethers.parseUnits(sinusoidalPeriod.toString(), 18) : 
      strikePricePerUnit; // Default to strike price per unit
    
    console.log('📊 Parsed genie parameters:', {
      positionSize: positionSize.toString(),
      strikeNotional: strikeNotional.toString(),
      amplitude1e18: amplitude1e18.toString(),
      period1e18: period1e18.toString(),
      expirySeconds
    });
    
    let genieBookContract;
    let strikeTokenContract;
    
    try {
      console.log('🔧 Creating GenieBook contract instance...');
      console.log('  GENIEBOOK_ADDRESS:', GENIEBOOK_ADDRESS);
      console.log('  GenieBookABI length:', GenieBookABI.length);
      console.log('  Provider:', !!provider);
      
      // Test if we can get code from GenieBook address
      const genieBookCode = await provider.getCode(GENIEBOOK_ADDRESS);
      console.log('  GenieBook contract code length:', genieBookCode.length);
      
      if (genieBookCode === '0x') {
        return res.status(500).json({ 
          error: 'GenieBook contract not deployed at address',
          address: GENIEBOOK_ADDRESS
        });
      }
      
      genieBookContract = new ethers.Contract(GENIEBOOK_ADDRESS, GenieBookABI, provider);
      
      console.log('🔧 Creating strike token contract instance...');
      console.log('  strikeToken:', strikeToken);
      
      // Test if we can get code from strike token address  
      const tokenCode = await provider.getCode(strikeToken);
      console.log('  Strike token contract code length:', tokenCode.length);
      
      if (tokenCode === '0x') {
        return res.status(500).json({ 
          error: 'Strike token contract not deployed at address',
          address: strikeToken
        });
      }
      
      strikeTokenContract = new ethers.Contract(strikeToken, MTKABI, provider);
      
      console.log('✅ Contract instances created successfully');
    } catch (contractError) {
      console.error('❌ Error creating contract instances:', contractError);
      return res.status(500).json({ 
        error: 'Failed to create contract instances',
        details: contractError.message,
        addresses: { GENIEBOOK_ADDRESS, strikeToken }
      });
    }
    
    // Create transaction data for createAndFundSinusoidalGenie
    const createParams = [
      underlyingToken,
      strikeToken,
      underlyingSymbol || 'UND',
      strikeSymbol || 'STK',
      positionSize,
      0, // premium must be 0 for genies
      oracle,
      strikeNotional,
      false, // makerIsLong = false (maker is short)
      parseInt(expirySeconds),
      amplitude1e18,
      period1e18
    ];
    
    console.log('🔧 createAndFundSinusoidalGenie parameters:', {
      underlyingToken,
      strikeToken,
      underlyingSymbol: underlyingSymbol || 'UND',
      strikeSymbol: strikeSymbol || 'STK',
      positionSize: positionSize.toString(),
      premium: '0',
      oracle,
      strikeNotional: strikeNotional.toString(),
      makerIsLong: false,
      expirySeconds: parseInt(expirySeconds),
      amplitude1e18: amplitude1e18.toString(),
      period1e18: period1e18.toString()
    });
    
    const createData = genieBookContract.interface.encodeFunctionData('createAndFundSinusoidalGenie', createParams);
    
    // Create approval transaction data
    // For genies: if maker is short, they need to approve underlyingToken for positionSize
    // if maker is long, they approve strikeToken for strikeNotional
    const makerIsLong = false; // We set maker as short
    const tokenToApprove = makerIsLong ? strikeToken : underlyingToken;
    const amountToApprove = makerIsLong ? strikeNotional : positionSize;
    
    console.log('📋 Token approval details:', {
      makerIsLong,
      tokenToApprove,
      amountToApprove: amountToApprove.toString(),
      strikeToken,
      underlyingToken,
      strikeNotional: strikeNotional.toString(),
      positionSize: positionSize.toString()
    });
    
    const approveTokenContract = new ethers.Contract(tokenToApprove, MTKABI, provider);
    const approveData = approveTokenContract.interface.encodeFunctionData('approve', [GENIEBOOK_ADDRESS, amountToApprove]);
    
    console.log('✅ Genie contract creation transactions prepared');
    
    res.json({
      success: true,
      message: 'Sinusoidal genie creation transactions prepared for MetaMask signing',
      data: {
        createTransaction: {
          to: GENIEBOOK_ADDRESS,
          data: createData,
          value: '0x0'
        },
        approveTransaction: {
          to: tokenToApprove,
          data: approveData,
          value: '0x0'
        },
        tokenToApprove: tokenToApprove,
        amountToApprove: amountToApprove.toString(),
        futuresBookAddress: GENIEBOOK_ADDRESS, // Genies use GenieBook instead of FuturesBook
        genieBookAddress: GENIEBOOK_ADDRESS,
        fundingDetails: {
          makerSide: 'short', // Genie makers are always short
          fundingToken: tokenToApprove,
          fundingAmount: ethers.formatUnits(amountToApprove, 18),
          strikeNotional: ethers.formatUnits(strikeNotional, 18),
          positionSize: ethers.formatUnits(positionSize, 18),
          amplitude: sinusoidalAmplitude || '1.0',
          period: sinusoidalPeriod || 'strike price'
        },
        estimatedGas: {
          approve: '50000',
          create: '800000'
        }
      }
    });
  } catch (error) {
    console.error('❌ Error preparing sinusoidal genie creation:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to prepare sinusoidal genie creation transaction',
      details: error.message 
    });
  }
});

// Create polynomial genie contract
app.post('/api/genie/create-polynomial', async (req, res) => {
  try {
    const {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      oracle,
      userAddress,
      expirySeconds = '300',
      fullPayLine = '1.0' // Default fullPayLine value
    } = req.body;

    console.log('🧞 Creating polynomial genie contract with parameters:', {
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      oracle,
      userAddress,
      expirySeconds,
      fullPayLine
    });

    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }

    // Validate required fields
    if (!underlyingToken || !strikeToken || !strikePrice || !optionSize || !oracle || !userAddress) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['underlyingToken', 'strikeToken', 'strikePrice', 'optionSize', 'oracle', 'userAddress']
      });
    }

    // Validate ethereum addresses
    if (!ethers.isAddress(underlyingToken) || !ethers.isAddress(strikeToken) || 
        !ethers.isAddress(oracle) || !ethers.isAddress(userAddress)) {
      return res.status(400).json({ error: 'Invalid ethereum address format' });
    }

    // Parse and validate fullPayLine
    const fullPayLineFloat = parseFloat(fullPayLine);
    if (!fullPayLineFloat || fullPayLineFloat <= 0) {
      return res.status(400).json({ 
        error: 'Invalid fullPayLine parameter',
        details: 'fullPayLine must be a positive number greater than 0'
      });
    }

    // Convert fullPayLine to 1e18 scale  
    const fullPayLine1e18 = ethers.parseUnits(fullPayLineFloat.toString(), 18);

    // Parse other values
    const strikePricePerUnit = ethers.parseUnits(strikePrice.toString(), 18);
    const positionSize = ethers.parseUnits(optionSize.toString(), 18);
    
    // Calculate strike notional: strikePrice * positionSize
    const strikeNotional = (strikePricePerUnit * positionSize) / ethers.parseUnits("1", 18);
    
    console.log('💰 Calculated financial parameters:', {
      strikePricePerUnit: ethers.formatUnits(strikePricePerUnit, 18),
      positionSize: ethers.formatUnits(positionSize, 18),
      strikeNotional: ethers.formatUnits(strikeNotional, 18),
      fullPayLine1e18: ethers.formatUnits(fullPayLine1e18, 18)
    });

    // Create contract instances to generate transaction data
    let genieBookContract;
    let strikeTokenContract;
    
    try {
      console.log('🔧 Creating GenieBook contract instance...');
      console.log('  GENIEBOOK_ADDRESS:', GENIEBOOK_ADDRESS);
      console.log('  GenieBookABI length:', GenieBookABI.length);
      console.log('  Provider:', !!provider);
      
      // Test if we can get code from GenieBook address
      const genieBookCode = await provider.getCode(GENIEBOOK_ADDRESS);
      console.log('  GenieBook contract code length:', genieBookCode.length);
      
      if (genieBookCode === '0x') {
        return res.status(500).json({ 
          error: 'GenieBook contract not deployed at address',
          address: GENIEBOOK_ADDRESS
        });
      }
      
      genieBookContract = new ethers.Contract(GENIEBOOK_ADDRESS, GenieBookABI, provider);
      
      console.log('🔧 Creating strike token contract instance...');
      console.log('  strikeToken:', strikeToken);
      
      // Test if we can get code from strike token address  
      const strikeTokenCode = await provider.getCode(strikeToken);
      console.log('  Strike token contract code length:', strikeTokenCode.length);
      
      if (strikeTokenCode === '0x') {
        return res.status(400).json({ 
          error: 'Strike token contract not found at address',
          address: strikeToken
        });
      }
      
      strikeTokenContract = new ethers.Contract(strikeToken, MTKABI, provider);
      
    } catch (contractError) {
      console.error('❌ Contract creation failed:', contractError);
      return res.status(500).json({ 
        error: 'Failed to create contract instances',
        details: contractError.message,
        addresses: { GENIEBOOK_ADDRESS, strikeToken }
      });
    }
    
    // Create transaction data for createAndFundPolynomialGenie
    const createParams = [
      underlyingToken,
      strikeToken,
      underlyingSymbol || 'UND',
      strikeSymbol || 'STK',
      positionSize,
      0, // premium must be 0 for genies
      oracle,
      strikeNotional,
      false, // makerIsLong = false (maker is short)
      parseInt(expirySeconds),
      fullPayLine1e18
    ];
    
    console.log('🔧 createAndFundPolynomialGenie parameters:', {
      underlyingToken,
      strikeToken,
      underlyingSymbol: underlyingSymbol || 'UND',
      strikeSymbol: strikeSymbol || 'STK',
      positionSize: positionSize.toString(),
      premium: '0',
      oracle,
      strikeNotional: strikeNotional.toString(),
      makerIsLong: false,
      expirySeconds: parseInt(expirySeconds),
      fullPayLine1e18: fullPayLine1e18.toString()
    });
    
    const createData = genieBookContract.interface.encodeFunctionData('createAndFundPolynomialGenie', createParams);
    
    // Create approval transaction data
    // For genies: if maker is short, they need to approve underlyingToken for positionSize
    // if maker is long, they approve strikeToken for strikeNotional
    const makerIsLong = false; // We set maker as short
    const tokenToApprove = makerIsLong ? strikeToken : underlyingToken;
    const amountToApprove = makerIsLong ? strikeNotional : positionSize;
    
    console.log('📋 Token approval details:', {
      makerIsLong,
      tokenToApprove,
      amountToApprove: ethers.formatUnits(amountToApprove, 18)
    });

    const tokenContract = new ethers.Contract(tokenToApprove, MTKABI, provider);
    const approveData = tokenContract.interface.encodeFunctionData('approve', [
      GENIEBOOK_ADDRESS,
      amountToApprove
    ]);

    res.json({
      success: true,
      message: 'Polynomial genie creation transactions prepared for MetaMask signing',
      data: {
        createTransaction: {
          to: GENIEBOOK_ADDRESS,
          data: createData,
          value: '0x0'
        },
        approveTransaction: {
          to: tokenToApprove,
          data: approveData,
          value: '0x0'
        },
        tokenToApprove: tokenToApprove,
        amountToApprove: amountToApprove.toString(),
        futuresBookAddress: GENIEBOOK_ADDRESS, // Genies use GenieBook instead of FuturesBook
        genieBookAddress: GENIEBOOK_ADDRESS,
        fundingDetails: {
          makerSide: 'short', // Genie makers are always short
          fundingToken: tokenToApprove,
          fundingAmount: ethers.formatUnits(amountToApprove, 18),
          strikeNotional: ethers.formatUnits(strikeNotional, 18),
          positionSize: ethers.formatUnits(positionSize, 18),
          fullPayLine: fullPayLine || '1.0'
        },
        estimatedGas: {
          approve: '50000',
          create: '800000'
        }
      }
    });
  } catch (error) {
    console.error('❌ Error preparing polynomial genie creation:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to prepare polynomial genie creation transaction',
      details: error.message 
    });
  }
});

// Enter genie position
app.post('/api/genie/:contractAddress/enter', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const { userAddress } = req.body;
    
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    if (!userAddress || !ethers.isAddress(userAddress)) {
      return res.status(400).json({ error: 'Invalid user address format' });
    }
    
    console.log('🎯 Preparing genie enter transaction:', { contractAddress, userAddress });
    
    const genieBookContract = new ethers.Contract(GENIEBOOK_ADDRESS, GenieBookABI, provider);
    
    // Prepare enterAndPayPremium transaction data
    const enterData = genieBookContract.interface.encodeFunctionData('enterAndPayPremium', [
      contractAddress,
      0 // premium amount is 0 for genies
    ]);
    
    res.json({
      success: true,
      message: 'Genie enter transaction prepared for MetaMask signing',
      data: {
        enterTransaction: {
          to: GENIEBOOK_ADDRESS,
          data: enterData,
          value: '0x0'
        },
        genieBookAddress: GENIEBOOK_ADDRESS
      }
    });
  } catch (error) {
    console.error('❌ Error preparing genie enter transaction:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to prepare genie enter transaction',
      details: error.message 
    });
  }
});

// Resolve and exercise genie
app.post('/api/genie/:contractAddress/resolveAndExercise', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    const { userAddress } = req.body;
    
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    console.log('⚡ Preparing genie resolve and exercise transaction:', { contractAddress, userAddress });
    
    const genieBookContract = new ethers.Contract(GENIEBOOK_ADDRESS, GenieBookABI, provider);
    
    // Prepare resolveAndExercise transaction data
    const exerciseData = genieBookContract.interface.encodeFunctionData('resolveAndExercise', [
      contractAddress,
      0 // exerciseAmount parameter
    ]);
    
    res.json({
      success: true,
      message: 'Genie resolve and exercise transaction prepared for MetaMask signing',
      data: {
        resolveAndExerciseTransaction: {
          to: GENIEBOOK_ADDRESS,
          data: exerciseData,
          value: '0x0'
        },
        genieBookAddress: GENIEBOOK_ADDRESS
      }
    });
  } catch (error) {
    console.error('❌ Error preparing genie resolve and exercise transaction:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to prepare genie resolve and exercise transaction',
      details: error.message 
    });
  }
});

// Resolve and reclaim genie
app.post('/api/genie/:contractAddress/reclaim', async (req, res) => {
  try {
    const { contractAddress } = req.params;
    
    if (!provider) {
      return res.status(500).json({ error: 'Provider not initialized' });
    }
    
    if (!contractAddress || !ethers.isAddress(contractAddress)) {
      return res.status(400).json({ 
        error: 'Invalid contract address format',
        address: contractAddress 
      });
    }
    
    console.log('💰 Preparing genie reclaim transaction:', { contractAddress });
    
    const genieBookContract = new ethers.Contract(GENIEBOOK_ADDRESS, GenieBookABI, provider);
    
    // Prepare resolveAndReclaim transaction data
    const reclaimData = genieBookContract.interface.encodeFunctionData('resolveAndReclaim', [contractAddress]);
    
    res.json({
      success: true,
      message: 'Genie reclaim transaction prepared for MetaMask signing',
      data: {
        to: GENIEBOOK_ADDRESS,
        data: reclaimData,
        value: '0x0'
      }
    });
  } catch (error) {
    console.error('❌ Error preparing genie reclaim transaction:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to prepare genie reclaim transaction',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize new resolution service
async function initializeResolutionService() {
  try {
    resolutionService = new ResolutionService(provider);
    const initialized = await resolutionService.initialize();
    
    if (initialized) {
      console.log('✅ Event-driven resolution service ready');
    }
  } catch (error) {
    console.error('Failed to initialize resolution service:', error);
  }
}

// Manual resolution trigger
app.post('/api/admin/resolve-expired', async (req, res) => {
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    const resolvedCount = await resolutionService.resolveExpiredContracts();
    res.json({ 
      success: true, 
      message: `Resolution check completed`,
      resolvedCount: resolvedCount
    });
  } catch (error) {
    console.error('Manual resolution error:', error);
    res.status(500).json({ error: 'Failed to run resolution check' });
  }
});

// Get resolution service status
app.get('/api/admin/resolution-status', (req, res) => {
  if (!resolutionService) {
    return res.json({ initialized: false });
  }
  
  res.json(resolutionService.getStatus());
});

// Fund contract endpoint - now triggers database update

// Register new contract in database (called after OptionsBook creation)
app.post('/api/contracts/register', async (req, res) => {
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    const contractData = req.body;
    
    // Validate required fields
    if (!contractData.address || !ethers.isAddress(contractData.address)) {
      return res.status(400).json({ error: 'Invalid contract address' });
    }
    
    await resolutionService.addContract(contractData);
    
    res.json({ 
      success: true, 
      message: 'Contract registered in database',
      address: contractData.address
    });
  } catch (error) {
    console.error('Contract registration error:', error);
    res.status(500).json({ error: 'Failed to register contract' });
  }
});

// Auto-register newly created contracts from OptionsBook transactions
app.post('/api/contracts/auto-register', async (req, res) => {
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    const { 
      transactionHash,
      contractAddress,
      optionType,
      shortAddress,
      underlyingToken,
      strikeToken,
      underlyingSymbol,
      strikeSymbol,
      strikePrice,
      optionSize,
      premium,
      oracle
    } = req.body;
    
    // Prepare contract data for database
    const contractData = {
      address: contractAddress,
      short_address: shortAddress,
      underlying_token: underlyingToken,
      strike_token: strikeToken,
      underlying_symbol: underlyingSymbol,
      strike_symbol: strikeSymbol,
      strike_price: strikePrice,
      option_size: optionSize,
      premium: premium,
      oracle_address: oracle,
      option_type: optionType,
      is_funded: true, // Created via OptionsBook, so automatically funded
      transaction_hash: transactionHash,
      created_at: new Date().toISOString(),
      funded_at: new Date().toISOString()
    };
    
    await resolutionService.addContract(contractData);
    
    console.log(`✅ Auto-registered ${optionType} option contract: ${contractAddress}`);
    
    res.json({ 
      success: true, 
      message: 'Contract auto-registered successfully',
      address: contractAddress
    });
  } catch (error) {
    console.error('Auto-registration error:', error);
    res.status(500).json({ error: 'Failed to auto-register contract' });
  }
});

// Handle contract funded event
app.post('/api/contracts/:contractAddress/funded', async (req, res) => {
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    const { contractAddress } = req.params;
    const { transactionHash } = req.body;
    
    await resolutionService.handleFunded(contractAddress, transactionHash);
    
    res.json({ success: true, message: 'Funded event recorded' });
  } catch (error) {
    console.error('Error handling funded event:', error);
    res.status(500).json({ error: 'Failed to handle funded event' });
  }
});

// Handle long entry event - THE KEY TRIGGER
app.post('/api/contracts/:contractAddress/long-entered', async (req, res) => {
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    const { contractAddress } = req.params;
    const { longAddress, expiry, transactionHash } = req.body;
    
    // For futures contracts, if no expiry is provided, get it from the contract
    let actualExpiry = expiry;
    if (!expiry) {
      try {
        // Check if this is a futures contract by checking FuturesBook
        const futuresBookContract = new ethers.Contract(FUTURESBOOK_ADDRESS, FuturesBookABI, provider);
        const futuresMeta = await futuresBookContract.getFuturesMeta(contractAddress);
        
        if (futuresMeta) {
          // Try to read expiry from the individual futures contract instance
          try {
            const futuresContract = new ethers.Contract(contractAddress, [
              'function expiry() view returns (uint256)'
            ], provider);
            const contractExpiry = await futuresContract.expiry();
            if (contractExpiry && contractExpiry > 0) {
              actualExpiry = contractExpiry.toString();
              console.log(`Using expiry from futures contract instance ${contractAddress}: ${actualExpiry}`);
            } else if (futuresMeta.expiry) {
              actualExpiry = futuresMeta.expiry.toString();
              console.log(`Using expiry from FuturesBook metadata for ${contractAddress}: ${actualExpiry}`);
            } else {
              actualExpiry = Math.floor(Date.now() / 1000) + (5 * 60);
              console.log(`Using default 5-minute expiry for futures contract ${contractAddress}: ${actualExpiry}`);
            }
          } catch (contractError) {
            console.warn('Failed to read expiry from futures contract instance, trying metadata:', contractError.message);
            if (futuresMeta.expiry) {
              actualExpiry = futuresMeta.expiry.toString();
              console.log(`Using expiry from FuturesBook metadata for ${contractAddress}: ${actualExpiry}`);
            } else {
              actualExpiry = Math.floor(Date.now() / 1000) + (5 * 60);
              console.log(`Using default 5-minute expiry for futures contract ${contractAddress}: ${actualExpiry}`);
            }
          }
        } else {
          // Fallback for options contracts - use 5 minutes from now
          actualExpiry = Math.floor(Date.now() / 1000) + (5 * 60);
          console.log(`Using default 5-minute expiry for options contract ${contractAddress}: ${actualExpiry}`);
        }
      } catch (error) {
        console.warn('Failed to get contract expiry, using default:', error.message);
        actualExpiry = Math.floor(Date.now() / 1000) + (5 * 60);
      }
    }
    
    await resolutionService.handleLongEntry(contractAddress, longAddress, actualExpiry, transactionHash);
    
    res.json({ success: true, message: 'Long entry recorded and resolution timer set' });
  } catch (error) {
    console.error('Error handling long entry:', error);
    res.status(500).json({ error: 'Failed to handle long entry' });
  }
});

// Handle exercise event
app.post('/api/contracts/:contractAddress/exercised', async (req, res) => {
  try {
    if (!resolutionService) {
      return res.status(500).json({ error: 'Resolution service not initialized' });
    }
    
    const { contractAddress } = req.params;
    const { transactionHash } = req.body;
    
    await resolutionService.handleExercise(contractAddress, transactionHash);
    
    res.json({ success: true, message: 'Exercise event recorded' });
  } catch (error) {
    console.error('Error handling exercise event:', error);
    res.status(500).json({ error: 'Failed to handle exercise event' });
  }
});

// Test route to isolate the issue




// Routes registered silently

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initializeBlockchain();
  
  // Initialize automated resolution service after a short delay
  setTimeout(async () => {
    await initializeResolutionService();
  }, 2000);
}); 