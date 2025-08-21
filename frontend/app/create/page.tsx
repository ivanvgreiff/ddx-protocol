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
import { Plus, DollarSign, AlertTriangle } from 'lucide-react'

// Real wallet context hook
const useWallet = () => {
  const [account, setAccount] = useState<string | null>(null)

  useEffect(() => {
    // Check if already connected
    const checkConnection = async () => {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        try {
          const accounts = await (window as any).ethereum.request({
            method: 'eth_accounts'
          })
          if (accounts.length > 0) {
            setAccount(accounts[0])
          }
        } catch (error) {
          console.error('Failed to check existing connection:', error)
        }
      }
    }
    checkConnection()
  }, [])

  const sendTransaction = async (txData: any) => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const txHash = await (window as any).ethereum.request({
          method: 'eth_sendTransaction',
          params: [txData],
        })
        
        // Return a transaction object with wait method
        return {
          hash: txHash,
          wait: async () => {
            // Proper receipt waiting implementation
            const provider = new (window as any).ethereum
            let receipt = null
            while (!receipt) {
              try {
                receipt = await (window as any).ethereum.request({
                  method: 'eth_getTransactionReceipt',
                  params: [txHash]
                })
                if (!receipt) {
                  await new Promise(resolve => setTimeout(resolve, 1000))
                }
              } catch (error) {
                await new Promise(resolve => setTimeout(resolve, 1000))
              }
            }
            return receipt
          }
        }
      } catch (error) {
        console.error('Transaction failed:', error)
        throw error
      }
    }
    throw new Error('MetaMask not available')
  }

  return { account, sendTransaction }
}

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
  const { account, sendTransaction } = useWallet()
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
  const [optionType, setOptionType] = useState('call')
  const [payoffType, setPayoffType] = useState('Linear')
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
        payoffType: payoffType
      }
      const endpoint = optionType === 'call' ? '/api/option/create-call' : '/api/option/create-put'
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
        const { approveTransaction, createTransaction, tokenToApprove, amountToApprove, optionsBookAddress } = data.data
        
        // Step 2: Check current allowance
        toast.dismiss(loadingToast)
        toast.loading('Checking token allowance...')
        
        // Simplified allowance check for frontend
        console.log('Required allowance check for:', {
          tokenToApprove,
          amountToApprove,
          optionsBookAddress
        })
        
        // Step 3: Send separate approval transaction
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
        
        // Step 4: Send separate option creation transaction
        toast.loading('Please confirm option creation... (Transaction 2/2)')
        
        console.log('Sending option creation transaction:', createTransaction)
        console.log('🔍 DEBUG: Transaction details:')
        console.log('  - To:', createTransaction.to)
        console.log('  - Data length:', createTransaction.data?.length)
        console.log('  - Gas estimation...')
        
        const tx = await sendTransaction(createTransaction)
        
        if (tx) {
          toast.loading('Waiting for option creation confirmation...')
          
          // Wait for confirmation
          const receipt = await tx.wait()
          const deployTxHash = tx.hash
          
          toast.success('Option created successfully!')
          
          // Extract contract address from the transaction logs
          let contractAddress = null
          try {
            console.log('Extracting contract address from transaction receipt...')
            
            // Look for OptionCreated event in the logs
            const optionCreatedLog = receipt.logs?.find((log: any) => {
              return log.topics && log.topics.length === 3
            })
            
            if (optionCreatedLog) {
              // Extract contract address from log
              contractAddress = '0x' + optionCreatedLog.topics[2].slice(26)
              console.log('✅ Extracted contract address from logs:', contractAddress)
            }
          } catch (error) {
            console.warn('Failed to extract contract address from logs:', error)
          }
          
          // Auto-register the contract in the database
          if (contractAddress) {
            try {
              console.log('Auto-registering contract in database...')
              await fetch('/api/contracts/auto-register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  transactionHash: deployTxHash,
                  contractAddress: contractAddress,
                  optionType: optionType,
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
              console.log('✅ Contract auto-registered successfully')
            } catch (error) {
              console.warn('Failed to auto-register contract:', error)
            }
          }
          
          // Fallback: use transaction hash if we can't get the contract address
          if (!contractAddress) {
            contractAddress = `Transaction: ${deployTxHash.substring(0, 10)}...`
          }
          
          toast.success(`${optionType === 'call' ? 'Call' : 'Put'} option contract deployed at: ${contractAddress}`)
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
          <h1 className="text-3xl font-bold text-center mb-8">Create Option</h1>
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
          Create New {payoffType} {optionType === 'call' ? 'Call' : 'Put'} Option
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                <div>
                  <Label htmlFor="payoffType">Payoff Type</Label>
                  <Select value={payoffType} onValueChange={setPayoffType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Linear">Linear</SelectItem>
                      <SelectItem value="Quadratic">Quadratic</SelectItem>
                      <SelectItem value="Logarithmic">Logarithmic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

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
                  required
                />
              </div>

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
                {isCreating ? 'Processing...' : `Create ${optionType === 'call' ? 'Call' : 'Put'} Option (2 Transactions)`}
              </Button>
            </form>
          </CardContent>
        </Card>

        {contractDeploymentInfo && (
          <Card className="mt-8 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
            <CardHeader>
              <CardTitle className="text-green-700 dark:text-green-300">
                ✅ {optionType === 'call' ? 'Call' : 'Put'} Option Contract Created Successfully!
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded border">
                <div>
                  <strong>Transaction Hash:</strong><br />
                  <code className="text-sm">{contractDeploymentInfo.txHash}</code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(contractDeploymentInfo.txHash)}
                >
                  Copy
                </Button>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded border">
                <div>
                  <strong>Contract Address:</strong><br />
                  <code className="text-sm">{contractDeploymentInfo.contractAddress}</code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(contractDeploymentInfo.contractAddress)}
                >
                  Copy
                </Button>
              </div>
              
              <div className="text-sm text-muted-foreground">
                You can now:<br />
                1. Fund the contract (as the short seller)<br />
                2. Have someone enter as long position
              </div>
              
              <Button 
                onClick={() => router.push(`/option/${contractDeploymentInfo.contractAddress}`)}
                className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              >
                View Contract Details
              </Button>
              
              <p className="text-xs text-muted-foreground text-center">
                Click the button above when ready to manage your contract
              </p>
            </CardContent>
          </Card>
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