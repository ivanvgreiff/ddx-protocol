"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Plus, DollarSign, AlertTriangle, CheckCircle, Copy, ExternalLink, Sparkles } from 'lucide-react'

// Real wallet context hook
import { useWallet } from "@/components/wallet-context"
import { ethers } from 'ethers'

// Real data fetching hook
const useQuery = (key: string, fetchFn: () => Promise<any>, options?: any) => {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<any>(null)

  useEffect(() => {
    if (options?.enabled === false) return

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await fetchFn()
        setData(result)
      } catch (err) {
        setError(err)
        console.error(`Error fetching ${key}:`, err)
      } finally {
        setIsLoading(false)
      }
    }

    if (options?.enabled !== false) {
      fetchData()
    }
  }, [key, options?.enabled])

  return { data, isLoading, error }
}

// Toast notification system (simplified)
const toast = {
  success: (message: string) => {
    console.log('✅', message)
    alert(`Success: ${message}`)
  },
  error: (message: string) => {
    console.error('❌', message)
    alert(`Error: ${message}`)
  },
  loading: (message: string) => {
    console.log('⏳', message)
    return Math.random() // Return a simple ID
  },
  dismiss: (id?: any) => {
    console.log('Toast dismissed')
  }
}

export default function CreateOptionPage() {
  const router = useRouter()
  const { account, provider, sendTransaction } = useWallet()
  const [formData, setFormData] = useState({
    underlyingToken: '',
    strikeToken: '',
    underlyingSymbol: '',
    strikeSymbol: '',
    strikePrice: '',
    optionSize: '',
    premium: '',
    oracle: ''
  })
  const [contractType, setContractType] = useState('option') // 'option' or 'future'
  const [optionType, setOptionType] = useState('call')
  const [payoffType, setPayoffType] = useState('Linear')
  const [payoffPower, setPayoffPower] = useState('2') // For power payoffs
  const [sigmoidIntensity, setSigmoidIntensity] = useState('1.0') // For sigmoid payoffs
  const [makerSide, setMakerSide] = useState('short') // 'long' or 'short' - only for futures
  const [expirySeconds, setExpirySeconds] = useState('300') // Default 5 minutes for futures
  const [isCreating, setIsCreating] = useState(false)
  const [contractDeploymentInfo, setContractDeploymentInfo] = useState<any>(null)

  // Fetch oracle prices for token selection
  const { data: oraclePrices } = useQuery('oraclePrices', async () => {
    const response = await fetch('/api/oracle/prices')
    if (!response.ok) {
      throw new Error('Failed to fetch oracle prices')
    }
    return await response.json()
  }, {
    enabled: false // Don't auto-fetch on page load
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy:', error)
      toast.error('Failed to copy')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    console.log('Wallet address:', account)
    console.log('Network info from MetaMask:', (window as any).ethereum?.networkVersion)
    console.log('Option parameters:', {
      optionType,
      underlyingToken: formData.underlyingToken,
      strikeToken: formData.strikeToken,
      optionSize: formData.optionSize,
      oracle: formData.oracle
    })

    setIsCreating(true)
    
    // Show initial loading message
    const loadingToast = toast.loading('Preparing transactions...')
    
    try {
      // Step 1: Get transaction data from backend
      const requestData = {
        ...formData,
        userAddress: account,
        payoffType: payoffType,
        payoffPower: payoffPower,
        sigmoidIntensity: sigmoidIntensity,
        ...(contractType === 'future' && {
          makerSide: makerSide,
          expirySeconds: expirySeconds || '300'
        })
      }
      
      let endpoint: string
      if (contractType === 'future') {
        endpoint = '/api/futures/create-future'
      } else {
        endpoint = optionType === 'call' ? '/api/option/create-call' : '/api/option/create-put'
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare transactions')
      }
      
      const data = await response.json()
      
      // Check if backend detected transaction would fail
      if (!data.success) {
        const errorMsg = data.details || data.error || 'Unknown error'
        toast.dismiss(loadingToast)
        toast.error(`Contract Error: ${errorMsg}`)
        return
      }
      
      if (data.success && data.data) {
        const { approveTransaction, createTransaction, tokenToApprove, amountToApprove, optionsBookAddress, futuresBookAddress } = data.data
        
        // Step 2: Check current allowance
        toast.dismiss(loadingToast)
        toast.loading('Checking token allowance...')
        
        if (!provider) {
          throw new Error('Provider not available')
        }

        const tokenContract = new ethers.Contract(
          tokenToApprove,
          ['function allowance(address owner, address spender) view returns (uint256)'],
          provider
        )
        
        const bookAddress = contractType === 'future' ? futuresBookAddress : optionsBookAddress
        const currentAllowance = await tokenContract.allowance(account, bookAddress)
        const requiredAmount = ethers.getBigInt(amountToApprove)
        
        console.log('Current allowance:', ethers.formatUnits(currentAllowance, 18))
        console.log('Required amount:', ethers.formatUnits(requiredAmount, 18))
        
        // Step 3: Send separate approval transaction if needed (force for testing new contract)
        if (currentAllowance < requiredAmount || true) {
          toast.dismiss()
          toast.loading('Please approve token spending... (Transaction 1/2)')
          
          console.log('Sending approval transaction:', approveTransaction)
          const approveTx = await sendTransaction(approveTransaction)
          
          if (approveTx) {
            toast.loading('Waiting for approval confirmation... (Transaction 1/2)')
            await approveTx.wait()
            toast.success('✅ Token approval confirmed!')
          } else {
            throw new Error('Approval transaction failed')
          }
        } else {
          toast.success('✅ Token already approved!')
        }
        
        // Step 4: Send separate option creation transaction
        toast.loading(contractType === 'future' 
          ? 'Waiting for futures creation confirmation...'
          : 'Waiting for option creation confirmation...')
        
        console.log('Sending option creation transaction:', createTransaction)
        console.log('🔍 DEBUG: Transaction details:')
        console.log('  - To:', createTransaction.to)
        console.log('  - Data length:', createTransaction.data?.length)
        console.log('  - Gas estimation...')
        
        // Try to estimate gas first to get better error info
        try {
          const gasEstimate = await provider.estimateGas({
            to: createTransaction.to,
            data: createTransaction.data,
            from: account
          })
          console.log('✅ Gas estimate successful:', gasEstimate.toString())
        } catch (gasError: any) {
          console.error('❌ Gas estimation failed:', gasError)
          console.error('❌ Gas error details:', {
            code: gasError.code,
            reason: gasError.reason,
            data: gasError.data,
            transaction: gasError.transaction
          })
          
          // Try to decode the error
          if (gasError.data) {
            console.error('❌ Raw error data:', gasError.data)
          }
          
          throw new Error(`Gas estimation failed: ${gasError.reason || gasError.message}`)
        }
        
        const tx = await sendTransaction(createTransaction)
        
        if (tx) {
          toast.loading(contractType === 'future' 
            ? 'Waiting for futures creation confirmation...'
            : 'Waiting for option creation confirmation...')
          
          // Wait for confirmation
          const receipt = await tx.wait()
          const deployTxHash = tx.hash
          
          toast.success('Option created successfully!')
          
          // Extract contract address from the transaction logs
          let contractAddress = null
          try {
            console.log('Extracting contract address from transaction receipt...')
            
            if (contractType === 'future') {
              // Look for FutureCreated event in the logs for futures
              const futureCreatedLog = receipt.logs.find((log: any) => {
                // FuturesBook FutureCreated event has 4 topics: event signature, creator, instance, futureType
                return log.topics && log.topics.length === 4
              })
              
              if (futureCreatedLog) {
                // The contract address is the second indexed parameter (topics[2]) for futures
                contractAddress = ethers.getAddress('0x' + futureCreatedLog.topics[2].slice(26))
                console.log('✅ Extracted futures contract address from logs:', contractAddress)
              }
            } else {
              // Look for OptionCreated event in the logs for options
              const optionCreatedLog = receipt.logs.find((log: any) => {
                // OptionsBook OptionCreated event has 3 topics: event signature, creator, instance
                return log.topics && log.topics.length === 3
              })
              
              if (optionCreatedLog) {
                // The contract address is the second indexed parameter (topics[2])
                contractAddress = ethers.getAddress('0x' + optionCreatedLog.topics[2].slice(26))
                console.log('✅ Extracted option contract address from logs:', contractAddress)
              }
            }
          } catch (error) {
            console.warn('Failed to extract contract address from logs:', error)
          }
          
          // Auto-register the contract in the database
          if (contractAddress && ethers.isAddress(contractAddress)) {
            try {
              console.log('Auto-registering contract in database...')
              
              if (contractType === 'future') {
                // Auto-register futures contract
                await fetch('/api/contracts/auto-register', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    transactionHash: deployTxHash,
                    contractAddress: contractAddress,
                    contractType: 'future',
                    payoffType: payoffType,
                    payoffPower: payoffPower,
                    makerSide: makerSide,
                    shortAddress: account,
                    underlyingToken: formData.underlyingToken,
                    strikeToken: formData.strikeToken,
                    underlyingSymbol: formData.underlyingSymbol,
                    strikeSymbol: formData.strikeSymbol,
                    strikePrice: formData.strikePrice,
                    optionSize: formData.optionSize,
                    premium: '0', // Futures have 0 premium
                    oracle: formData.oracle,
                    expirySeconds: expirySeconds
                  })
                })
                console.log('✅ Futures contract auto-registered successfully')
              } else {
                // Auto-register options contract
                await fetch('/api/contracts/auto-register', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    transactionHash: deployTxHash,
                    contractAddress: contractAddress,
                    optionType: optionType,
                    payoffType: payoffType,
                    shortAddress: account,
                    underlyingToken: formData.underlyingToken,
                    strikeToken: formData.strikeToken,
                    underlyingSymbol: formData.underlyingSymbol,
                    strikeSymbol: formData.strikeSymbol,
                    strikePrice: formData.strikePrice,
                    optionSize: formData.optionSize,
                    premium: formData.premium,
                    oracle: formData.oracle
                  })
                })
                console.log('✅ Option contract auto-registered successfully')
              }
            } catch (error) {
              console.warn('Failed to auto-register contract:', error)
            }
          }
          
          // Fallback: use transaction hash if we can't get the contract address
          if (!contractAddress) {
            contractAddress = `Transaction: ${deployTxHash.substring(0, 10)}...`
          }
          
          toast.success(contractType === 'future' 
            ? `${payoffType} finite future contract deployed at: ${contractAddress}`
            : `${optionType === 'call' ? 'Call' : 'Put'} option contract deployed at: ${contractAddress}`)
          console.log('Deploy transaction hash:', deployTxHash)
          console.log('Contract address:', contractAddress)
          
          // Show success message
          setContractDeploymentInfo({
            txHash: deployTxHash,
            contractAddress: contractAddress
          })
          
          // Reset form
          setFormData({
            underlyingToken: '',
            strikeToken: '',
            underlyingSymbol: '',
            strikeSymbol: '',
            strikePrice: '',
            optionSize: '',
            premium: '',
            oracle: ''
          })
        }
      }
    } catch (error: any) {
      console.error('Error creating option:', error)
      
      // Dismiss any loading toasts
      toast.dismiss()
      
      // Handle specific error types
      let errorMessage = 'Failed to create option contract'
      
      if (error.code === 4001) {
        errorMessage = 'Transaction cancelled by user'
      } else if (error.message && error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient ETH for gas fees'
      } else if (error.message && error.message.includes('missing revert data')) {
        errorMessage = `Transaction failed - likely insufficient tokens. For ${optionType} options, you need ${formData.optionSize} ${optionType === 'call' ? formData.underlyingSymbol : formData.strikeSymbol} tokens in your wallet.`
      } else if (error.message) {
        errorMessage = error.message
      }
      
      toast.error(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-center mb-8">Draft Contract</h1>
          <p className="text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
            Create options with upfront premiums or futures with fixed settlement terms. 
            Choose your contract type and configure the parameters below.
          </p>
          <Card className="max-w-md mx-auto">
            <CardContent className="p-6">
              <div className="text-center">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">Please connect your wallet to create options</p>
              </div>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <h1 className="text-3xl font-bold text-center mb-8 flex items-center justify-center">
          <Plus className="h-8 w-8 mr-2" />
          {contractType === 'future' ? `Create New ${payoffType} Future` : `Create New ${payoffType} ${optionType === 'call' ? 'Call' : 'Put'} Option`}
        </h1>

        <Alert className="mb-8">
          <DollarSign className="h-4 w-4" />
          <AlertDescription>
            <strong>Two-Transaction Process:</strong> First you'll approve token spending, then create the option contract. You'll see 2 separate MetaMask popups.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Option Details</CardTitle>
            <p className="text-sm text-muted-foreground">
              Create a new {optionType === 'call' ? 'call' : 'put'} options contract for trading
            </p>
            {optionType === 'call' ? (
              <div className="text-sm text-muted-foreground mt-2">
                <p>Call Option: Long can buy 2TK at strike price using MTK</p>
                <p className="text-yellow-600 mt-2">
                  ⚠️ You need {formData.optionSize || 'X'} 2TK tokens in your wallet to create this option
                </p>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground mt-2">
                <p>Put Option: Long can sell 2TK at strike price for MTK</p>
                <p className="text-yellow-600 mt-2">
                  ⚠️ You need {formData.optionSize || 'X'} 2TK tokens in your wallet to create this option
                </p>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Contract Type Selector */}
              <div>
                <Label htmlFor="contractType">Contract Type</Label>
                <Select value={contractType} onValueChange={setContractType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="option">Options Contract</SelectItem>
                    <SelectItem value="future">Futures Contract</SelectItem>
                  </SelectContent>
                </Select>
                {contractType === 'future' && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Create a linear finite future with fixed settlement terms at expiry
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {contractType === 'option' && (
                  <div>
                    <Label htmlFor="optionType">Option Type</Label>
                    <Select value={optionType} onValueChange={setOptionType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="call">Call Option</SelectItem>
                        <SelectItem value="put">Put Option</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {contractType === 'future' && (
                  <div>
                    <Label htmlFor="makerSide">Your Position (First to Enter)</Label>
                    <Select value={makerSide} onValueChange={setMakerSide}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="long">Long Position</SelectItem>
                        <SelectItem value="short">Short Position</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground mt-1">
                      Choose which side of the futures contract you want to take.
                    </p>
                  </div>
                )}

                <div>
                  <Label htmlFor="payoffType">Payoff Type</Label>
                  <Select value={payoffType} onValueChange={setPayoffType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Linear">Linear</SelectItem>
                      {contractType === 'option' ? (
                        <>
                          <SelectItem value="Quadratic">Quadratic</SelectItem>
                          <SelectItem value="Logarithmic">Logarithmic</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Power">Power</SelectItem>
                          <SelectItem value="Sigmoid">Sigmoid</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Power input for Power futures */}
              {contractType === 'future' && payoffType === 'Power' && (
                <div>
                  <Label htmlFor="payoffPower">Payoff Power</Label>
                  <Input
                    id="payoffPower"
                    type="number"
                    value={payoffPower}
                    onChange={(e) => setPayoffPower(e.target.value)}
                    placeholder="2"
                    min="1"
                    max="100"
                    required
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Power for the payoff function (1-100). Higher powers create more curved payoffs.
                  </p>
                </div>
              )}

              {/* Intensity input for Sigmoid futures */}
              {contractType === 'future' && payoffType === 'Sigmoid' && (
                <div>
                  <Label htmlFor="sigmoidIntensity">Sigmoid Intensity</Label>
                  <Input
                    id="sigmoidIntensity"
                    type="number"
                    step="0.1"
                    value={sigmoidIntensity}
                    onChange={(e) => setSigmoidIntensity(e.target.value)}
                    placeholder="1.0"
                    min="0.1"
                    max="100"
                    required
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    Intensity for the sigmoid function (0.1-100). Higher intensity creates steeper curves around the strike price.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="underlyingToken">Underlying Token Address</Label>
                  <Input
                    id="underlyingToken"
                    name="underlyingToken"
                    value={formData.underlyingToken}
                    onChange={handleInputChange}
                    placeholder="0x..."
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="strikeToken">Strike Token Address</Label>
                  <Input
                    id="strikeToken"
                    name="strikeToken"
                    value={formData.strikeToken}
                    onChange={handleInputChange}
                    placeholder="0x..."
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="underlyingSymbol">Underlying Symbol</Label>
                  <Input
                    id="underlyingSymbol"
                    name="underlyingSymbol"
                    value={formData.underlyingSymbol}
                    onChange={handleInputChange}
                    placeholder="2TK"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="strikeSymbol">Strike Symbol</Label>
                  <Input
                    id="strikeSymbol"
                    name="strikeSymbol"
                    value={formData.strikeSymbol}
                    onChange={handleInputChange}
                    placeholder="MTK"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="strikePrice">Strike Price (in MTK per 2TK)</Label>
                <Input
                  id="strikePrice"
                  name="strikePrice"
                  type="number"
                  value={formData.strikePrice}
                  onChange={handleInputChange}
                  placeholder="1.5"
                  step="0.01"
                  min="0"
                  required
                />
              </div>

              <div>
                <Label htmlFor="optionSize">Option Size (amount of 2TK tokens)</Label>
                <Input
                  id="optionSize"
                  name="optionSize"
                  type="number"
                  value={formData.optionSize}
                  onChange={handleInputChange}
                  placeholder="100"
                  min="0"
                  required
                />
              </div>

              {contractType === 'option' ? (
                <div>
                  <Label htmlFor="premium">Premium (amount of MTK tokens)</Label>
                  <Input
                    id="premium"
                    name="premium"
                    type="number"
                    value={formData.premium}
                    onChange={handleInputChange}
                    placeholder="50"
                    min="0"
                    required={contractType === 'option'}
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="expirySeconds">Expiry Time (seconds)</Label>
                  <Input
                    id="expirySeconds"
                    type="number"
                    value={expirySeconds}
                    onChange={(e) => setExpirySeconds(e.target.value)}
                    placeholder="300"
                    min="60"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    How long the futures contract will be active after counterparty enters (minimum 60 seconds).
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="oracle">Oracle Address</Label>
                <Input
                  id="oracle"
                  name="oracle"
                  value={formData.oracle}
                  onChange={handleInputChange}
                  placeholder="0x..."
                  required
                />
              </div>

              <Button 
                type="submit" 
                disabled={isCreating}
                className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              >
{isCreating ? 'Processing...' : contractType === 'future' 
                  ? 'Create Future Contract (1 Transaction)' 
                  : `Create ${optionType === 'call' ? 'Call' : 'Put'} Option (2 Transactions)`}
              </Button>
            </form>
          </CardContent>
        </Card>

        {contractDeploymentInfo && (
          <div className="mt-12 relative">
            {/* Animated background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-accent/20 to-primary/20 rounded-3xl blur-xl animate-gradient"></div>
            
            <Card className="relative backdrop-blur-sm border-2 border-primary/30 bg-card/80 shadow-2xl">
              <CardHeader className="pb-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent rounded-full animate-pulse opacity-20"></div>
                    <div className="relative bg-gradient-to-r from-primary to-accent p-4 rounded-full">
                      <CheckCircle className="h-8 w-8 text-primary-foreground" />
                    </div>
                  </div>
                </div>
                
                <CardTitle className="text-center text-2xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                  <Sparkles className="inline h-6 w-6 mr-2 text-primary" />
                  {contractType === 'future' 
                    ? 'Linear Finite Future Contract Created!' 
                    : `${optionType === 'call' ? 'Call' : 'Put'} Option Contract Created!`}
                  <Sparkles className="inline h-6 w-6 ml-2 text-accent" />
                </CardTitle>
                
                <p className="text-center text-muted-foreground mt-2">
                  {contractType === 'future' 
                    ? 'Your futures contract has been deployed successfully and is ready for counterparty entry.'
                    : 'Your option contract has been deployed successfully and is ready for trading.'}
                </p>
              </CardHeader>
              
              <CardContent className="space-y-6">
                {/* Contract Details Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <ExternalLink className="h-5 w-5 text-primary" />
                    Contract Details
                  </h3>
                  
                  {/* Transaction Hash */}
                  <div className="group relative overflow-hidden rounded-xl border border-border bg-gradient-to-r from-muted/50 to-muted p-4 transition-all hover:from-primary/5 hover:to-accent/5 hover:border-primary/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 bg-gradient-to-r from-primary to-accent rounded-full"></div>
                          <label className="text-sm font-medium text-muted-foreground">Transaction Hash</label>
                        </div>
                        <div className="font-mono text-sm text-foreground break-all bg-muted/30 p-2 rounded-lg border border-border/50">
                          {contractDeploymentInfo.txHash}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(contractDeploymentInfo.txHash)}
                        className="wallet-button flex-shrink-0 transition-all hover:border-primary/50"
                      >
                        <Copy className="h-4 w-4 wallet-icon" />
                      </Button>
                    </div>
                  </div>

                  {/* Contract Address */}
                  <div className="group relative overflow-hidden rounded-xl border border-border bg-gradient-to-r from-muted/50 to-muted p-4 transition-all hover:from-accent/5 hover:to-primary/5 hover:border-accent/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 bg-gradient-to-r from-accent to-primary rounded-full"></div>
                          <label className="text-sm font-medium text-muted-foreground">Contract Address</label>
                        </div>
                        <div className="font-mono text-sm text-foreground break-all bg-muted/30 p-2 rounded-lg border border-border/50">
                          {contractDeploymentInfo.contractAddress}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(contractDeploymentInfo.contractAddress)}
                        className="wallet-button flex-shrink-0 transition-all hover:border-accent/50"
                      >
                        <Copy className="h-4 w-4 wallet-icon" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Next Steps Section */}
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl"></div>
                  <div className="relative bg-card/50 backdrop-blur-sm border border-primary/20 rounded-2xl p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                      <div className="w-2 h-2 bg-gradient-to-r from-primary to-accent rounded-full animate-pulse"></div>
                      What's Next?
                    </h3>
                    
                    <div className="space-y-3 text-sm">
                      {contractType === 'future' ? (
                        <>
                          <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/10">
                            <div className="w-6 h-6 bg-gradient-to-r from-primary to-accent rounded-full flex items-center justify-center flex-shrink-0 text-primary-foreground text-xs font-bold">1</div>
                            <div>
                              <div className="font-medium text-foreground">Wait for Counterparty</div>
                              <div className="text-muted-foreground">Someone needs to enter the opposite position to activate the futures contract</div>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-3 p-3 bg-accent/5 rounded-lg border border-accent/10">
                            <div className="w-6 h-6 bg-gradient-to-r from-accent to-primary rounded-full flex items-center justify-center flex-shrink-0 text-accent-foreground text-xs font-bold">2</div>
                            <div>
                              <div className="font-medium text-foreground">Automatic Settlement</div>
                              <div className="text-muted-foreground">Profits/losses are automatically calculated at expiry based on price movement</div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start gap-3 p-3 bg-primary/5 rounded-lg border border-primary/10">
                            <div className="w-6 h-6 bg-gradient-to-r from-primary to-accent rounded-full flex items-center justify-center flex-shrink-0 text-primary-foreground text-xs font-bold">1</div>
                            <div>
                              <div className="font-medium text-foreground">Fund the Contract</div>
                              <div className="text-muted-foreground">As the short position holder, provide the underlying tokens to activate the option</div>
                            </div>
                          </div>
                          
                          <div className="flex items-start gap-3 p-3 bg-accent/5 rounded-lg border border-accent/10">
                            <div className="w-6 h-6 bg-gradient-to-r from-accent to-primary rounded-full flex items-center justify-center flex-shrink-0 text-accent-foreground text-xs font-bold">2</div>
                            <div>
                              <div className="font-medium text-foreground">Share with Buyers</div>
                              <div className="text-muted-foreground">Others can enter as long position holders to activate trading</div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Primary Action Button */}
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-primary via-accent to-primary rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-300 animate-gradient bg-[length:200%_auto]"></div>
                  <Button 
                    onClick={() => router.push(`/option/${contractDeploymentInfo.contractAddress}`)}
                    className="relative w-full view-details-button bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-lg py-6 font-semibold shadow-lg"
                  >
                    <span className="view-details-text">Manage Your Contract</span>
                    <ExternalLink className="h-5 w-5 ml-2 view-details-icon" />
                  </Button>
                </div>
                
                <p className="text-xs text-muted-foreground text-center opacity-70">
                  Your contract is now live and ready for interaction
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {oraclePrices?.prices && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Available Tokens</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">Current tokens in the oracle:</p>
              <ul className="space-y-2">
                {oraclePrices.prices.map((price: any, index: number) => (
                  <li key={index} className="flex justify-between items-center p-3 bg-muted rounded-lg">
                    <span className="font-medium">{price.symbol}:</span>
                    <div className="text-right">
                      <div className="font-mono">{price.realPrice}</div>
                      <div className="text-xs text-muted-foreground">Address: {price.tokenAddress}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  )
}