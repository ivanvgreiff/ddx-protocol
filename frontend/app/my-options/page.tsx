"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Eye } from 'lucide-react'

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

  return { account }
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

    fetchData()

    // Set up interval if specified
    if (options?.refetchInterval) {
      const interval = setInterval(fetchData, options.refetchInterval)
      return () => clearInterval(interval)
    }
  }, [key, options?.refetchInterval, options?.enabled])

  return { data, isLoading, error }
}

export default function MyOptionsPage() {
  const router = useRouter()
  const { account } = useWallet()
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

  // Fetch user's options from current OptionsBook factory
  const { data: optionsData, isLoading } = useQuery(
    'userOptions',
    async () => {
      if (!account) return { contracts: [] }
      
      const response = await fetch('/api/factory/all-contracts')
      if (!response.ok) {
        throw new Error('Failed to fetch options')
      }
      const data = await response.json()
      
      // Filter options where user is either short or long
      const userOptions = (data.contracts || []).filter((option: any) => {
        const isShort = option.short && account && option.short.toLowerCase() === account.toLowerCase()
        const isLong = option.long && account && option.long.toLowerCase() === account.toLowerCase()
        return isShort || isLong
      }).map((option: any) => {
        // Add role information
        const isShort = option.short && account && option.short.toLowerCase() === account.toLowerCase()
        return {
          ...option,
          role: isShort ? 'short' : 'long'
        }
      })
      
      return { contracts: userOptions }
    },
    {
      enabled: !!account,
      refetchInterval: 120000, // Refetch every 2 minutes
    }
  )

  const userOptions = optionsData?.contracts || []

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

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-center mb-8">My Options</h1>
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
              <p className="text-muted-foreground">Please connect your wallet to view your options</p>
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
        <h1 className="text-3xl font-bold text-center mb-8">My Options</h1>

        {isLoading ? (
          <Card>
            <CardContent className="p-12 text-center">
              <h3 className="text-lg font-semibold mb-2">Loading your options...</h3>
              <p className="text-muted-foreground">Fetching your positions from the blockchain.</p>
            </CardContent>
          </Card>
        ) : userOptions.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Options Found</h3>
              <p className="text-muted-foreground">You don't have any options yet. Create or buy some options to get started!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {userOptions.map((option: any, index: number) => {
              const status = getStatus(option)

              return (
                <Card key={index} className="hover:shadow-lg transition-shadow hover:translate-y-[-5px] transition-transform duration-300">
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
                        <Badge
                          variant={option.role === 'short' ? 'destructive' : 'default'}
                        >
                          {option.role === 'short' ? 'Short' : 'Long'}
                        </Badge>
                        <Badge
                          variant={status.class === 'filled' ? 'default' : 
                                  status.class === 'funded' ? 'secondary' : 
                                  status.class === 'expired' ? 'destructive' : 
                                  status.class === 'exercised' ? 'default' :
                                  status.class === 'reclaimed' ? 'secondary' : 'outline'}
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
                        <div className="font-medium">
                          {(() => {
                            if (!option.expiry) return 'Not set'
                            
                            // If option is not yet engaged (not funded or not active), show activation message
                            if (!option.isFunded || !option.isActive) {
                              return '5 min upon activation'
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
                          })()}
                        </div>
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

                    <div className="flex gap-2 pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/option/${option.address}`)}
                        className="flex-1"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View Details
                      </Button>
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