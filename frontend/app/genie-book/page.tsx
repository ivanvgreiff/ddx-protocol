"use client"

import { useState, useEffect, useCallback } from 'react'
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
import { COLORS } from "@/lib/colors"

// Helper function to convert wei to ether
function fromUnits(value: string | undefined, decimals = 18): number | undefined {
  if (value == null) return undefined;
  try {
    const bi = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = Number(bi / base);
    const frac = Number(bi % base) / Number(base);
    return whole + frac;
  } catch (error) {
    return Number(value);
  }
}

// Real data fetching hook - FIXED to prevent infinite loops
const useQuery = (key: string, fetchFn: () => Promise<any>, options?: any) => {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<any>(null)

  const fetchData = useCallback(async () => {
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
  }, [fetchFn, key])

  const [hasFetched, setHasFetched] = useState(false)

  useEffect(() => {
    if (options?.enabled === false || hasFetched) return

    fetchData()
    setHasFetched(true) // Prevent multiple calls
  }, [fetchData, options?.enabled, hasFetched])

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

export default function GenieBookPage() {
  const router = useRouter()
  const { account, sendTransaction } = useWallet()
  const [filter, setFilter] = useState('all')
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [showEnterDialog, setShowEnterDialog] = useState(false)
  const [selectedContract, setSelectedContract] = useState<any>(null)

  // Color constants (imported from central colors file)
  const LONG_COLOR = COLORS.LONG
  const SHORT_COLOR = COLORS.SHORT
  const NEUTRAL_COLOR = COLORS.NEUTRAL_GENIES
  const TEXT_ON_COLOR = COLORS.TEXT_ON_COLOR

  // No automatic time updates - only manual refresh by user

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

  // Format expiry display for genies
  const formatExpiry = (genie: any) => {
    if (!genie.expiry) return 'Not set'
    
    // If genie is not yet engaged (not funded or not active), show activation message
    if (!genie.isFunded || !genie.isActive) {
      return '5 minutes upon activation'
    }
    
    // If genie is engaged, show countdown or expiry date
    const expiryTime = genie.expiry * 1000 // Convert to milliseconds
    const timeRemaining = expiryTime - currentTime
    
    // If expired or exercised, show actual expiry date
    if (timeRemaining <= 0 || genie.isExercised) {
      const expiryDate = new Date(expiryTime)
      return `${expiryDate.toLocaleDateString()} ${expiryDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
    }
    
    // Calculate countdown for active genies
    const minutes = Math.floor(timeRemaining / (1000 * 60))
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000)
    
    return `${minutes}:${seconds.toString().padStart(2, '0')} remaining`
  }

  // Stable fetch function to prevent infinite loops
  const fetchGenies = useCallback(async () => {
    const response = await fetch('/api/genie/all-contracts')
    if (!response.ok) {
      throw new Error('Failed to fetch genies')
    }
    const data = await response.json()
    return data.contracts || []
  }, [])

  // Fetch futures from current FuturesBook factory (on-chain source of truth)
  const { data: geniesData, isLoading, refetch: refetchGenies } = useQuery(
    'genies',
    fetchGenies,
    {
      // No automatic refetching
    }
  )

  const genies = geniesData || []

  const filteredGenies = genies.filter((genie: any) => {
    if (filter === 'all') return true
    if (filter === 'available' && !genie.isActive) return true
    if (filter === 'filled' && genie.isActive) return true
    if (filter === 'expired' && genie.expiry && genie.expiry * 1000 < currentTime) return true
    return false
  })

  const getStatus = (genie: any) => {
    if (genie.isExercised) return { text: 'Exercised', class: 'exercised' }
    
    // Check if genie is not engaged (not funded or not active)
    if (!genie.isFunded || !genie.isActive) {
      return { text: 'Not Engaged', class: 'not-engaged' }
    }
    
    // Check if expired but not resolved (only if genie is engaged)
    if (genie.expiry && genie.expiry * 1000 < currentTime && !genie.isResolved) {
      return { text: 'Unresolved', class: 'expired' }
    }
    
    // Check if expired and resolved but not exercised (means it was reclaimed)
    if (genie.expiry && genie.expiry * 1000 < currentTime && genie.isResolved && !genie.isExercised) {
      return { text: 'Reclaimed', class: 'reclaimed' }
    }
    
    if (genie.isActive) return { text: 'Active', class: 'filled' }
    if (genie.isFunded) return { text: 'Funded', class: 'funded' }
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
      
      const response = await fetch(`/api/genie/${contractAddress}/enter`, {
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
        toast.loading('Please confirm entering the genie...')
        
        console.log('Sending enter future transaction:', enterTransaction)
        const tx = await sendTransaction(enterTransaction)
        
        if (tx) {
          toast.loading('Waiting for enter confirmation...')
          
          // Wait for confirmation
          await tx.wait()
          
          toast.success('Entered genie successfully!')
          
          // Close dialog and reset state
          setShowEnterDialog(false)
          setSelectedContract(null)
          
          // Notify backend about long entry event
          try {
            // For futures contracts, expiry should already be set by the contract during creation
            // We shouldn't override it with a new expiry time based on entry time
            await fetch(`/api/contracts/${contractAddress}/long-entered`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                longAddress: account,
                transactionHash: tx.hash
              })
            })
            console.log('Long entry recorded in database')
          } catch (error) {
            console.warn('Failed to record long entry:', error)
          }
          
          // Refresh futures data to show updated contract state
          try {
            await refetchGenies()
            console.log('Genies data refreshed after long entry')
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
      let errorMessage = 'Failed to enter genie'
      
      if (error.code === 4001) {
        errorMessage = 'Transaction rejected by user'
      } else if (error.message) {
        errorMessage = `Failed to enter genie: ${error.message}`
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
      const response = await fetch(`/api/genie/${contractAddress}/reclaim`, {
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
          
          toast.success('Genie resolved and funds reclaimed successfully!')
          
          // Refresh futures data to show updated contract state
          try {
            await refetchGenies()
            console.log('Genies data refreshed after reclaim')
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
      
      toast.error('Failed to reclaim genie')
    } finally {
      setIsLoading(false)
    }
  }

  const handleResolveAndExercise = async (contractAddress: string, genie: any) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    try {
      const response = await fetch(`/api/genie/${contractAddress}/resolveAndExercise`, {
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
          toast.success('✅ Genie resolved and exercised successfully!')
          
          // Clear cache to get fresh data
          await fetch('/api/factory/clear-cache', { method: 'POST' })
          
          // Refresh futures data to show updated contract state
          try {
            await refetchGenies()
            console.log('Genies data refreshed after exercise')
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
      
      toast.error('Failed to exercise genie')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-4">Genie Book</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Trade sinusoidal genie contracts with oscillating payoffs. Enter positions and ride the sinusoidal wave as payoffs cycle between 0% and 100% of notional based on price movement.
          </p>
        </div>

        {/* Filter Buttons */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-lg border border-border p-1">
            {[
              { key: 'all', label: 'All Genies' },
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
              <Card key={i} className="neon-outline-cyan">
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
          ) : filteredGenies.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No genies found</h3>
                <p className="text-muted-foreground">No genies match your current filter criteria.</p>
              </CardContent>
            </Card>
          ) : (
            filteredGenies.map((genie: any, index: number) => {
              const status = getStatus(genie)
              const isExpired = genie.expiry && genie.expiry * 1000 < currentTime
              
              // Check user roles
              const isLongPosition = genie.long && account && genie.long.toLowerCase() === account.toLowerCase()
              const isShortPosition = genie.short && account && genie.short.toLowerCase() === account.toLowerCase()
              
              const canExercise = genie.isActive && isExpired && !genie.isExercised && !genie.isResolved && isLongPosition
              const canReclaim = genie.isActive && isExpired && !genie.isExercised && !genie.isResolved && isShortPosition

              return (
                <Card key={index} className="neon-outline-cyan transition-all duration-300">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        {(() => {
                          // Determine contract type and display name
                          const contractType = genie.contractType || genie.payoffType || genie.optionType || 'SinusoidalGenie'
                          if (contractType.toLowerCase().includes('sinusoidal')) {
                            return 'Sinusoidal Genie'
                          }
                          return 'Sinusoidal Genie'
                        })()}
                      </CardTitle>
                      <div className="flex gap-2">
                        {(() => {
                          // Check user position for this specific future
                          const isLongPosition = genie.long && account && genie.long.toLowerCase() === account.toLowerCase()
                          const isShortPosition = genie.short && account && genie.short.toLowerCase() === account.toLowerCase()
                          const hasPosition = isLongPosition || isShortPosition
                          
                          return hasPosition && (
                            <Badge
                              variant="outline"
                              style={{
                                backgroundColor: isShortPosition ? SHORT_COLOR : LONG_COLOR,
                                color: TEXT_ON_COLOR,
                                borderColor: isShortPosition ? SHORT_COLOR : LONG_COLOR
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
                            const isLongPosition = genie.long && account && genie.long.toLowerCase() === account.toLowerCase()
                            const isShortPosition = genie.short && account && genie.short.toLowerCase() === account.toLowerCase()
                            
                            if (status.class === 'exercised') {
                              return {
                                backgroundColor: isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR,
                                color: TEXT_ON_COLOR,
                                borderColor: isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR
                              }
                            } else if (status.class === 'reclaimed') {
                              return {
                                backgroundColor: isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR,
                                color: TEXT_ON_COLOR,
                                borderColor: isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR
                              }
                            } else if (status.class === 'expired') {
                              // This covers "Unresolved" status - just text color, no background or border
                              return {
                                backgroundColor: 'transparent',
                                color: isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR,
                                border: 'none'
                              }
                            } else if (status.class === 'not-engaged') {
                              // This covers "Not Engaged" status - just text color, no background or border
                              return {
                                backgroundColor: 'transparent',
                                color: isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR,
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
                            if (genie.strikePrice && genie.strikePrice !== '0') {
                              return formatTokenAmount(genie.strikePrice, genie.strikeSymbol || 'MTK')
                            }
                            return genie.isFunded ? 'Set during funding' : 'Not funded yet'
                          })()}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Contract Size:</span>
                        <div className="font-medium">{formatTokenAmount(genie.optionSize, genie.underlyingSymbol || '2TK')}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Lifestyle:</span>
                        <div className="font-medium">
                          {(() => {
                            // Determine lifestyle based on contract type
                            // For now, LinearFiniteFutures is "Finite", future LinearPerpetualFutures will be "Perpetual"
                            const contractType = genie.contractType || genie.payoffType || 'LinearFiniteFutures'
                            if (contractType.toLowerCase().includes('perpetual')) {
                              return 'Perpetual'
                            }
                            return 'Finite'
                          })()}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          {(() => {
                            const contractType = genie.contractType || genie.payoffType || genie.optionType || 'LinearFiniteFutures'
                            if (contractType.toLowerCase().includes('power')) {
                              return 'Power:'
                            } else if (contractType.toLowerCase().includes('sigmoid')) {
                              return 'Intensity:'
                            }
                            return 'Power:'
                          })()}
                        </span>
                        <div className="font-medium">
                          {(() => {
                            const contractType = genie.contractType || genie.payoffType || genie.optionType || 'LinearFiniteFutures'
                            if (contractType.toLowerCase().includes('power')) {
                              return genie.payoffPower || 2
                            } else if (contractType.toLowerCase().includes('sigmoid')) {
                              return genie.sigmoidIntensity || genie.intensity || '1.0'
                            }
                            return 1
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Show expiry for all futures */}
                    <div className="text-sm">
                      <span className="text-muted-foreground">Expiry:</span>
                      <div className="font-medium">{formatExpiry(genie)}</div>
                    </div>

                    <div className="text-sm">
                      <span className="text-muted-foreground">Price of {genie.underlyingSymbol || '2TK'} at Expiry:</span>
                      <div className="font-medium">
                        {(() => {
                          const isExpired = genie.expiry && genie.expiry * 1000 < currentTime
                          if (!isExpired) {
                            return 'Not yet expired'
                          } else if (genie.isResolved) {
                            return formatTokenAmount(genie.priceAtExpiry, genie.strikeSymbol || 'MTK')
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
                        payoffType="Sinusoidal"
                        sinusoidalAmplitude={genie.amplitude || 1.0}
                        sinusoidalPeriod={genie.period || fromUnits(genie.strikePrice || "1000000000000000000", 18)}
                        strikePrice={genie.strikePrice || "1000000000000000000"}
                        optionSize={genie.optionSize}
                        strikeSymbol={genie.strikeSymbol || 'MTK'}
                        underlyingSymbol={genie.underlyingSymbol || '2TK'}
                        currentSpotPrice={genie.currentPrice}
                        decimals={18}
                        compact={true}
                        className="h-48"
                        isShortPosition={account && genie.short && account.toLowerCase() === genie.short.toLowerCase()}
                        isNonUserContract={!account || (!genie.short || account.toLowerCase() !== genie.short.toLowerCase()) && (!genie.long || account.toLowerCase() !== genie.long.toLowerCase())}
                        isFuturesContract={true}
                        isGenieContract={true}
                      />
                    </div>

                    <div className="flex gap-2 pt-4">
                      {!genie.isActive && !isLongPosition && !isShortPosition && (() => {
                        const isNonUserContract = !account || 
                          (!genie.short || account.toLowerCase() !== genie.short.toLowerCase()) && 
                          (!genie.long || account.toLowerCase() !== genie.long.toLowerCase())
                        
                        const buttonColor = isNonUserContract ? NEUTRAL_COLOR : LONG_COLOR
                        
                        return (
                          <Button
                            size="sm"
                            className="flex-1 group transition-all duration-300"
                            style={{
                              backgroundColor: buttonColor,
                              color: TEXT_ON_COLOR,
                              border: `1px solid ${buttonColor}`,
                              transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                              // Create animated background gradient with fade-in (consistent across all contracts)
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
                            onClick={() => handleEnterClick(genie)}
                          >
                            <TrendingUp className="h-4 w-4 mr-1" />
                            <span>Enter Position</span>
                          </Button>
                        )
                      })()}
                      
                      {canExercise && (() => {
                        const buttonIsLong = genie.long && account && genie.long.toLowerCase() === account.toLowerCase()
                        const buttonColor = buttonIsLong ? LONG_COLOR : SHORT_COLOR
                        
                        return (
                          <Button
                            size="sm"
                            className="flex-1 group transition-all duration-300"
                            style={{
                              backgroundColor: buttonColor,
                              color: TEXT_ON_COLOR,
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
                            onClick={() => handleResolveAndExercise(genie.address, genie)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            <span>Exercise</span>
                          </Button>
                        )
                      })()}
                      
                      {canReclaim && (() => {
                        const isLongPosition = genie.long && account && genie.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = genie.short && account && genie.short.toLowerCase() === account.toLowerCase()
                        
                        return (
                          <Button
                            size="sm"
                            className="flex-1 group transition-all duration-300"
                            style={{
                              backgroundColor: isShortPosition ? SHORT_COLOR : LONG_COLOR,
                              color: TEXT_ON_COLOR,
                              border: `1px solid ${isShortPosition ? SHORT_COLOR : LONG_COLOR}`,
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
                                element.style.background = isShortPosition ? SHORT_COLOR : LONG_COLOR
                                element.style.backgroundSize = 'auto'
                              }
                            }}
                            onClick={() => handleReclaim(genie.address)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            <span>Reclaim Funds</span>
                          </Button>
                        )
                      })()}
                      
                      {(() => {
                        const isLongPosition = genie.long && account && genie.long.toLowerCase() === account.toLowerCase()
                        const isShortPosition = genie.short && account && genie.short.toLowerCase() === account.toLowerCase()
                        const isNonUserContract = !isLongPosition && !isShortPosition
                        
                        const buttonColor = isShortPosition ? SHORT_COLOR : isLongPosition ? LONG_COLOR : NEUTRAL_COLOR
                        
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
                            onClick={() => router.push(`/genie/${genie.address}`)}
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
      
      {/* Enter Genies Dialog */}
      {showEnterDialog && selectedContract && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Enter Genie Contract</CardTitle>
              <p className="text-sm text-muted-foreground">
                Enter this genie position as counterparty
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-sm text-muted-foreground">Contract Details:</span>
                <div className="font-medium space-y-1">
                  <div>Type: {selectedContract.payoffType || 'Sinusoidal Genie'}</div>
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
                  Enter Genie
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}