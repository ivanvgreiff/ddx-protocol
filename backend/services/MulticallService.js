const { ethers } = require('ethers');

/**
 * MulticallService - Bundles multiple contract calls into a single RPC request
 * Uses Multicall3 contract deployed on 100+ networks
 */
class MulticallService {
  // Multicall3 deployed on most networks including Ethereum mainnet
  static MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
  
  // Multicall3 ABI - only need the aggregate function
  static MULTICALL3_ABI = [
    {
      "inputs": [
        {
          "components": [
            {"internalType": "address", "name": "target", "type": "address"},
            {"internalType": "bytes", "name": "callData", "type": "bytes"}
          ],
          "internalType": "struct Multicall3.Call[]",
          "name": "calls",
          "type": "tuple[]"
        }
      ],
      "name": "aggregate",
      "outputs": [
        {"internalType": "uint256", "name": "blockNumber", "type": "uint256"},
        {"internalType": "bytes[]", "name": "returnData", "type": "bytes[]"}
      ],
      "stateMutability": "view",
      "type": "function"
    }
  ];

  constructor(provider, multicallAddress = null) {
    this.provider = provider;
    this.multicallAddress = multicallAddress || MulticallService.MULTICALL3_ADDRESS;
    this.multicallContract = new ethers.Contract(
      this.multicallAddress, 
      MulticallService.MULTICALL3_ABI, 
      provider
    );
  }

  /**
   * Execute multiple contract calls in a single transaction
   * @param {Array} calls - Array of {target, callData, decoder} objects
   * @returns {Array} Results array with decoded values
   */
  async batchCall(calls) {
    if (!calls || calls.length === 0) {
      return [];
    }

    console.log(`🔄 Executing multicall with ${calls.length} calls...`);
    
    try {
      // Prepare calls for Multicall3 contract
      const multicallData = calls.map(call => ({
        target: call.target,
        callData: call.callData
      }));

      // Execute multicall (static call)
      const [blockNumber, results] = await this.multicallContract.aggregate.staticCall(multicallData);
      
      console.log(`✅ Multicall completed at block ${blockNumber}`);
      
      // Decode results using provided decoders
      const decodedResults = results.map((result, index) => {
        try {
          if (calls[index].decoder) {
            return calls[index].decoder(result);
          }
          return result;
        } catch (error) {
          console.warn(`⚠️ Failed to decode result ${index} for target ${calls[index].target}:`, error.message);
          return null;
        }
      });

      return decodedResults;
    } catch (error) {
      console.error('❌ Multicall failed:', error.message);
      throw new Error(`Multicall execution failed: ${error.message}`);
    }
  }

  /**
   * Check if Multicall3 contract is available on current network
   */
  async isAvailable() {
    try {
      const code = await this.provider.getCode(this.multicallAddress);
      return code !== '0x';
    } catch (error) {
      console.warn('Failed to check multicall availability:', error.message);
      return false;
    }
  }
}

module.exports = MulticallService;