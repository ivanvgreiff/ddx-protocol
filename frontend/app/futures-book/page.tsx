"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

export default function FuturesBookPage() {
  const router = useRouter()
  const { account, sendTransaction } = useWallet()
  const [filter, setFilter] = useState('all')
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [showEnterDialog, setShowEnterDialog] = useState(false)
  const [selectedContract, setSelectedContract] = useState<any>(null)

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
        
        // Fallback: try parsing as float
        const formatted = numValue.toFixed(6).replace(/\.?0+$/, '')
        return `${formatted} ${symbol}`
      }
    } else {
      // Small numbers are likely already in ether format
      const formatted = numValue.toFixed(6).replace(/\.?0+$/, '')
      return `${formatted} ${symbol}`
    }
  }

  // Format expiry display for futures
  const formatExpiry = (future: any) => {
    if (!future.expiry) return 'Not set'
    
    // If future is not yet engaged (not funded or not active), show activation message
    if (!future.isFunded || !future.isActive) {
      return '5 minutes upon activation'
    }
    
    // If future is engaged, show actual expiry date or countdown
    const expiryTime = future.expiry * 1000 // Convert to milliseconds
    const timeRemaining = expiryTime - currentTime
    
    if (timeRemaining <= 0) {
      const expiryDate = new Date(expiryTime)
      return `${expiryDate.toLocaleDateString()} ${expiryDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
    }
    
    // Calculate countdown for active futures
    const minutes = Math.floor(timeRemaining / (1000 * 60))
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000)
    
    return `${minutes}:${seconds.toString().padStart(2, '0')} remaining`
  }

  // Fetch futures from current FuturesBook factory (on-chain source of truth)
  const { data: futuresData, isLoading, refetch: refetchFutures } = useQuery(
    'futures',
    async () => {
      const response = await fetch('/api/futures/all-contracts')
      if (!response.ok) {
        throw new Error('Failed to fetch futures')
      }
      const data = await response.json()
      return data.contracts || []
    },
    {
      // refetchInterval: 120000, // Disable automatic refetching
    }
  )

  const futures = futuresData || []

  const filteredFutures = futures.filter((future: any) => {
    if (filter === 'all') return true
    if (filter === 'available' && !future.isActive) return true
    if (filter === 'filled' && future.isActive) return true
    if (filter === 'expired' && future.expiry && future.expiry * 1000 < currentTime) return true
    return false
  })

  const getStatus = (future: any) => {
    if (future.isExercised) return { text: 'Exercised', class: 'exercised' }
    
    // Check if future is not engaged (not funded or not active)
    if (!future.isFunded || !future.isActive) {
      return { text: 'Not Engaged', class: 'not-engaged' }
    }
    
    // Check if expired but not resolved (only if future is engaged)
    if (future.expiry && future.expiry * 1000 < currentTime && !future.isResolved) {
      return { text: 'Unresolved', class: 'expired' }
    }
    
    // Check if expired and resolved but not exercised (means it was reclaimed)
    if (future.expiry && future.expiry * 1000 < currentTime && future.isResolved && !future.isExercised) {
      return { text: 'Reclaimed', class: 'reclaimed' }
    }
    
    if (future.isActive) return { text: 'Active', class: 'filled' }
    if (future.isFunded) return { text: 'Funded', class: 'funded' }
    return { text: 'Created', class: 'funded' }
  }

  const handleEnterClick = (contract: any) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }
    
    setSelectedContract(contract)
    setShowEnterDialog(true)
  }

  const handleEnter = async () => {
    if (!selectedContract || !account) {
      toast.error('Please connect your wallet first')
      return
    }

    const contractAddress = selectedContract.address

    // Show initial loading message
    const loadingToast = toast.loading('Preparing enter transaction...')

    try {
      console.log('Attempting to enter future with contract address:', contractAddress)
      
      const response = await fetch(`/api/futures/${contractAddress}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userAddress: account
        })
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare enter transaction')
      }
      
      const data = await response.json()
      console.log('Enter response:', data)
      
      if (data.success && data.data) {
        const { enterTransaction } = data.data
        
        // Send enter transaction (no approval needed for futures)
        toast.dismiss(loadingToast)
        toast.loading('Please confirm entering the future...')
        
        console.log('Sending enter future transaction:', enterTransaction)
        const tx = await sendTransaction(enterTransaction)
        
        if (tx) {
          toast.loading('Waiting for enter confirmation...')
          
          // Wait for confirmation
          await tx.wait()
          
          toast.success('Entered future successfully!')
          
          // Close dialog and reset state
          setShowEnterDialog(false)
          setSelectedContract(null)
          
          // Notify backend about long entry event
          try {
            await fetch(`/api/futures/${contractAddress}/long-entered`, {
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
          
          // Refresh futures data to show updated contract state
          try {
            await refetchFutures()
            console.log('Futures data refreshed after long entry')
          } catch (error) {
            console.warn('Failed to refresh futures data:', error)
          }
        }
      }
    } catch (error: any) {
      console.error('Error entering future:', error)
      
      // Dismiss any loading toasts
      toast.dismiss()
      
      // Handle specific error types
      let errorMessage = 'Failed to enter future'
      
      if (error.code === 4001) {
        errorMessage = 'Transaction rejected by user'
      } else if (error.message) {
        errorMessage = `Failed to enter future: ${error.message}`
      }
      
      toast.error(errorMessage)
    } finally {
      // Close dialog on error
      setShowEnterDialog(false)
      setSelectedContract(null)
      setIsLoading(false)
    }
  }

  const handleReclaim = async (contractAddress: string) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/futures/${contractAddress}/reclaim`, {
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
          await fetch('/api/futures/clear-cache', { method: 'POST' })
          
          toast.success('Future resolved and funds reclaimed successfully!')
          
          // Refresh futures data to show updated contract state
          try {
            await refetchFutures()
            console.log('Futures data refreshed after reclaim')
          } catch (error) {
            console.warn('Failed to refresh futures data:', error)
          }
        }
      }
    } catch (error: any) {
      console.error('Error reclaiming future:', error)
      
      // Enhanced error logging
      if (error.message && error.message.includes('execution reverted')) {
        console.error('Reclaim transaction reverted. Possible reasons:')
        console.error('1. User is not the short position holder')
        console.error('2. Future is not expired yet')
        console.error('3. Future was already exercised')
        console.error('4. Future was already reclaimed')
      }
      
      toast.error('Failed to reclaim future')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResolveAndExercise = async (contractAddress: string, future: any) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    try {
      const response = await fetch(`/api/futures/${contractAddress}/resolveAndExercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: account })
      })
      
      if (!response.ok) {
        throw new Error('Failed to prepare exercise transaction')
      }
      
      const data = await response.json()
      
      if (data.success) {
        console.log('Resolve and exercise transaction data:', data.data)
        
        const { resolveAndExerciseTransaction } = data.data
        
        // Send resolveAndExercise transaction to FuturesBook
        toast.loading('Executing resolve and exercise...')
        const resolveAndExerciseTx = await sendTransaction(resolveAndExerciseTransaction)
        if (resolveAndExerciseTx) {
          await resolveAndExerciseTx.wait()
          toast.success('✅ Future resolved and exercised successfully!')
          
          // Clear cache to get fresh data
          await fetch('/api/futures/clear-cache', { method: 'POST' })
          
          // Refresh futures data to show updated contract state
          try {
            await refetchFutures()
            console.log('Futures data refreshed after exercise')
          } catch (error) {
            console.warn('Failed to refresh futures data:', error)
          }
        } else {
          throw new Error('Resolve and exercise failed')
        }
      }
    } catch (error: any) {
      console.error('Error exercising future:', error)
      
      // Enhanced error logging
      if (error.message && error.message.includes('execution reverted')) {
        console.error('Transaction reverted. Possible reasons:')
        console.error('1. User is not the long position holder')
        console.error('2. Future is not expired yet')
        console.error('3. Future is already exercised')
        console.error('4. Future is not resolved')
      }
      
      toast.error('Failed to exercise future')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-4">Futures Book</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Trade linear finite futures contracts with fixed settlement terms. Enter positions with no upfront premium - profits and losses are settled at expiry based on price movement from entry.
          </p>
        </div>

        {/* Filter Buttons */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-lg border border-border p-1">
            {[
              { key: 'all', label: 'All Futures' },
              { key: 'available', label: 'Available' },
              { key: 'filled', label: 'Active' },
              { key: 'expired', label: 'Expired' }
            ].map(({ key, label }) => (
              <Button
                key={key}
                variant={filter === key ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter(key)}
                className="rounded-md"
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="neon-outline-indigo">
                <CardHeader>
                  <div className="animate-pulse">
                    <div className="h-6 bg-muted rounded mb-2"></div>
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="animate-pulse space-y-3">
                    <div className="h-32 bg-muted rounded"></div>
                    <div className="h-4 bg-muted rounded"></div>
                    <div className="h-4 bg-muted rounded w-2/3"></div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : filteredFutures.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No futures found</h3>
                <p className="text-muted-foreground">No futures match your current filter criteria.</p>
              </CardContent>
            </Card>
          ) : (
            filteredFutures.map((future: any, index: number) => {
              const status = getStatus(future)
              const isExpired = future.expiry && future.expiry * 1000 < currentTime
              
              // Check user roles
              const isLongPosition = future.long && account && future.long.toLowerCase() === account.toLowerCase()
              const isShortPosition = future.short && account && future.short.toLowerCase() === account.toLowerCase()
              
              const canExercise = future.isActive && isExpired && !future.isExercised && !future.isResolved && isLongPosition
              const canReclaim = future.isActive && isExpired && !future.isExercised && !future.isResolved && isShortPosition

              return (
                <Card key={index} className="neon-outline-indigo transition-all duration-300">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {(() => {
                          // Determine contract type and display name
                          const contractType = future.contractType || future.payoffType || future.optionType || 'LinearFiniteFutures'
                          if (contractType.toLowerCase().includes('power')) {
                            return 'Power Futures'
                          }
                          return 'Linear Futures'
                        })()}
                      </CardTitle>
                      <div className="flex gap-2">
                        {(() => {
                          // Check user position for this specific future
                          const isLongPosition = future.long && account && future.long.toLowerCase() === account.toLowerCase()
                          const isShortPosition = future.short && account && future.short.toLowerCase() === account.toLowerCase()
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
                            const isLongPosition = future.long && account && future.long.toLowerCase() === account.toLowerCase()
                            const isShortPosition = future.short && account && future.short.toLowerCase() === account.toLowerCase()
                            
                            if (status.class === 'exercised') {
                              return {
                                backgroundColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#4f46e5',
                                color: '#000000',
                                borderColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#4f46e5'
                              }
                            } else if (status.class === 'reclaimed') {
                              return {
                                backgroundColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#4f46e5',
                                color: '#000000',
                                borderColor: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#4f46e5'
                              }
                            } else if (status.class === 'expired') {
                              // This covers "Unresolved" status - just text color, no background or border
                              return {
                                backgroundColor: 'transparent',
                                color: isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#4f46e5',
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
                        <div className="font-medium">
                          {(() => {
                            // Strike price is now set during funding, not activation
                            if (future.strikePrice && future.strikePrice !== '0') {
                              return formatTokenAmount(future.strikePrice, future.strikeSymbol || 'MTK')
                            }
                            return future.isFunded ? 'Set during funding' : 'Not funded yet'
                          })()}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Contract Size:</span>
                        <div className="font-medium">{formatTokenAmount(future.optionSize, future.underlyingSymbol || '2TK')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Lifestyle:</span>
                        <div className="font-medium">
                          {(() => {
                            // Determine lifestyle based on contract type
                            // For now, LinearFiniteFutures is "Finite", future LinearPerpetualFutures will be "Perpetual"
                            const contractType = future.contractType || future.payoffType || 'LinearFiniteFutures'
                            if (contractType.toLowerCase().includes('perpetual')) {
                              return 'Perpetual'
                            }
                            return 'Finite'
                          })()}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Power:</span>
                        <div className="font-medium">
                          {(() => {
                            const contractType = future.contractType || future.payoffType || future.optionType || 'LinearFiniteFutures'
                            if (contractType.toLowerCase().includes('power')) {
                              return future.payoffPower || 2
                            }
                            return 1
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Show expiry for all futures */}
                    <div className="text-sm">
                      <span className="text-muted-foreground">Expiry:</span>
                      <div className="font-medium">{formatExpiry(future)}</div>
                    </div>

                    <div className="text-sm">
                      <span className="text-muted-foreground">Price of {future.underlyingSymbol || '2TK'} at Expiry:</span>
                      <div className="font-medium">
                        {(() => {
                          const isExpired = future.expiry && future.expiry * 1000 < currentTime
                          if (!isExpired) {
                            return 'Not yet expired'
                          } else if (future.isResolved) {
                            return formatTokenAmount(future.priceAtExpiry, future.strikeSymbol || 'MTK')
                          } else {
                            return '? MTK'
                          }
                        })()} 
                      </div>
                    </div>

                    {/* Future Payoff Chart */}
                    <div className="mt-4 mb-2 flex justify-center">
                      <OptionPayoffChart
                        optionType="CALL"
                        payoffType={(() => {
                          const contractType = future.contractType || future.payoffType || future.optionType || 'LinearFiniteFutures'
                          if (contractType.toLowerCase().includes('power')) {
                            return 'Power'
                          }
                          return 'Linear'
                        })()}
                        payoffPower={future.payoffPower || 2}
                        strikePrice={future.strikePrice || "1000000000000000000"}
                        optionSize={future.optionSize}
                        strikeSymbol={future.strikeSymbol || 'MTK'}
                        underlyingSymbol={future.underlyingSymbol || '2TK'}
                        currentSpotPrice={future.currentPrice}
                        decimals={18}
                        compact={true}
                        className="h-48"
                        isShortPosition={account && future.short && account.toLowerCase() === future.short.toLowerCase()}
                        isNonUserContract={!account || (!future.short || account.toLowerCase() !== future.short.toLowerCase()) && (!future.long || account.toLowerCase() !== future.long.toLowerCase())}
                        isFuturesContract={true}
                      />
                    </div>

                    <div className="flex gap-2 pt-4">
                      {!future.isActive && !isLongPosition && !isShortPosition && (() => {
                        const isNonUserContract = !account || 
                          (!future.short || account.toLowerCase() !== future.short.toLowerCase()) && 
                          (!future.long || account.toLowerCase() !== future.long.toLowerCase())
                        
                        const buttonColor = isNonUserContract ? '#4f46e5' : '#39FF14'
                        
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
                              if (isNonUserContract) {
                                // For non-user contracts, keep the indigo color animation
                                e.currentTarget.style.background = '#4f46e5'
                                e.currentTarget.style.opacity = '0.9'
                                e.currentTarget.style.transform = 'scale(1.05)'
                              } else {
                                // For user contracts, apply gradient animation with fade-in
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
                              }
                            }}
                            onMouseLeave={(e) => {
                              // Reset to original color with smooth transition
                              const element = e.currentTarget
                              if (element && element.style) {
                                element.style.animation = 'none'
                                element.style.transition = 'all 0.3s ease-in-out'
                                element.style.background = buttonColor
                                element.style.backgroundSize = 'auto'
                                element.style.opacity = '1'
                                element.style.transform = 'scale(1)'
                              }
                            }}
                            onClick={() => handleEnterClick(future)}
                          >
                            <TrendingUp className="h-4 w-4 mr-1" />
                            <span>Enter Position</span>
                          </Button>
                        )
                      })()}
                      
                      {canExercise && (() => {
                        const buttonIsLong = future.long && account && future.long.toLowerCase() === account.toLowerCase()
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
                            onClick={() => handleResolveAndExercise(future.address, future)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            <span>Exercise</span>
                          </Button>
                        )
                      })()}
                      
                      {canReclaim && (() => {
                        const isLongPosition = future.long && account && future.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = future.short && account && future.short.toLowerCase() === account.toLowerCase()
                        
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
                            onClick={() => handleReclaim(future.address)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            <span>Reclaim Funds</span>
                          </Button>
                        )
                      })()}
                      
                      {(() => {
                        const isLongPosition = future.long && account && future.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = future.short && account && future.short.toLowerCase() === account.toLowerCase()
                        const isNonUserContract = !isLongPosition && !isShortPosition
                        
                        const buttonColor = isShortPosition ? '#FFAD00' : isLongPosition ? '#39FF14' : '#4f46e5'
                        
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
                            onClick={() => router.push(`/future/${future.address}`)}
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
            })
          )}
        </div>
      </main>
      <Footer />
      
      {/* Enter Futures Dialog */}
      {showEnterDialog && selectedContract && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Enter Futures Contract</CardTitle>
              <p className="text-sm text-muted-foreground">
                Enter this futures position as counterparty
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-sm text-muted-foreground">Contract Details:</span>
                <div className="font-medium space-y-1">
                  <div>Type: {selectedContract.payoffType || 'Linear Finite Future'}</div>
                  <div>Size: {formatTokenAmount(selectedContract.optionSize, selectedContract.underlyingSymbol || '2TK')}</div>
                  <div>Strike: {selectedContract.strikePrice ? formatTokenAmount(selectedContract.strikePrice, selectedContract.strikeSymbol || 'MTK') : 'Set on activation'}</div>
                  <div>No Premium Required</div>
                </div>
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowEnterDialog(false)
                    setSelectedContract(null)
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEnter}
                  className="flex-1 bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
                >
                  Enter Future
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}