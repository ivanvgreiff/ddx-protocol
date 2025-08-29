const { ethers } = require('ethers');
const MulticallService = require('./MulticallService');

/**
 * GenieMulticallService - Optimized data fetching for genie contracts
 * Reduces RPC calls from 1+3N to just 2 calls total
 */
class GenieMulticallService {
  constructor(provider, genieBookAddress, genieBookABI, sinusoidalGenieABI) {
    this.provider = provider;
    this.genieBookAddress = genieBookAddress;
    this.genieBookABI = genieBookABI;
    this.sinusoidalGenieABI = sinusoidalGenieABI;
    this.multicallService = new MulticallService(provider);
    
    // Create contract instances for encoding/decoding
    this.genieBookContract = new ethers.Contract(genieBookAddress, genieBookABI, provider);
    this.sinusoidalInterface = new ethers.Interface(sinusoidalGenieABI);
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
   * Batch all genie metadata and sinusoidal parameters into one multicall
   */
  async batchAllGenieData(addresses) {
    const calls = [];
    
    // Build multicall requests: 3 calls per genie (metadata + amplitude + period)
    addresses.forEach(address => {
      // Call 1: getGenieMeta
      calls.push({
        target: this.genieBookAddress,
        callData: this.genieBookContract.interface.encodeFunctionData('getGenieMeta', [address]),
        decoder: (result) => this.genieBookContract.interface.decodeFunctionResult('getGenieMeta', result)[0]
      });

      // Call 2: amplitude1e18
      calls.push({
        target: address,
        callData: this.sinusoidalInterface.encodeFunctionData('amplitude1e18', []),
        decoder: (result) => {
          try {
            return this.sinusoidalInterface.decodeFunctionResult('amplitude1e18', result)[0];
          } catch (error) {
            console.warn(`Failed to decode amplitude for ${address}:`, error.message);
            return ethers.parseUnits('1', 18); // Default 100%
          }
        }
      });

      // Call 3: period1e18  
      calls.push({
        target: address,
        callData: this.sinusoidalInterface.encodeFunctionData('period1e18', []),
        decoder: (result) => {
          try {
            return this.sinusoidalInterface.decodeFunctionResult('period1e18', result)[0];
          } catch (error) {
            console.warn(`Failed to decode period for ${address}:`, error.message);
            return ethers.parseUnits('1', 18); // Default period
          }
        }
      });
    });

    console.log(`📡 Executing single multicall with ${calls.length} contract calls...`);
    
    // Execute the multicall
    const results = await this.multicallService.batchCall(calls);
    
    // Process results: group every 3 results per genie
    const genies = [];
    for (let i = 0; i < addresses.length; i++) {
      const baseIndex = i * 3;
      const meta = results[baseIndex];     // getGenieMeta result
      const amplitude = results[baseIndex + 1]; // amplitude1e18 result
      const period = results[baseIndex + 2];    // period1e18 result

      if (meta) {
        try {
          genies.push({
            address: addresses[i],
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
            // Add sinusoidal parameters with fallbacks
            amplitude: amplitude ? (Number(amplitude) / 1e18) : 1.0,
            period: period ? (Number(period) / 1e18) : 1.0,
            isActive: meta.long !== ethers.ZeroAddress && meta.short !== ethers.ZeroAddress,
            isFunded: meta.short !== ethers.ZeroAddress,
            contractType: 'genie'
          });
        } catch (error) {
          console.warn(`Failed to process genie ${addresses[i]}:`, error.message);
        }
      }
    }

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
        
        if (meta.payoffType === 'SinusoidalGenie') {
          try {
            const sinusoidalContract = new ethers.Contract(address, this.sinusoidalGenieABI, this.provider);
            const [amplitude, period] = await Promise.all([
              sinusoidalContract.amplitude1e18(),
              sinusoidalContract.period1e18()
            ]);
            meta.amplitude1e18 = amplitude;
            meta.period1e18 = period;
          } catch (error) {
            console.warn(`Failed to fetch sinusoidal parameters for ${address}:`, error.message);
            meta.amplitude1e18 = ethers.parseUnits('1', 18);
            meta.period1e18 = ethers.parseUnits('1', 18);
          }
        }
        
        return {
          address: meta.genieAddress,
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
          amplitude: meta.amplitude1e18 ? (Number(meta.amplitude1e18) / 1e18) : 1.0,
          period: meta.period1e18 ? (Number(meta.period1e18) / 1e18) : 1.0,
          isActive: meta.long !== ethers.ZeroAddress && meta.short !== ethers.ZeroAddress,
          isFunded: meta.short !== ethers.ZeroAddress,
          contractType: 'genie'
        };
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