"use client"

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ArrowLeft, DollarSign, TrendingUp, AlertTriangle, Clock, Shield, Activity, Users, Target } from 'lucide-react'
import OptionPayoffChart from '@/components/OptionPayoffChart'

// Real wallet context hook
import { useWallet } from "@/components/wallet-context"
import { COLORS } from "@/lib/colors"

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
    return Math.random()
  },
  dismiss: (id?: any) => {
    console.log('Toast dismissed')
  }
}

export default function FutureDetailPage() {
  const params = useParams()
  const router = useRouter()
  const contractAddress = params?.contractAddress as string
  const { account, sendTransaction } = useWallet()
  const [isLoading, setIsLoading] = useState(false)

  // Color constants (imported from central colors file)
  const LONG_COLOR = COLORS.LONG
  const SHORT_COLOR = COLORS.SHORT
  const NEUTRAL_COLOR = COLORS.NEUTRAL
  const TEXT_ON_COLOR = COLORS.TEXT_ON_COLOR
  const [currentTime, setCurrentTime] = useState(Date.now())

  // Update current time every second for real-time countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  // Format token amounts
  const formatTokenAmount = (amount: string, symbol: string) => {
    if (!amount) return `0 ${symbol}`
    
    try {
      const weiAmount = BigInt(amount)
      const etherAmount = Number(weiAmount) / Math.pow(10, 18)
      const formatted = etherAmount.toFixed(6).replace(/\.?0+$/, '')
      return `${formatted} ${symbol}`
    } catch (error) {
      if (typeof amount === 'string' && amount.includes('e')) {
        const numValue = parseFloat(amount)
        const etherAmount = numValue / Math.pow(10, 18)
        const formatted = etherAmount.toFixed(6).replace(/\.?0+$/, '')
        return `${formatted} ${symbol}`
      }
      
      const numValue = parseFloat(amount)
      const formatted = numValue.toFixed(6).replace(/\.?0+$/, '')
      return `${formatted} ${symbol}`
    }
  }

  // Format expiry display for futures
  const formatExpiry = (future: any) => {
    if (!future.expiry) return 'Not set'
    
    if (!future.isFunded || !future.isActive) {
      return '5 minutes upon activation'
    }
    
    const expiryTime = future.expiry * 1000
    const timeRemaining = expiryTime - currentTime
    
    if (timeRemaining <= 0) {
      const expiryDate = new Date(expiryTime)
      return `${expiryDate.toLocaleDateString()} ${expiryDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
    }
    
    const minutes = Math.floor(timeRemaining / (1000 * 60))
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000)
    
    return `${minutes}:${seconds.toString().padStart(2, '0')} remaining`
  }

  // Fetch future details
  const fetchFutureData = useCallback(async () => {
    try {
      const response = await fetch(`/api/futures/${contractAddress}`)
      if (!response.ok) {
        throw new Error('Failed to fetch future data')
      }
      return await response.json()
    } catch (error) {
      console.error('Error fetching future data:', error)
      throw error
    }
  }, [contractAddress])

  const { data: futureData, isLoading: isLoadingFuture } = useQuery(
    `future-${contractAddress}`,
    fetchFutureData,
    {
      enabled: !!contractAddress
    }
  )

  const getStatus = () => {
    if (!futureData) return { text: 'Loading...', class: 'funded' }
    if (futureData.isExercised) return { text: 'Exercised', class: 'exercised' }
    
    if (!futureData.isFunded || !futureData.isActive) {
      return { text: 'Not Engaged', class: 'not-engaged' }
    }
    
    if (futureData.expiry && futureData.expiry * 1000 < currentTime && !futureData.isResolved) {
      return { text: 'Unresolved', class: 'expired' }
    }
    
    if (futureData.expiry && futureData.expiry * 1000 < currentTime && futureData.isResolved && !futureData.isExercised) {
      return { text: 'Reclaimed', class: 'reclaimed' }
    }
    
    if (futureData.isActive) return { text: 'Active', class: 'filled' }
    if (futureData.isFunded) return { text: 'Funded', class: 'funded' }
    return { text: 'Created', class: 'funded' }
  }

  const status = getStatus()

  if (isLoadingFuture) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-center mb-8">Loading future details...</h1>
        </main>
        <Footer />
      </div>
    )
  }

  if (!futureData) {
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
            Back to Futures
          </Button>
          <h1 className="text-3xl font-bold text-center mb-8">Future Not Found</h1>
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">The futures contract could not be found or loaded.</p>
            </CardContent>
          </Card>
        </main>
        <Footer />
      </div>
    )
  }

  // Check user positions
  const isLongPosition = futureData.long && account && futureData.long.toLowerCase() === account.toLowerCase()
  const isShortPosition = futureData.short && account && futureData.short.toLowerCase() === account.toLowerCase()

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
          Back to Futures
        </Button>

        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl mb-4">
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient">
              {(() => {
                const contractType = futureData?.contractType || futureData?.payoffType || futureData?.optionType || 'LinearFiniteFutures'
                if (contractType.toLowerCase().includes('power')) {
                  return 'Power Future'
                }
                return 'Linear Future'
              })()}
            </span>
            <br />
            Contract Details
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Complete overview of this futures contract including pricing, positions, and trading opportunities
          </p>
        </div>

        {/* Status and Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-12">
          <Card className="text-center neon-outline-indigo">
            <CardContent className="pt-6">
              <div className="rounded-full bg-primary/10 p-3 mb-4 mx-auto w-fit">
                <Activity className="h-6 w-6 text-primary" />
              </div>
              <Badge
                variant={status.class === 'filled' ? 'default' : 
                        status.class === 'funded' ? 'secondary' : 
                        status.class === 'expired' ? 'destructive' : 'outline'}
                className="mb-2"
                style={(() => {
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
              <div className="text-sm text-muted-foreground">Contract Status</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline-indigo">
            <CardContent className="pt-6">
              <div className="rounded-full bg-accent/10 p-3 mb-4 mx-auto w-fit">
                <Target className="h-6 w-6 text-accent" />
              </div>
              <div className="text-2xl font-bold mb-2">
                {(() => {
                  // Strike price is now set during funding, not activation
                  if (futureData.strikePrice && futureData.strikePrice !== '0') {
                    return formatTokenAmount(futureData.strikePrice, futureData.strikeSymbol || 'MTK')
                  }
                  return futureData.isFunded ? 'Set during funding' : 'Not funded yet'
                })()}
              </div>
              <div className="text-sm text-muted-foreground">Strike Price</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline-indigo">
            <CardContent className="pt-6">
              <div className="rounded-full bg-primary/10 p-3 mb-4 mx-auto w-fit">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div className="text-2xl font-bold mb-2">
                {formatTokenAmount(futureData.optionSize, futureData.underlyingSymbol || '2TK')}
              </div>
              <div className="text-sm text-muted-foreground">Contract Size</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline-indigo">
            <CardContent className="pt-6">
              <div className="rounded-full bg-secondary/10 p-3 mb-4 mx-auto w-fit">
                <Shield className="h-6 w-6 text-secondary" />
              </div>
              <div className="text-xl font-bold mb-2">
                {(() => {
                  // Determine lifestyle based on contract type
                  const contractType = futureData.contractType || futureData.payoffType || 'LinearFiniteFutures'
                  if (contractType.toLowerCase().includes('perpetual')) {
                    return 'Perpetual'
                  }
                  return 'Finite'
                })()}
              </div>
              <div className="text-sm text-muted-foreground">Lifestyle</div>
            </CardContent>
          </Card>

          <Card className="text-center neon-outline-indigo">
            <CardContent className="pt-6">
              <div className="rounded-full bg-accent/10 p-3 mb-4 mx-auto w-fit">
                <Clock className="h-6 w-6 text-accent" />
              </div>
              <div className="text-xl font-bold mb-2">
                {formatExpiry(futureData)}
              </div>
              <div className="text-sm text-muted-foreground">Expiry</div>
            </CardContent>
          </Card>
        </div>

        {/* Position Badge */}
        {(isLongPosition || isShortPosition) && (
          <div className="flex justify-center mb-8">
            <Badge
              variant="outline"
              className="text-lg px-4 py-2"
              style={{
                backgroundColor: isShortPosition ? SHORT_COLOR : LONG_COLOR,
                color: TEXT_ON_COLOR,
                borderColor: isShortPosition ? SHORT_COLOR : LONG_COLOR
              }}
            >
              Your Position: {isShortPosition ? 'Short' : 'Long'}
            </Badge>
          </div>
        )}

        {/* Trading Information */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          <Card className="neon-outline-indigo">
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
                  <div className="text-sm font-medium">No Premium Required</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Lifestyle</div>
                  <div className="text-sm font-medium">
                    {(() => {
                      const contractType = futureData.contractType || futureData.payoffType || 'LinearFiniteFutures'
                      if (contractType.toLowerCase().includes('perpetual')) {
                        return 'Perpetual'
                      }
                      return 'Finite'
                    })()}
                  </div>
                </div>
                {/* Show power for Power Futures */}
                {(() => {
                  const contractType = futureData.contractType || futureData.payoffType || futureData.optionType || 'LinearFiniteFutures'
                  if (contractType.toLowerCase().includes('power')) {
                    return (
                      <div className="p-3 bg-muted/50 rounded-lg">
                        <div className="text-sm text-muted-foreground mb-1">Power</div>
                        <div className="text-sm font-medium">{futureData.payoffPower || 2}</div>
                      </div>
                    )
                  }
                  return null
                })()}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Price of {futureData.underlyingSymbol || '2TK'} at Expiry</div>
                  <div className="text-sm font-medium">
                    {(() => {
                      const isExpired = futureData.expiry && futureData.expiry * 1000 < currentTime
                      if (!isExpired) {
                        return 'Not yet expired'
                      } else if (futureData.isResolved) {
                        return formatTokenAmount(futureData.priceAtExpiry, futureData.strikeSymbol || 'MTK')
                      } else {
                        return '? MTK'
                      }
                    })()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="neon-outline-indigo">
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
                  <div className="code-font text-sm break-all">{futureData.short || 'Not filled'}</div>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground mb-1">Long Position</div>
                  <div className="code-font text-sm break-all">{futureData.long || 'Not filled'}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payoff Graph */}
        <Card className="mb-8 neon-outline-indigo">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="h-5 w-5 mr-2 text-accent" />
              Payoff Graph
            </CardTitle>
          </CardHeader>
          <CardContent>
            <OptionPayoffChart
              optionType="CALL"
              payoffType={(() => {
                const contractType = futureData.contractType || futureData.payoffType || futureData.optionType || 'LinearFiniteFutures'
                if (contractType.toLowerCase().includes('power')) {
                  return 'Power'
                }
                return 'Linear'
              })()}
              payoffPower={futureData.payoffPower || 2}
              strikePrice={futureData.strikePrice || "1000000000000000000"}
              optionSize={futureData.optionSize}
              strikeSymbol={futureData.strikeSymbol || 'MTK'}
              underlyingSymbol={futureData.underlyingSymbol || '2TK'}
              currentSpotPrice={futureData.currentPrice}
              decimals={18}
              rangeFraction={1.0}
              isShortPosition={isShortPosition}
              isNonUserContract={!isLongPosition && !isShortPosition}
              isFuturesContract={true}
            />
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  )
}