"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, DollarSign, Eye, AlertTriangle } from 'lucide-react'
import OptionPayoffChart from "@/components/OptionPayoffChart"

import { useWallet } from "@/components/wallet-context"

// Real data fetching hook
const useQuery = (key: string, fetchFn: () => Promise<any>, options?: any) => {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<any>(null)

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

  useEffect(() => {
    if (options?.enabled === false) return

    fetchData()

    // Set up interval if specified
    if (options?.refetchInterval) {
      const interval = setInterval(fetchData, options.refetchInterval)
      return () => clearInterval(interval)
    }
  }, [key, options?.refetchInterval, options?.enabled])

  return { data, isLoading, error, refetch: fetchData }
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

export default function OptionsMarketPage() {
  const router = useRouter()
  const { account, sendTransaction } = useWallet()
  const [filter, setFilter] = useState('all')
  const [currentTime, setCurrentTime] = useState(Date.now())

  // Update current time every second for real-time countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Format token amounts - handles both wei values and simple numbers from database
  const formatTokenAmount = (amount: string, symbol: string) => {
    if (!amount) return `0 ${symbol}`
    
    const numValue = parseFloat(amount)
    
    // If the number is very large (> 1000), assume it's in wei format
    if (numValue >= 1000) {
      try {
        const weiAmount = BigInt(amount)
        const etherAmount = Number(weiAmount) / Math.pow(10, 18)
        const formatted = etherAmount.toFixed(6).replace(/\.?0+$/, '')
        return `${formatted} ${symbol}`
      } catch (error) {
        // If BigInt conversion fails, try parsing as scientific notation
        if (typeof amount === 'string' && amount.includes('e')) {
          const etherAmount = numValue / Math.pow(10, 18)
          const formatted = etherAmount.toFixed(6).replace(/\.?0+$/, '')
          return `${formatted} ${symbol}`
        }
      }
    }
    
    // For small numbers (database values), use as-is
    const formatted = numValue.toFixed(6).replace(/\.?0+$/, '')
    return `${formatted} ${symbol}`
  }

  // Format expiry display with real-time countdown
  const formatExpiry = (option: any) => {
    if (!option.expiry) return 'Not set'
    
    // If option is not yet engaged (not funded or not active), show activation message
    if (!option.isFunded || !option.isActive) {
      return '5 minutes upon activation'
    }
    
    // If option is engaged, show countdown or expiry date
    const expiryTime = option.expiry * 1000 // Convert to milliseconds
    const timeRemaining = expiryTime - currentTime
    
    // If expired or exercised, show actual expiry date
    if (timeRemaining <= 0 || option.isExercised) {
      const expiryDate = new Date(expiryTime)
      return `${expiryDate.toLocaleDateString()} ${expiryDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
    }
    
    // Calculate countdown for active options
    const minutes = Math.floor(timeRemaining / (1000 * 60))
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000)
    
    return `${minutes}:${seconds.toString().padStart(2, '0')} remaining`
  }

  // Fetch options from current OptionsBook factory (on-chain source of truth)
  const { data: optionsData, isLoading, refetch: refetchOptions } = useQuery(
    'options',
    async () => {
      const response = await fetch('/api/factory/all-contracts')
      if (!response.ok) {
        throw new Error('Failed to fetch options')
      }
      const data = await response.json()
      return data.contracts || []
    },
    {
      // refetchInterval: 120000, // Disable automatic refetching
    }
  )

  const options = optionsData || []

  const filteredOptions = options.filter((option: any) => {
    if (filter === 'all') return true
    if (filter === 'available' && !option.isActive) return true
    if (filter === 'filled' && option.isActive) return true
    if (filter === 'expired' && option.expiry && option.expiry * 1000 < currentTime) return true
    return false
  })

  const getStatus = (option: any) => {
    if (option.isExercised) return { text: 'Exercised', class: 'exercised' }
    
    // Check if option is not engaged (not funded or not active)
    if (!option.isFunded || !option.isActive) {
      return { text: 'Not Engaged', class: 'not-engaged' }
    }
    
    // Check if expired but not resolved (only if option is engaged)
    if (option.expiry && option.expiry * 1000 < currentTime && !option.isResolved) {
      return { text: 'Unresolved', class: 'expired' }
    }
    
    // Check if expired and resolved but not exercised (means it was reclaimed)
    if (option.expiry && option.expiry * 1000 < currentTime && option.isResolved && !option.isExercised) {
      return { text: 'Reclaimed', class: 'reclaimed' }
    }
    
    if (option.isActive) return { text: 'Active', class: 'filled' }
    if (option.isFunded) return { text: 'Funded', class: 'funded' }
    return { text: 'Created', class: 'funded' }
  }

  const handleEnter = async (contractAddress: string) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    // Show initial loading message
    const loadingToast = toast.loading('Preparing enter as long transactions...')

    try {
      console.log('Attempting to enter option with contract address:', contractAddress)
      const response = await fetch(`/api/option/${contractAddress}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account })
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare enter transaction')
      }
      
      const data = await response.json()
      console.log('Enter response:', data)
      
      if (data.success && data.data) {
        const { approveTransaction, enterTransaction, premiumToken, premiumAmount, optionsBookAddress } = data.data
        
        // Step 1: Check current allowance
        toast.dismiss(loadingToast)
        toast.loading('Checking premium token allowance...')
        
        console.log('Required allowance info:', {
          premiumToken,
          premiumAmount,
          optionsBookAddress
        })
        
        // Step 2: Send separate approval transaction if needed
        toast.dismiss()
        toast.loading('Please approve premium token spending... (Transaction 1/2)')
        
        console.log('Sending approval transaction:', approveTransaction)
        const approveTx = await sendTransaction(approveTransaction)
        
        if (approveTx) {
          toast.loading('Waiting for approval confirmation... (Transaction 1/2)')
          await approveTx.wait()
          toast.success('✅ Premium token approval confirmed!')
        } else {
          throw new Error('Premium approval transaction failed')
        }
        
        // Step 3: Send separate enter as long transaction
        toast.loading('Please confirm entering as long... (Transaction 2/2)')
        
        console.log('Sending enter as long transaction:', enterTransaction)
        const tx = await sendTransaction(enterTransaction)
        
        if (tx) {
          toast.loading('Waiting for enter as long confirmation...')
          
          // Wait for confirmation
          await tx.wait()
          
          toast.success('Entered as long successfully!')
          
          // Notify backend about long entry event
          try {
            await fetch(`/api/contracts/${contractAddress}/long-entered`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                longAddress: account,
                expiry: Math.floor(Date.now() / 1000) + (5 * 60), // 5 minutes from now
                transactionHash: tx.hash
              })
            })
            console.log('Long entry recorded in database')
          } catch (error) {
            console.warn('Failed to record long entry:', error)
          }
          
          // Refresh options data to show updated contract state
          try {
            await refetchOptions()
            console.log('Options data refreshed after long entry')
          } catch (error) {
            console.warn('Failed to refresh options data:', error)
          }
        }
      }
    } catch (error: any) {
      console.error('Error entering option:', error)
      
      // Dismiss any loading toasts
      toast.dismiss()
      
      // Handle specific error types
      let errorMessage = 'Failed to enter option'
      
      if (error.code === 4001) {
        errorMessage = 'Transaction cancelled by user'
      } else if (error.message && error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient ETH for gas fees'
      } else if (error.message) {
        errorMessage = error.message
      }
      
      toast.error(`Failed to enter option: ${errorMessage}`)
    }
  }

  const handleReclaim = async (contractAddress: string) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    try {
      const response = await fetch(`/api/option/${contractAddress}/reclaim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
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
          
          // Refresh options data to show updated contract state
          try {
            await refetchOptions()
            console.log('Options data refreshed after reclaim')
          } catch (error) {
            console.warn('Failed to refresh options data:', error)
          }
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
    }
  }

  const handleResolveAndExercise = async (contractAddress: string, option: any) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    try {
      // Calculate the maximum MTK amount that can be exercised
      // Based on the formula: twoTkAmount = (mtkAmount * 1e18) / strikePrice
      // And the constraint: twoTkAmount <= optionSize
      // So: mtkAmount <= (optionSize * strikePrice) / 1e18
      const maxMtkAmount = (option.optionSize * option.strikePrice) / 1e18
      
      console.log('Calculated max MTK amount for exercise:', maxMtkAmount)
      
      const response = await fetch(`/api/option/${contractAddress}/resolveAndExercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mtkAmount: maxMtkAmount.toString() })
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare exercise transaction')
      }
      
      const data = await response.json()
      
      if (data.success) {
        console.log('Resolve and exercise transaction data:', data.data)
        
        const { approveTransaction, resolveAndExerciseTransaction } = data.data
        
        // Step 1: Approve MTK spending
        toast.loading('Approving MTK spending... (Step 1/2)')
        const approveTx = await sendTransaction(approveTransaction)
        if (approveTx) {
          await approveTx.wait()
          toast.success('✅ MTK approval confirmed!')
        } else {
          throw new Error('MTK approval failed')
        }
        
        // Step 2: Resolve and exercise via OptionsBook
        toast.loading('Executing resolve and exercise... (Step 2/2)')
        const resolveAndExerciseTx = await sendTransaction(resolveAndExerciseTransaction)
        if (resolveAndExerciseTx) {
          await resolveAndExerciseTx.wait()
          toast.success('✅ Option resolved and exercised successfully!')
          
          // Clear cache to get fresh data
          await fetch('/api/factory/clear-cache', { method: 'POST' })
          
          // Refresh options data to show updated contract state
          try {
            await refetchOptions()
            console.log('Options data refreshed after exercise')
          } catch (error) {
            console.warn('Failed to refresh options data:', error)
          }
        } else {
          throw new Error('Resolve and exercise failed')
        }
      }
    } catch (error: any) {
      console.error('Error resolving and exercising option:', error)
      
      // Enhanced error logging
      if (error.message && error.message.includes('execution reverted')) {
        console.error('Resolve and exercise transaction reverted. Possible reasons:')
        console.error('1. User is not the long position holder')
        console.error('2. Option is not expired yet')
        console.error('3. Option was already exercised')
        console.error('4. Option was already resolved')
        console.error('5. Price at expiry is not profitable')
      }
      
      toast.error('Failed to resolve and exercise option')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-center mb-8">Options Book</h1>

        {/* Filter Section */}
        <div className="flex flex-wrap gap-2 mb-8">
          <span className="text-sm font-medium">Filter:</span>
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All Options
          </Button>
          <Button
            variant={filter === 'available' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('available')}
          >
            Available
          </Button>
          <Button
            variant={filter === 'filled' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('filled')}
          >
            Active
          </Button>
          <Button
            variant={filter === 'expired' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('expired')}
          >
            Expired
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-12 text-center">
              <h3 className="text-lg font-semibold mb-2">Loading options...</h3>
              <p className="text-muted-foreground">Fetching available options from the blockchain.</p>
            </CardContent>
          </Card>
        ) : filteredOptions.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No options found</h3>
              <p className="text-muted-foreground">No options match your current filter criteria.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredOptions.map((option: any, index: number) => {
              const status = getStatus(option)
              const isExpired = option.expiry && option.expiry * 1000 < currentTime
              
              // Check user roles
              const isLongPosition = option.long && account && option.long.toLowerCase() === account.toLowerCase()
              const isShortPosition = option.short && account && option.short.toLowerCase() === account.toLowerCase()
              
              const canExercise = option.isActive && isExpired && !option.isExercised && !option.isResolved && isLongPosition
              const canReclaim = option.isActive && isExpired && !option.isExercised && !option.isResolved && isShortPosition

              // Debug logging for exercise button logic
              if (isExpired && !option.isExercised) {
                console.log(`Debug for option ${option.address}:`, {
                  isActive: option.isActive,
                  isExpired: isExpired,
                  isExercised: option.isExercised,
                  long: option.long,
                  account: account,
                  isLongPosition: isLongPosition,
                  canExercise: canExercise,
                  canReclaim: canReclaim
                })
              }

              return (
                <Card key={index} className="neon-outline transition-all duration-300">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {(() => {
                          const payoffType = option.payoffType || 'Linear'
                          const optionType = option.type === 'call' ? 'Call' : option.type === 'put' ? 'Put' : 'Option'
                          return `${payoffType} ${optionType}`
                        })()}
                      </CardTitle>
                      <div className="flex gap-2">
                        {(() => {
                          // Check user position for this specific option
                          const isLongPosition = option.long && account && option.long.toLowerCase() === account.toLowerCase()
                          const isShortPosition = option.short && account && option.short.toLowerCase() === account.toLowerCase()
                          const hasPosition = isLongPosition || isShortPosition
                          
                          return hasPosition && (
                            <Badge
                              variant="outline"
                              style={{
                                backgroundColor: isShortPosition ? '#FFAD00' : '#39FF14',
                                color: '#000000',
                                borderColor: isShortPosition ? '#FFAD00' : '#39FF14'
                              }}
                            >
                              {isShortPosition ? 'Short' : 'Long'}
                            </Badge>
                          )
                        })()}
                        <Badge
                          variant={status.class === 'filled' ? 'default' : 
                                  status.class === 'funded' ? 'secondary' : 
                                  status.class === 'expired' ? 'ghost' : 
                                  status.class === 'exercised' ? 'outline' :
                                  status.class === 'reclaimed' ? 'outline' : 'outline'}
                          style={(() => {
                            const isLongPosition = option.long && account && option.long.toLowerCase() === account.toLowerCase()
                            const isShortPosition = option.short && account && option.short.toLowerCase() === account.toLowerCase()
                            
                            if (status.class === 'exercised') {
                              return {
                                backgroundColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493',
                                color: '#000000',
                                borderColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493'
                              }
                            } else if (status.class === 'reclaimed') {
                              return {
                                backgroundColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493',
                                color: '#000000',
                                borderColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493'
                              }
                            } else if (status.class === 'expired') {
                              // This covers "Unresolved" status - just text color, no background or border
                              return {
                                backgroundColor: 'transparent',
                                color: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493',
                                border: 'none'
                              }
                            }
                            return undefined
                          })()}
                        >
                          {status.text}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Strike Price:</span>
                        <div className="font-medium">{formatTokenAmount(option.strikePrice, option.strikeSymbol || 'MTK')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Option Size:</span>
                        <div className="font-medium">{formatTokenAmount(option.optionSize, option.underlyingSymbol || '2TK')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Premium:</span>
                        <div className="font-medium">{formatTokenAmount(option.premium, option.strikeSymbol || 'MTK')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Expiry:</span>
                        <div className="font-medium">{formatExpiry(option)}</div>
                      </div>
                    </div>

                    <div className="text-sm">
                      <span className="text-muted-foreground">Price of {option.underlyingSymbol || '2TK'} at Expiry:</span>
                      <div className="font-medium">
                        {(() => {
                          // Use resolutionStatus if available, otherwise fall back to current logic
                          if (option.resolutionStatus) {
                            switch (option.resolutionStatus) {
                              case 'active':
                                return 'Not yet expired'
                              case 'resolved':
                                return formatTokenAmount(option.priceAtExpiry, option.strikeSymbol || 'MTK')
                              case 'exercised':
                                return formatTokenAmount(option.priceAtExpiry, option.strikeSymbol || 'MTK')
                              case 'needs_resolution':
                                return '? MTK'
                              default:
                                return '? MTK'
                            }
                          } else {
                            // Fallback logic for older response format
                            const isExpired = option.expiry && option.expiry * 1000 < currentTime
                            if (!isExpired) {
                              return 'Not yet expired'
                            } else if (option.isResolved) {
                              return formatTokenAmount(option.priceAtExpiry, option.strikeSymbol || 'MTK')
                            } else {
                              return '? MTK'
                            }
                          }
                        })()}
                      </div>
                    </div>

                    {/* Option Payoff Chart */}
                    <div className="mt-4 mb-2 flex justify-center">
                      <OptionPayoffChart
                        optionType={option.type === 'call' ? 'CALL' : 'PUT'}
                        payoffType={(option.payoffType as 'Linear' | 'Quadratic' | 'Logarithmic') || 'Linear'}
                        strikePrice={option.strikePrice}
                        optionSize={option.optionSize}
                        strikeSymbol={option.strikeSymbol || 'MTK'}
                        underlyingSymbol={option.underlyingSymbol || '2TK'}
                        currentSpotPrice={option.currentPrice}
                        decimals={18}
                        compact={true}
                        className="h-48"
                        isShortPosition={account && option.short && account.toLowerCase() === option.short.toLowerCase()}
                        isNonUserContract={!account || (!option.short || account.toLowerCase() !== option.short.toLowerCase()) && (!option.long || account.toLowerCase() !== option.long.toLowerCase())}
                      />
                    </div>

                    <div className="flex gap-2 pt-4">
                      {!option.isActive && !isShortPosition && (() => {
                        const isLongPosition = option.long && account && option.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = option.short && account && option.short.toLowerCase() === account.toLowerCase()
                        const isNonUserContract = !isLongPosition && !isShortPosition
                        
                        const buttonColor = isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493'
                        
                        return (
                          <Button
                            size="sm"
                            className="flex-1 group transition-all duration-300"
                            style={{
                              backgroundColor: buttonColor,
                              color: '#000000',
                              border: `1px solid ${buttonColor}`,
                              transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                              // Create animated background gradient with fade-in
                              const element = e.currentTarget
                              element.style.transition = 'background 0.5s ease-in-out, background-size 0.5s ease-in-out'
                              setTimeout(() => {
                                if (element && element.style) {
                                  element.style.background = `linear-gradient(45deg, var(--primary), var(--accent), var(--primary))`
                                  element.style.backgroundSize = '250% 250%'
                                  setTimeout(() => {
                                    if (element && element.style) {
                                      element.style.animation = 'gradient-shift-strong 3.1s ease-in-out infinite'
                                    }
                                  }, 200)
                                }
                              }, 100)
                            }}
                            onMouseLeave={(e) => {
                              // Reset to original color with smooth transition
                              const element = e.currentTarget
                              if (element && element.style) {
                                element.style.animation = 'none'
                                element.style.transition = 'all 0.3s ease-in-out'
                                element.style.background = buttonColor
                                element.style.backgroundSize = 'auto'
                              }
                            }}
                            onClick={() => handleEnter(option.address)}
                          >
                            <TrendingUp className="h-4 w-4 mr-1" />
                            <span>Enter as Long</span>
                          </Button>
                        )
                      })()}
                      
                      {canExercise && (() => {
                        const buttonIsLong = option.long && account && option.long.toLowerCase() === account.toLowerCase()
                        const buttonColor = buttonIsLong ? '#39FF14' : '#FFAD00'
                        
                        return (
                          <Button
                            size="sm"
                            className="flex-1 group transition-all duration-300"
                            style={{
                              backgroundColor: buttonColor,
                              color: '#000000',
                              border: `1px solid ${buttonColor}`,
                              transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                              // Create animated background gradient with fade-in
                              const element = e.currentTarget
                              element.style.transition = 'background 0.5s ease-in-out, background-size 0.5s ease-in-out'
                              setTimeout(() => {
                                if (element && element.style) {
                                  element.style.background = `linear-gradient(45deg, var(--primary), var(--accent), var(--primary))`
                                  element.style.backgroundSize = '250% 250%'
                                  setTimeout(() => {
                                    if (element && element.style) {
                                      element.style.animation = 'gradient-shift-strong 3.1s ease-in-out infinite'
                                    }
                                  }, 200)
                                }
                              }, 100)
                            }}
                            onMouseLeave={(e) => {
                              // Reset to original color with smooth transition
                              const element = e.currentTarget
                              if (element && element.style) {
                                element.style.animation = 'none'
                                element.style.transition = 'all 0.3s ease-in-out'
                                element.style.background = buttonColor
                                element.style.backgroundSize = 'auto'
                              }
                            }}
                            onClick={() => handleResolveAndExercise(option.address, option)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            <span>Exercise</span>
                          </Button>
                        )
                      })()}
                      
                      {canReclaim && (() => {
                        const isLongPosition = option.long && account && option.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = option.short && account && option.short.toLowerCase() === account.toLowerCase()
                        
                        return (
                          <Button
                            size="sm"
                            className="flex-1 group transition-all duration-300"
                            style={{
                              backgroundColor: isShortPosition ? '#FFAD00' : '#39FF14',
                              color: '#000000',
                              border: `1px solid ${isShortPosition ? '#FFAD00' : '#39FF14'}`,
                              transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                              // Create animated background gradient with fade-in
                              const element = e.currentTarget
                              element.style.transition = 'background 0.5s ease-in-out, background-size 0.5s ease-in-out'
                              setTimeout(() => {
                                if (element && element.style) {
                                  element.style.background = `linear-gradient(45deg, var(--primary), var(--accent), var(--primary))`
                                  element.style.backgroundSize = '250% 250%'
                                  setTimeout(() => {
                                    if (element && element.style) {
                                      element.style.animation = 'gradient-shift-strong 3.1s ease-in-out infinite'
                                    }
                                  }, 200)
                                }
                              }, 100)
                            }}
                            onMouseLeave={(e) => {
                              // Reset to original color with smooth transition
                              const element = e.currentTarget
                              if (element && element.style) {
                                element.style.animation = 'none'
                                element.style.transition = 'all 0.3s ease-in-out'
                                element.style.background = isShortPosition ? '#FFAD00' : '#39FF14'
                                element.style.backgroundSize = 'auto'
                              }
                            }}
                            onClick={() => handleReclaim(option.address)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            <span>Reclaim Funds</span>
                          </Button>
                        )
                      })()}
                      
                      {(() => {
                        const isLongPosition = option.long && account && option.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = option.short && account && option.short.toLowerCase() === account.toLowerCase()
                        const isNonUserContract = !isLongPosition && !isShortPosition
                        
                        const buttonColor = isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#ff1493'
                        
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="view-details-button transition-all duration-300 hover:bg-transparent"
                            style={{
                              color: buttonColor,
                              border: 'none',
                              background: 'none'
                            }}
                            onClick={() => router.push(`/option/${option.address}`)}
                          >
                            <Eye className="h-4 w-4 mr-1 view-details-icon" />
                            <span className="view-details-text">View Details</span>
                          </Button>
                        )
                      })()}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}