"use client"

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, DollarSign, TrendingUp, AlertTriangle, Clock, Shield, Zap, BarChart3, Activity, Users, Target } from 'lucide-react'
import OptionPayoffChart from '@/components/OptionPayoffChart'

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

    // Disable automatic refetching intervals
    // if (options?.refetchInterval) {
    //   const interval = setInterval(fetchData, options.refetchInterval)
    //   return () => clearInterval(interval)
    // }
  }, [key, options?.enabled, options?.refetchInterval, fetchFn])

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

export default function OptionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const contractAddress = params?.contractAddress as string
  const { account, sendTransaction } = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [showExerciseInput, setShowExerciseInput] = useState(false)
  const [livePrices, setLivePrices] = useState<any>({})
  const [priceLoading, setPriceLoading] = useState(false)
  const [exerciseAmount, setExerciseAmount] = useState('')

  const formatAddress = (address: string) => {
    if (!address || address === '0x0000000000000000000000000000000000000000') {
      return 'Not filled'
    }
    return address
  }

  // Format large numbers by dividing by 10^18
  const formatTokenAmount = (amount: string, symbol: string) => {
    if (!amount) return `0 ${symbol}`
    
    // Handle wei values (large numbers that might be in scientific notation)
    try {
      const weiAmount = BigInt(amount)
      const etherAmount = Number(weiAmount) / Math.pow(10, 18)
      
      // Format to avoid scientific notation and remove trailing zeros
      const formatted = etherAmount.toFixed(6).replace(/\.?0+$/, '')
      return `${formatted} ${symbol}`
    } catch (error) {
      // If BigInt conversion fails, the value might be in scientific notation
      if (typeof amount === 'string' && amount.includes('e')) {
        const numValue = parseFloat(amount)
        // Convert from wei to ether (divide by 10^18)
        const etherAmount = numValue / Math.pow(10, 18)
        const formatted = etherAmount.toFixed(6).replace(/\.?0+$/, '')
        return `${formatted} ${symbol}`
      }
      
      // Fallback: try parsing as float
      const numValue = parseFloat(amount)
      const formatted = numValue.toFixed(6).replace(/\.?0+$/, '')
      return `${formatted} ${symbol}`
    }
  }

  // Format expiry display
  const formatExpiry = (expiry: number, isActive: boolean, isFunded: boolean) => {
    if (!expiry) return 'Not set'
    
    // If option is not yet engaged (not funded or not active), show activation message
    if (!isFunded || !isActive) {
      return '5 minutes upon activation'
    }
    
    // If option is engaged, show actual expiry date
    return new Date(expiry * 1000).toLocaleString()
  }

  // Calculate exercise metrics with optional live price override
  const calculateExerciseMetrics = (amount: string, useLivePrice = false) => {
    if (!optionData || !amount || parseFloat(amount) <= 0) return null
    
    // Determine which price to use for calculations
    let effectivePriceAtExpiry = optionData.priceAtExpiry || 0
    let priceSource = 'contract'
    
    if (useLivePrice && livePrices.underlying && livePrices.underlying.price1e18) {
      effectivePriceAtExpiry = livePrices.underlying.price1e18
      priceSource = 'live'
    }
    
    // Determine option type (call or put)
    const isCallOption = optionData.optionType === 'CALL'
    const isPutOption = optionData.optionType === 'PUT'
    
    console.log('Calculating exercise metrics with:', {
      amount,
      strikePrice: optionData.strikePrice,
      priceAtExpiry: optionData.priceAtExpiry,
      effectivePriceAtExpiry,
      priceSource,
      optionSize: optionData.optionSize,
      isResolved: optionData.isResolved,
      isExercised: optionData.isExercised,
      livePriceAvailable: !!livePrices.underlying,
      optionType: optionData.optionType,
      isCallOption,
      isPutOption
    })
    
    const amountWei = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, 18)))
    const strikePriceWei = BigInt(optionData.strikePrice)
    const priceAtExpiryWei = BigInt(effectivePriceAtExpiry)
    const optionSizeWei = BigInt(optionData.optionSize)
    
    // Calculate how much 2TK user gets: (mtkAmount * 1e18) / strikePrice
    // This matches the smart contract formula
    const twoTkAmount = (amountWei * BigInt(Math.pow(10, 18))) / strikePriceWei
    
    // Check if amount exceeds limit
    const exceedsLimit = twoTkAmount > optionSizeWei
    
    // Check if option is resolved and has priceAtExpiry (or live price)
    const isResolved = optionData.isResolved && priceAtExpiryWei > 0n
    const hasLivePrice = useLivePrice && livePrices.underlying && priceAtExpiryWei > 0n
    
    // Calculate percentage gain based on option type
    const percentGain = isResolved ? 
      (isPutOption ? 
        Number((strikePriceWei - priceAtExpiryWei) * 100n / strikePriceWei) : // Put: profit when price drops
        Number((priceAtExpiryWei - strikePriceWei) * 100n / strikePriceWei)   // Call: profit when price rises
      ) : 0
    
    // Calculate market value and profit based on option type
    let marketValueWei = 0n
    let netProfit = 0
    let roiPercent = 0
    let profitFromPriceDiff = 0
    
    if (isResolved || hasLivePrice) {
      if (isCallOption) {
        // CALL OPTION: Long profits when priceAtExpiry > strikePrice
        marketValueWei = twoTkAmount * priceAtExpiryWei / BigInt(Math.pow(10, 18))
        
        // Profit from favorable price movement
        if (priceAtExpiryWei > strikePriceWei) {
          profitFromPriceDiff = Number(twoTkAmount * (priceAtExpiryWei - strikePriceWei) / BigInt(Math.pow(10, 18))) / Math.pow(10, 18)
        }
      } else if (isPutOption) {
        // PUT OPTION: Long profits when priceAtExpiry < strikePrice
        const isPutProfitable = priceAtExpiryWei < strikePriceWei
        
        if (isPutProfitable) {
          marketValueWei = twoTkAmount * strikePriceWei / BigInt(Math.pow(10, 18))
          profitFromPriceDiff = Number(twoTkAmount * (strikePriceWei - priceAtExpiryWei) / BigInt(Math.pow(10, 18))) / Math.pow(10, 18)
        } else {
          marketValueWei = 0n
          profitFromPriceDiff = 0
        }
      } else {
        // Fallback to call option logic
        marketValueWei = twoTkAmount * priceAtExpiryWei / BigInt(Math.pow(10, 18))
        if (priceAtExpiryWei > strikePriceWei) {
          profitFromPriceDiff = Number(twoTkAmount * (priceAtExpiryWei - strikePriceWei) / BigInt(Math.pow(10, 18))) / Math.pow(10, 18)
        }
      }
    }
    
    // Calculate total cost (exercise amount + premium already paid)
    const premiumPaidWei = BigInt(optionData.premium || 0)
    const totalCostWei = amountWei + premiumPaidWei
    
    // Convert to readable numbers
    const marketValue = Number(marketValueWei) / Math.pow(10, 18)
    const totalCost = Number(totalCostWei) / Math.pow(10, 18)
    
    // Net profit = Market value of what you receive - Total cost to get it
    netProfit = marketValue - totalCost
    roiPercent = totalCost > 0 ? (netProfit / totalCost) * 100 : 0
    
    // Calculate max spendable based on option type
    let maxSpendableWei
    if (isPutOption) {
      maxSpendableWei = optionSizeWei
    } else {
      maxSpendableWei = optionSizeWei * strikePriceWei / BigInt(Math.pow(10, 18))
    }
    
    return {
      twoTkAmount: Number(twoTkAmount) / Math.pow(10, 18),
      exceedsLimit,
      percentGain,
      profitFromPriceDiff,
      marketValueMTK: marketValue,
      totalCost,
      netProfit,
      roiPercent,
      maxSpendable: Number(maxSpendableWei) / Math.pow(10, 18),
      isResolved: isResolved || hasLivePrice,
      priceAtExpiry: effectivePriceAtExpiry,
      priceSource,
      hasLivePrice,
      livePriceValue: useLivePrice ? parseFloat(livePrices.underlying?.priceFormatted || '0') : null,
      isCallOption,
      isPutOption
    }
  }

  // Fetch option details - blockchain only
  const fetchOptionData = useCallback(async () => {
    try {
      // Get data directly from blockchain
      const response = await fetch(`/api/option/${contractAddress}`)
      if (!response.ok) {
        throw new Error('Failed to fetch option data')
      }
      return await response.json()
    } catch (error) {
      console.error('Error fetching option data from blockchain:', error)
      throw error
    }
  }, [contractAddress])

  const { data: optionData, isLoading: isLoadingOption } = useQuery(
    `option-${contractAddress}`,
    fetchOptionData,
    {
      enabled: !!contractAddress
      // refetchInterval: false // Disable automatic refetching
    }
  )

  // Fetch live prices from oracle
  const fetchLivePrice = async (tokenAddress: string, tokenSymbol: string) => {
    try {
      const response = await fetch(`/api/oracle/price/${tokenAddress}`)
      if (!response.ok) {
        throw new Error('Failed to fetch live price')
      }
      const data = await response.json()
      return {
        ...data,
        symbol: tokenSymbol || data.symbol
      }
    } catch (error) {
      console.warn(`Failed to fetch live price for ${tokenSymbol}:`, error)
      return null
    }
  }

  // Auto-fetch live prices when option data loads
  useEffect(() => {
    const fetchAllLivePrices = async () => {
      if (!optionData || !optionData.underlyingToken) return
      
      setPriceLoading(true)
      try {
        // Fetch prices for both underlying and strike tokens
        const [underlyingPrice, strikePrice] = await Promise.all([
          fetchLivePrice(optionData.underlyingToken, optionData.underlyingSymbol),
          fetchLivePrice(optionData.strikeToken, optionData.strikeSymbol)
        ])

        setLivePrices({
          underlying: underlyingPrice,
          strike: strikePrice,
          lastFetchTime: Date.now()
        })
      } catch (error) {
        console.error('Error fetching live prices:', error)
      } finally {
        setPriceLoading(false)
      }
    }

    if (optionData && showExerciseInput) {
      fetchAllLivePrices()
      // Disable automatic price refresh intervals
      // const priceInterval = setInterval(fetchAllLivePrices, 60000)
      // return () => clearInterval(priceInterval)
    }
  }, [optionData, showExerciseInput])

  // Calculate exercise metrics using optimal amounts (contract prices)
  const exerciseMetrics = optionData ? calculateExerciseMetrics('1', false) : null
  
  // Calculate live price metrics when available (always using optimal amounts)
  const liveExerciseMetrics = livePrices.underlying && optionData ? calculateExerciseMetrics('1', true) : null
  
  // Calculate final P&L for exercised options (using max spendable amount)
  const finalPnL = optionData?.isExercised ? (() => {
    // Calculate max spendable: optionSize * strikePrice / 1e18
    const maxSpendable = (Number(optionData.optionSize) * Number(optionData.strikePrice)) / Math.pow(10, 36)
    return calculateExerciseMetrics(maxSpendable.toFixed(2))
  })() : null

  const handleFund = async () => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/option/${contractAddress}/fund`, {
        method: 'POST'
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare fund transaction')
      }
      
      const data = await response.json()
      
      if (data.success) {
        const tx = await sendTransaction(data.data)
        if (tx) {
          toast.success('Transaction sent! Waiting for confirmation...')
          
          // Wait for confirmation
          await tx.wait()
          
          // Notify backend about funding event
          try {
            await fetch(`/api/contracts/${contractAddress}/funded`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ transactionHash: tx.hash })
            })
            console.log('Funded event recorded in database')
          } catch (error) {
            console.warn('Failed to record funded event:', error)
          }
          
          toast.success('Option funded successfully!')
        }
      }
    } catch (error) {
      console.error('Error funding option:', error)
      toast.error('Failed to fund option')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEnter = async () => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/option/${contractAddress}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account })
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare enter transaction')
      }
      
      const data = await response.json()
      
      if (data.success) {
        const { approveTransaction, enterTransaction } = data.data
        
        // First, send the approve transaction
        toast.success('Sending approve transaction...')
        const approveTx = await sendTransaction(approveTransaction)
        if (!approveTx) {
          toast.error('Approve transaction failed')
          return
        }
        
        // Wait for approve transaction confirmation
        await approveTx.wait()
        toast.success('Approve transaction confirmed!')
        
        // Then, send the enter transaction
        toast.success('Sending enter transaction...')
        const enterTx = await sendTransaction(enterTransaction)
        if (!enterTx) {
          toast.error('Enter transaction failed')
          return
        }
        
        // Wait for enter transaction confirmation
        await enterTx.wait()
        toast.success('Enter transaction confirmed!')
        
        // Calculate expiry (current time + 5 minutes for demo)
        const expiry = Math.floor(Date.now() / 1000) + (5 * 60) // 5 minutes from now
        
        // Record the long entry - triggers resolution timer
        try {
          await fetch(`/api/contracts/${contractAddress}/long-entered`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              longAddress: account,
              expiry: expiry,
              transactionHash: enterTx.hash
            })
          })
          console.log('Long entry recorded - resolution timer started!')
        } catch (error) {
          console.warn('Failed to record long entry:', error)
        }
        
        toast.success('Long position entered! Option expires in 5 minutes and will auto-resolve.')
      }
    } catch (error) {
      console.error('Error entering option:', error)
      toast.error('Failed to enter option')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExercise = async () => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    // Use optimal exercise amounts automatically calculated by the contract
    const mtkAmount = exerciseMetrics?.maxSpendable || optionData?.optionSize || '1'
    
    setIsLoading(true)
    try {
      // For put options, send 2TK amount; for call options, send MTK amount
      const isPutOption = optionData?.optionType === 'PUT'
      const requestBody = isPutOption 
        ? { twoTkAmount: mtkAmount } // For puts, user specifies how much 2TK to sell
        : { mtkAmount: mtkAmount }  // For calls, user specifies how much MTK to spend
      
      console.log('Exercise request:', { 
        optionType: optionData?.optionType, 
        requestBody 
      })
      
      const response = await fetch(`/api/option/${contractAddress}/resolveAndExercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare exercise transaction')
      }
      
      const data = await response.json()
      
      if (data.success) {
        console.log('Transaction data:', data.data)
        const { approveTransaction, resolveAndExerciseTransaction } = data.data
        
        // Step 1: Send approve transaction
        const tokenSymbol = isPutOption ? optionData?.underlyingSymbol : optionData?.strikeSymbol
        toast.success(`Approving ${tokenSymbol} spending... (Transaction 1/2)`)
        const approveTx = await sendTransaction(approveTransaction)
        if (!approveTx) {
          toast.error('Approve transaction failed')
          return
        }
        await approveTx.wait()
        toast.success(`✅ ${tokenSymbol} spending approved!`)
        
        // Step 2: Send resolveAndExercise transaction to OptionsBook
        toast.success('Executing resolve and exercise... (Transaction 2/2)')
        const resolveAndExerciseTx = await sendTransaction(resolveAndExerciseTransaction)
        if (!resolveAndExerciseTx) {
          toast.error('Resolve and exercise transaction failed')
          return
        }
        await resolveAndExerciseTx.wait()
        
        // Clear cache to get fresh data
        await fetch('/api/factory/clear-cache', { method: 'POST' })
        
        toast.success('✅ Option resolved and exercised successfully!')
      }
    } catch (error: any) {
      console.error('Error exercising option:', error)
      
      // Enhanced error logging
      if (error.message && error.message.includes('execution reverted')) {
        console.error('Transaction reverted. Possible reasons:')
        console.error('1. User is not the long position holder')
        console.error('2. Option is not expired yet')
        console.error('3. Option is already exercised')
        console.error('4. Option is not resolved')
        console.error('5. Exercise is not profitable')
        console.error('6. Invalid MTK amount')
      }
      
      toast.error('Failed to exercise option')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReclaim = async () => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/option/${contractAddress}/reclaim`, {
        method: 'POST'
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare reclaim transaction')
      }
      
      const data = await response.json()
      
      if (data.success) {
        console.log('Reclaim transaction data:', data.data)
        
        // Send the transaction to MetaMask
        const tx = await sendTransaction(data.data)
        if (tx) {
          toast.success('Reclaim transaction sent! Waiting for confirmation...')
          
          // Wait for confirmation
          await tx.wait()
          
          // Clear cache to get fresh data
          await fetch('/api/factory/clear-cache', { method: 'POST' })
          
          toast.success('Option resolved and funds reclaimed successfully!')
        }
      }
    } catch (error: any) {
      console.error('Error reclaiming option:', error)
      
      // Enhanced error logging
      if (error.message && error.message.includes('execution reverted')) {
        console.error('Reclaim transaction reverted. Possible reasons:')
        console.error('1. User is not the short position holder')
        console.error('2. Option is not expired yet')
        console.error('3. Option was already exercised')
        console.error('4. Option was already reclaimed')
      }
      
      toast.error('Failed to reclaim option')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatus = () => {
    if (!optionData) return { text: 'Loading...', class: 'funded' }
    if (optionData.isExercised) return { text: 'Exercised', class: 'exercised' }
    
    // Check if option is not engaged (not funded or not active)
    if (!optionData.isFunded || !optionData.isActive) {
      return { text: 'Not Engaged', class: 'not-engaged' }
    }
    
    // Check if expired but not resolved (only if option is engaged)
    if (optionData.expiry && Date.now() > optionData.expiry * 1000 && !optionData.isResolved) {
      return { text: 'Unresolved', class: 'expired' }
    }
    
    // Check if expired and resolved
    if (optionData.expiry && Date.now() > optionData.expiry * 1000 && optionData.isResolved) {
      return { text: 'Expired', class: 'expired' }
    }
    
    if (optionData.isActive) return { text: 'Active', class: 'filled' }
    if (optionData.isFunded) return { text: 'Funded', class: 'funded' }
    return { text: 'Created', class: 'funded' }
  }

  const status = getStatus()

  if (isLoadingOption) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-center mb-8">Loading option details...</h1>
        </main>
        <Footer />
      </div>
    )
  }

  if (!optionData) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <Button
            variant="outline"
            className="mb-6"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Market
          </Button>
          <h1 className="text-3xl font-bold text-center mb-8">Option Not Found</h1>
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">The option contract could not be found or loaded.</p>
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
      <main className="container mx-auto px-4 py-12">
        <Button
          variant="outline"
          className="mb-8"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Market
        </Button>

        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl mb-4">
            {(() => {
              const payoffType = optionData.payoffType || 'Linear'
              const optionType = optionData.optionType === 'CALL' ? 'Call' : optionData.optionType === 'PUT' ? 'Put' : 'Option'
              return (
                <>
                  <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient">
                    {payoffType} {optionType}
                  </span>
                  <br />
                  Contract Details
                </>
              )
            })()}
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Complete overview of this options contract including pricing, positions, and trading opportunities
          </p>
        </div>

        {/* Status and Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          <Card className="text-center neon-outline">
            <CardContent className="pt-6">
              <div className="rounded-full bg-primary/10 p-3 mb-4 mx-auto w-fit">
                <Activity className="h-6 w-6 text-primary" />
              </div>
              <Badge
                variant={status.class === 'filled' ? 'default' : 
                        status.class === 'funded' ? 'secondary' : 
                        status.class === 'expired' ? 'destructive' : 'outline'}
                className="mb-2"
              >
                {status.text}
              </Badge>
              <div className="text-sm text-muted-foreground">Contract Status</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline">
            <CardContent className="pt-6">
              <div className="rounded-full bg-accent/10 p-3 mb-4 mx-auto w-fit">
                <Target className="h-6 w-6 text-accent" />
              </div>
              <div className="text-2xl font-bold mb-2">
                {formatTokenAmount(optionData.strikePrice, optionData.strikeSymbol || 'MTK')}
              </div>
              <div className="text-sm text-muted-foreground">Strike Price</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline">
            <CardContent className="pt-6">
              <div className="rounded-full bg-primary/10 p-3 mb-4 mx-auto w-fit">
                <BarChart3 className="h-6 w-6 text-primary" />
              </div>
              <div className="text-2xl font-bold mb-2">
                {formatTokenAmount(optionData.optionSize, optionData.underlyingSymbol || '2TK')}
              </div>
              <div className="text-sm text-muted-foreground">Option Size</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline">
            <CardContent className="pt-6">
              <div className="rounded-full bg-accent/10 p-3 mb-4 mx-auto w-fit">
                <Clock className="h-6 w-6 text-accent" />
              </div>
              <div className="text-xl font-bold mb-2">
                {formatExpiry(optionData.expiry, optionData.isActive, optionData.isFunded)}
              </div>
              <div className="text-sm text-muted-foreground">Expiry</div>
            </CardContent>
          </Card>
        </div>

        {/* Trading Information */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          <Card className="neon-outline">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Shield className="h-5 w-5 mr-2 text-primary" />
                Contract Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Contract Address</div>
                  <div className="code-font text-sm break-all">{contractAddress}</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Premium</div>
                  <div className="text-sm font-medium">{formatTokenAmount(optionData.premium, optionData.strikeSymbol || 'MTK')}</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Options Book</div>
                  <div className="code-font text-sm break-all">{optionData.optionsBook}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="neon-outline">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Users className="h-5 w-5 mr-2 text-accent" />
                Position Holders
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Short Position</div>
                  <div className="code-font text-sm break-all">{optionData.short || 'Not filled'}</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Long Position</div>
                  <div className="code-font text-sm break-all">{optionData.long || 'Not filled'}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Token Information */}
        <Card className="mb-12 neon-outline">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Zap className="h-5 w-5 mr-2 text-primary" />
              Token Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 rounded-lg border border-primary/20">
                <div className="flex items-center mb-3">
                  <div className="rounded-full bg-primary/20 p-2 mr-3">
                    <BarChart3 className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="font-semibold">Underlying Token</div>
                    <div className="text-sm text-muted-foreground">{optionData.underlyingSymbol || '2TK'}</div>
                  </div>
                </div>
                <div className="code-font text-xs text-muted-foreground break-all">
                  {optionData.underlyingToken}
                </div>
              </div>
              
              <div className="p-6 bg-gradient-to-br from-accent/5 to-accent/10 rounded-lg border border-accent/20">
                <div className="flex items-center mb-3">
                  <div className="rounded-full bg-accent/20 p-2 mr-3">
                    <Target className="h-4 w-4 text-accent" />
                  </div>
                  <div>
                    <div className="font-semibold">Strike Token</div>
                    <div className="text-sm text-muted-foreground">{optionData.strikeSymbol || 'MTK'}</div>
                  </div>
                </div>
                <div className="code-font text-xs text-muted-foreground break-all">
                  {optionData.strikeToken}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Price Information */}
        <Card className="mb-12 neon-outline">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2 text-accent" />
              Price Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-gradient-to-br from-muted/30 to-muted/50 rounded-lg">
                <div className="text-sm text-muted-foreground mb-2">Price of {optionData.underlyingSymbol || '2TK'} at Expiry</div>
                <div className="text-xl font-bold">
                  {(() => {
                    if (optionData.resolutionStatus) {
                      switch (optionData.resolutionStatus) {
                        case 'active':
                          return 'Not yet expired'
                        case 'resolved':
                          return formatTokenAmount(optionData.priceAtExpiry, optionData.strikeSymbol || 'MTK')
                        case 'exercised':
                          return formatTokenAmount(optionData.priceAtExpiry, optionData.strikeSymbol || 'MTK')
                        case 'needs_resolution':
                          return '? MTK (Needs Resolution)'
                        default:
                          return 'Status unknown'
                      }
                    } else {
                      const isExpired = optionData.expiry && Date.now() > optionData.expiry * 1000
                      if (!isExpired) {
                        return 'Not yet expired'
                      } else if (optionData.isResolved) {
                        return formatTokenAmount(optionData.priceAtExpiry, optionData.strikeSymbol || 'MTK')
                      } else {
                        return 'Expired - Needs Resolution'
                      }
                    }
                  })()}
                </div>
              </div>

              {livePrices.underlying && (
                <div className="p-6 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="text-sm text-muted-foreground mb-2">Current Oracle Price</div>
                  <div className="text-xl font-bold mb-2">
                    {formatTokenAmount(livePrices.underlying.price1e18, optionData.strikeSymbol || 'MTK')}
                  </div>
                  <div className="text-xs text-muted-foreground mb-1">Live from Oracle</div>
                  {(() => {
                    const currentPrice = Number(livePrices.underlying.price1e18)
                    const strikePrice = Number(optionData.strikePrice)
                    const isPutOption = optionData.optionType === 'PUT'
                    const isCallOption = optionData.optionType === 'CALL'
                    
                    if (isPutOption) {
                      const isProfitable = currentPrice < strikePrice
                      return (
                        <Badge variant={isProfitable ? 'default' : 'destructive'} className="text-xs">
                          {isProfitable ? '✓ In the Money' : '✗ Out of the Money'}
                        </Badge>
                      )
                    } else if (isCallOption) {
                      const isProfitable = currentPrice > strikePrice
                      return (
                        <Badge variant={isProfitable ? 'default' : 'destructive'} className="text-xs">
                          {isProfitable ? '✓ In the Money' : '✗ Out of the Money'}
                        </Badge>
                      )
                    }
                    return null
                  })()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payoff Graph */}
        <Card className="mb-8 neon-outline">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2 text-accent" />
              Payoff Graph
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OptionPayoffChart
              optionType={optionData.optionType === 'CALL' ? 'CALL' : 'PUT'}
              payoffType={(optionData.payoffType as 'Linear' | 'Quadratic' | 'Logarithmic') || 'Linear'}
              strikePrice={optionData.strikePrice}
              optionSize={optionData.optionSize}
              strikeSymbol={optionData.strikeSymbol || 'MTK'}
              underlyingSymbol={optionData.underlyingSymbol || '2TK'}
              currentSpotPrice={livePrices.underlying?.price1e18}
              decimals={18}
              rangeFraction={1.0}
              isShortPosition={account && optionData.short && account.toLowerCase() === optionData.short.toLowerCase()}
            />
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <Card className="mb-8 neon-outline">
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="h-5 w-5 mr-2 text-primary" />
              Available Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {!optionData.isFunded && (
                <Button
                  onClick={handleFund}
                  disabled={isLoading}
                  size="lg"
                  className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 h-16"
                >
                  <DollarSign className="h-5 w-5 mr-2" />
                  Fund Option
                </Button>
              )}
              
              {!optionData.isActive && optionData.isFunded && (
                <Button
                  onClick={handleEnter}
                  disabled={isLoading}
                  size="lg"
                  className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 h-16"
                >
                  <TrendingUp className="h-5 w-5 mr-2" />
                  Enter as Long
                </Button>
              )}
              
              {(() => {
                const longMatchesAccount = optionData.long && account && optionData.long.toLowerCase() === account.toLowerCase()
                const isExpired = optionData.expiry && Date.now() > optionData.expiry * 1000
                const canExercise = optionData.isActive && isExpired && !optionData.isExercised && longMatchesAccount
                
                return canExercise && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-16 neon-button"
                    onClick={() => setShowExerciseInput(!showExerciseInput)}
                  >
                    <DollarSign className="h-5 w-5 mr-2" />
                    {showExerciseInput ? 'Hide Exercise' : 'Exercise Option'}
                  </Button>
                )
              })()}
              
              {(() => {
                const shortMatchesAccount = optionData.short && account && optionData.short.toLowerCase() === account.toLowerCase()
                const isExpired = optionData.expiry && Date.now() > optionData.expiry * 1000
                const canReclaim = optionData.isActive && isExpired && !optionData.isExercised && !optionData.isResolved && shortMatchesAccount
                
                return canReclaim && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-16 neon-button"
                    onClick={handleReclaim}
                    disabled={isLoading}
                  >
                    <DollarSign className="h-5 w-5 mr-2" />
                    Reclaim Funds
                  </Button>
                )
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Exercise Input Section */}
        {showExerciseInput && (
          <Card className="neon-outline">
            <CardHeader>
              <CardTitle className="flex items-center">
                <DollarSign className="h-5 w-5 mr-2 text-primary" />
                Exercise Option
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert className="border-primary/20 bg-primary/5">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Enter the amount of MTK tokens you want to spend to exercise this option. 
                  This will trigger both resolution and exercise in a single transaction.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-3">
                <Label htmlFor="exerciseAmount" className="text-sm font-semibold">
                  MTK Amount to Exercise
                </Label>
                <Input
                  id="exerciseAmount"
                  type="number"
                  value={exerciseAmount}
                  onChange={(e) => setExerciseAmount(e.target.value)}
                  placeholder="Enter MTK amount"
                  step="0.01"
                  min="0"
                  className="h-12 text-lg"
                />
                <div className="text-xs text-muted-foreground">
                  Available for exercise: Up to {exerciseMetrics?.maxSpendable || 'N/A'} MTK
                </div>
              </div>
              
              <Button
                onClick={handleExercise}
                disabled={isLoading || !exerciseAmount}
                size="lg"
                className="w-full h-12 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              >
                <DollarSign className="h-5 w-5 mr-2" />
                {isLoading ? 'Exercising...' : 'Execute Exercise'}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  )
}