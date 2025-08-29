const { ethers } = require('ethers');
const MulticallService = require('./MulticallService');

/**
 * GenieMulticallService - Optimized data fetching for genie contracts
 * Reduces RPC calls from 1+3N to just 2 calls total
 */
class GenieMulticallService {
  constructor(provider, genieBookAddress, genieBookABI, sinusoidalGenieABI, polynomialGenieABI) {
    this.provider = provider;
    this.genieBookAddress = genieBookAddress;
    this.genieBookABI = genieBookABI;
    this.sinusoidalGenieABI = sinusoidalGenieABI;
    this.polynomialGenieABI = polynomialGenieABI;
    this.multicallService = new MulticallService(provider);
    
    // Create contract instances for encoding/decoding
    this.genieBookContract = new ethers.Contract(genieBookAddress, genieBookABI, provider);
    this.sinusoidalInterface = new ethers.Interface(sinusoidalGenieABI);
    this.polynomialInterface = new ethers.Interface(polynomialGenieABI);
  }

  /**
   * Get all genie contracts with metadata using optimized multicall
   * Reduces from 1+3N calls to 2 calls total
   */
  async getAllGeniesWithMetadata() {
    console.log('🧞 Starting optimized genie data fetch...');
    
    try {
      // Phase 1: Get all genie addresses (1 RPC call)
      console.log('📋 Phase 1: Getting all genie addresses...');
      const allGenies = await this.genieBookContract.getAllGenies();
      
      console.log(`✅ Found ${allGenies.length} genie contracts`);
      allGenies.forEach((address, index) => {
        console.log(`   ${index + 1}. ${address}`);
      });

      if (allGenies.length === 0) {
        console.log('⚠️ No genie contracts found');
        return [];
      }

      // Phase 2: Batch all metadata + sinusoidal parameter calls (1 RPC call)
      console.log('🚀 Phase 2: Batching all metadata and parameter calls...');
      const results = await this.batchAllGenieData(allGenies);
      
      console.log(`✅ Successfully processed ${results.length} genies with multicall`);
      return results;

    } catch (error) {
      console.error('❌ Multicall failed, falling back to individual calls:', error.message);
      // Fallback to individual calls if multicall fails
      return await this.getAllGeniesIndividual();
    }
  }

  /**
   * Batch all genie metadata and type-specific parameters into one multicall
   * Supports both sinusoidal and polynomial genies
   */
  async batchAllGenieData(addresses) {
    const calls = [];
    
    // Phase 1: Get metadata for all genies to determine contract types
    console.log('📋 Phase 1: Getting metadata for all genies to determine types...');
    addresses.forEach(address => {
      calls.push({
        target: this.genieBookAddress,
        callData: this.genieBookContract.interface.encodeFunctionData('getGenieMeta', [address]),
        decoder: (result) => this.genieBookContract.interface.decodeFunctionResult('getGenieMeta', result)[0]
      });
    });

    console.log(`📡 Executing metadata multicall with ${calls.length} contract calls...`);
    const metadataResults = await this.multicallService.batchCall(calls);
    
    // Phase 2: Based on contract types, add parameter calls
    console.log('🔧 Phase 2: Adding type-specific parameter calls...');
    const parameterCalls = [];
    
    addresses.forEach((address, index) => {
      const meta = metadataResults[index];
      if (!meta) {
        console.warn(`No metadata for genie ${address}, skipping parameter calls`);
        return;
      }

      const payoffType = meta.payoffType;
      console.log(`🎯 Genie ${address} type: ${payoffType}`);

      if (payoffType === 'SinusoidalGenie') {
        // Add sinusoidal parameter calls
        parameterCalls.push({
          target: address,
          callData: this.sinusoidalInterface.encodeFunctionData('amplitude1e18', []),
          decoder: (result) => {
            try {
              return this.sinusoidalInterface.decodeFunctionResult('amplitude1e18', result)[0];
            } catch (error) {
              console.warn(`Failed to decode amplitude for ${address}:`, error.message);
              return ethers.parseUnits('1', 18); // Default 100%
            }
          },
          genieIndex: index,
          paramType: 'amplitude'
        });

        parameterCalls.push({
          target: address,
          callData: this.sinusoidalInterface.encodeFunctionData('period1e18', []),
          decoder: (result) => {
            try {
              return this.sinusoidalInterface.decodeFunctionResult('period1e18', result)[0];
            } catch (error) {
              console.warn(`Failed to decode period for ${address}:`, error.message);
              return ethers.parseUnits('1', 18); // Default period
            }
          },
          genieIndex: index,
          paramType: 'period'
        });
      } else if (payoffType === 'PolynomialGenie') {
        // Add polynomial parameter calls
        parameterCalls.push({
          target: address,
          callData: this.polynomialInterface.encodeFunctionData('fullPayLine1e18', []),
          decoder: (result) => {
            try {
              return this.polynomialInterface.decodeFunctionResult('fullPayLine1e18', result)[0];
            } catch (error) {
              console.warn(`Failed to decode fullPayLine for ${address}:`, error.message);
              return ethers.parseUnits('1', 18); // Default full pay line
            }
          },
          genieIndex: index,
          paramType: 'fullPayLine'
        });
      } else {
        console.warn(`Unknown payoff type ${payoffType} for genie ${address}`);
      }
    });

    console.log(`📡 Executing parameter multicall with ${parameterCalls.length} contract calls...`);
    const parameterResults = await this.multicallService.batchCall(parameterCalls);
    
    // Phase 3: Combine metadata and parameter results
    console.log('🔄 Phase 3: Processing and combining results...');
    const genies = [];
    
    // Create parameter lookup map by genie index and type
    const parameterMap = {};
    parameterCalls.forEach((call, resultIndex) => {
      const genieIndex = call.genieIndex;
      const paramType = call.paramType;
      const result = parameterResults[resultIndex];
      
      if (!parameterMap[genieIndex]) {
        parameterMap[genieIndex] = {};
      }
      parameterMap[genieIndex][paramType] = result;
    });
    
    // Process each genie
    addresses.forEach((address, index) => {
      const meta = metadataResults[index];
      if (!meta) {
        console.warn(`No metadata for genie ${address}, skipping`);
        return;
      }

      const params = parameterMap[index] || {};
      
      try {
        const genieData = {
          address: address,
          underlyingToken: meta.underlyingToken,
          strikeToken: meta.strikeToken,
          underlyingSymbol: meta.underlyingSymbol,
          strikeSymbol: meta.strikeSymbol,
          strikePrice: meta.strikePrice.toString(),
          optionSize: meta.positionSize.toString(),
          premium: meta.premium.toString(),
          expiry: meta.expiry.toString(),
          exercisedAmount: meta.exercisedAmount.toString(),
          priceAtExpiry: meta.priceAtExpiry.toString(),
          isExercised: meta.isExercised,
          isResolved: meta.isResolved,
          long: meta.long,
          short: meta.short,
          payoffType: meta.payoffType,
          payoffPower: Number(meta.payoffPower),
          isActive: meta.long !== ethers.ZeroAddress && meta.short !== ethers.ZeroAddress,
          isFunded: meta.short !== ethers.ZeroAddress,
          contractType: 'genie'
        };

        // Add type-specific parameters
        if (meta.payoffType === 'SinusoidalGenie') {
          genieData.amplitude = params.amplitude ? (Number(params.amplitude) / 1e18) : 1.0;
          genieData.period = params.period ? (Number(params.period) / 1e18) : 1.0;
        } else if (meta.payoffType === 'PolynomialGenie') {
          genieData.fullPayLine = params.fullPayLine ? (Number(params.fullPayLine) / 1e18) : 1.0;
        }

        genies.push(genieData);
      } catch (error) {
        console.warn(`Failed to process genie ${address}:`, error.message);
      }
    });

    console.log(`✅ Successfully processed ${genies.length} genies with 2-phase multicall`);
    return genies;
  }

  /**
   * Fallback: Individual calls (original implementation)
   */
  async getAllGeniesIndividual() {
    console.log('🔄 Using fallback: individual contract calls');
    
    const allGenies = await this.genieBookContract.getAllGenies();
    
    const metadataPromises = allGenies.map(async (address) => {
      try {
        const meta = await this.genieBookContract.getGenieMeta(address);
        
        // Create a new object to avoid immutability issues
        let processedMeta = {
          genieAddress: meta.genieAddress,
          underlyingToken: meta.underlyingToken,
          strikeToken: meta.strikeToken,
          underlyingSymbol: meta.underlyingSymbol,
          strikeSymbol: meta.strikeSymbol,
          strikePrice: meta.strikePrice,
          positionSize: meta.positionSize,
          premium: meta.premium,
          expiry: meta.expiry,
          priceAtExpiry: meta.priceAtExpiry,
          exercisedAmount: meta.exercisedAmount,
          isExercised: meta.isExercised,
          isResolved: meta.isResolved,
          long: meta.long,
          short: meta.short,
          payoffType: meta.payoffType,
          payoffPower: meta.payoffPower,
          amplitude1e18: ethers.parseUnits('1', 18), // Default
          period1e18: ethers.parseUnits('1', 18) // Default
        };

        if (processedMeta.payoffType === 'SinusoidalGenie') {
          try {
            const sinusoidalContract = new ethers.Contract(address, this.sinusoidalGenieABI, this.provider);
            const [amplitude, period] = await Promise.all([
              sinusoidalContract.amplitude1e18(),
              sinusoidalContract.period1e18()
            ]);
            processedMeta.amplitude1e18 = amplitude;
            processedMeta.period1e18 = period;
          } catch (error) {
            console.warn(`Failed to fetch sinusoidal parameters for ${address}:`, error.message);
            // Keep defaults
          }
        } else if (processedMeta.payoffType === 'PolynomialGenie') {
          try {
            const polynomialContract = new ethers.Contract(address, this.polynomialGenieABI, this.provider);
            const fullPayLine = await polynomialContract.fullPayLine1e18();
            processedMeta.fullPayLine1e18 = fullPayLine;
          } catch (error) {
            console.warn(`Failed to fetch polynomial parameters for ${address}:`, error.message);
            // Use default
            processedMeta.fullPayLine1e18 = ethers.parseUnits('1', 18);
          }
        }
        
        return {
          address: processedMeta.genieAddress,
          underlyingToken: processedMeta.underlyingToken,
          strikeToken: processedMeta.strikeToken,
          underlyingSymbol: processedMeta.underlyingSymbol,
          strikeSymbol: processedMeta.strikeSymbol,
          strikePrice: processedMeta.strikePrice.toString(),
          optionSize: processedMeta.positionSize.toString(),
          premium: processedMeta.premium.toString(),
          expiry: processedMeta.expiry.toString(),
          exercisedAmount: processedMeta.exercisedAmount.toString(),
          priceAtExpiry: processedMeta.priceAtExpiry.toString(),
          isExercised: processedMeta.isExercised,
          isResolved: processedMeta.isResolved,
          long: processedMeta.long,
          short: processedMeta.short,
          payoffType: processedMeta.payoffType,
          payoffPower: Number(processedMeta.payoffPower),
          isActive: processedMeta.long !== ethers.ZeroAddress && processedMeta.short !== ethers.ZeroAddress,
          isFunded: processedMeta.short !== ethers.ZeroAddress,
          contractType: 'genie'
        };

        // Add type-specific parameters
        if (processedMeta.payoffType === 'SinusoidalGenie') {
          result.amplitude = processedMeta.amplitude1e18 ? (Number(processedMeta.amplitude1e18) / 1e18) : 1.0;
          result.period = processedMeta.period1e18 ? (Number(processedMeta.period1e18) / 1e18) : 1.0;
        } else if (processedMeta.payoffType === 'PolynomialGenie') {
          result.fullPayLine = processedMeta.fullPayLine1e18 ? (Number(processedMeta.fullPayLine1e18) / 1e18) : 1.0;
        }

        return result;
      } catch (error) {
        console.error(`Error fetching metadata for ${address}:`, error);
        return null;
      }
    });
    
    const allMetadata = await Promise.all(metadataPromises);
    return allMetadata.filter(meta => meta !== null);
  }

  /**
   * Check if multicall optimization is available
   */
  async isMulticallAvailable() {
    return await this.multicallService.isAvailable();
  }
}

module.exports = GenieMulticallService;