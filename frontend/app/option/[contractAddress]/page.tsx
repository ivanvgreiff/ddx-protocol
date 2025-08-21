"use client"

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowLeft, DollarSign, TrendingUp, AlertTriangle } from 'lucide-react'

// Mock wallet context
const useWallet = () => {
  const [account, setAccount] = useState<string | null>("0x1234567890123456789012345678901234567890")
  const sendTransaction = async (txData: any) => {
    console.log('Sending transaction:', txData)
    return { hash: '0xabc123...', wait: () => Promise.resolve() }
  }
  return { account, sendTransaction }
}

// Mock option data
const mockOptionData = {
  address: '0x1234567890123456789012345678901234567890',
  optionType: 'CALL',
  payoffType: 'Linear',
  underlyingToken: '0x2345678901234567890123456789012345678901',
  strikeToken: '0x3456789012345678901234567890123456789012',
  underlyingSymbol: '2TK',
  strikeSymbol: 'MTK',
  strikePrice: '1500000000000000000',
  optionSize: '100000000000000000000',
  premium: '50000000000000000000',
  oracle: '0x4567890123456789012345678901234567890123',
  short: '0x1234567890123456789012345678901234567890',
  long: '0x0000000000000000000000000000000000000000',
  expiry: 0,
  isFunded: true,
  isActive: false,
  isExercised: false,
  isResolved: false,
  priceAtExpiry: '0',
  optionsBook: '0x5678901234567890123456789012345678901234'
}

export default function OptionDetailPage() {
  const params = useParams()
  const contractAddress = params?.contractAddress as string
  const { account, sendTransaction } = useWallet()
  const [isLoading, setIsLoading] = useState(false)
  const [showExerciseInput, setShowExerciseInput] = useState(false)
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

  // Format expiry display
  const formatExpiry = (expiry: number, isActive: boolean, isFunded: boolean) => {
    if (!expiry) return 'Not set'
    
    if (!isFunded || !isActive) {
      return '5 minutes upon activation'
    }
    
    return new Date(expiry * 1000).toLocaleString()
  }

  const handleFund = async () => {
    if (!account) {
      alert('Please connect your wallet first')
      return
    }
    setIsLoading(true)
    try {
      console.log('Funding option:', contractAddress)
      await new Promise(resolve => setTimeout(resolve, 2000))
      alert('Option funded successfully!')
    } catch (error) {
      console.error('Error funding option:', error)
      alert('Failed to fund option')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEnter = async () => {
    if (!account) {
      alert('Please connect your wallet first')
      return
    }
    setIsLoading(true)
    try {
      console.log('Entering option:', contractAddress)
      await new Promise(resolve => setTimeout(resolve, 2000))
      alert('Long position entered successfully!')
    } catch (error) {
      console.error('Error entering option:', error)
      alert('Failed to enter option')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExercise = async () => {
    if (!account) {
      alert('Please connect your wallet first')
      return
    }
    setIsLoading(true)
    try {
      console.log('Exercising option:', contractAddress, 'Amount:', exerciseAmount)
      await new Promise(resolve => setTimeout(resolve, 2000))
      alert('Option exercised successfully!')
    } catch (error) {
      console.error('Error exercising option:', error)
      alert('Failed to exercise option')
    } finally {
      setIsLoading(false)
    }
  }

  const handleReclaim = async () => {
    if (!account) {
      alert('Please connect your wallet first')
      return
    }
    setIsLoading(true)
    try {
      console.log('Reclaiming option:', contractAddress)
      await new Promise(resolve => setTimeout(resolve, 2000))
      alert('Funds reclaimed successfully!')
    } catch (error) {
      console.error('Error reclaiming option:', error)
      alert('Failed to reclaim funds')
    } finally {
      setIsLoading(false)
    }
  }

  const getStatus = () => {
    if (!mockOptionData) return { text: 'Loading...', class: 'funded' }
    if (mockOptionData.isExercised) return { text: 'Exercised', class: 'exercised' }
    
    if (!mockOptionData.isFunded || !mockOptionData.isActive) {
      return { text: 'Not Engaged', class: 'not-engaged' }
    }
    
    if (mockOptionData.expiry && Date.now() > mockOptionData.expiry * 1000 && !mockOptionData.isResolved) {
      return { text: 'Unresolved', class: 'expired' }
    }
    
    if (mockOptionData.expiry && Date.now() > mockOptionData.expiry * 1000 && mockOptionData.isResolved) {
      return { text: 'Expired', class: 'expired' }
    }
    
    if (mockOptionData.isActive) return { text: 'Active', class: 'filled' }
    if (mockOptionData.isFunded) return { text: 'Funded', class: 'funded' }
    return { text: 'Created', class: 'funded' }
  }

  const status = getStatus()

  if (!mockOptionData) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <Button
            variant="outline"
            className="mb-6"
            onClick={() => window.history.back()}
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
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <Button
          variant="outline"
          className="mb-6"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Market
        </Button>

        <h1 className="text-3xl font-bold text-center mb-8">
          {(() => {
            const payoffType = mockOptionData.payoffType || 'Linear'
            const optionType = mockOptionData.optionType === 'CALL' ? 'Call' : mockOptionData.optionType === 'PUT' ? 'Put' : 'Option'
            return `${payoffType} ${optionType} Details`
          })()}
        </h1>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Contract Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Contract Address</div>
                <div className="font-mono text-sm break-all">{formatAddress(contractAddress)}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Status</div>
                <Badge
                  variant={status.class === 'filled' ? 'default' : 
                          status.class === 'funded' ? 'secondary' : 
                          status.class === 'expired' ? 'destructive' : 'outline'}
                >
                  {status.text}
                </Badge>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Short Position</div>
                <div className="font-mono text-sm break-all">{formatAddress(mockOptionData.short)}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Long Position</div>
                <div className="font-mono text-sm break-all">{formatAddress(mockOptionData.long)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Token Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Underlying Token</div>
                <div className="font-medium">{mockOptionData.underlyingSymbol || '2TK'}</div>
                <div className="font-mono text-xs text-muted-foreground break-all">{formatAddress(mockOptionData.underlyingToken)}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Strike Token</div>
                <div className="font-medium">{mockOptionData.strikeSymbol || 'MTK'}</div>
                <div className="font-mono text-xs text-muted-foreground break-all">{formatAddress(mockOptionData.strikeToken)}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Strike Price</div>
                <div className="font-medium">{formatTokenAmount(mockOptionData.strikePrice, mockOptionData.strikeSymbol || 'MTK')}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Option Size</div>
                <div className="font-medium">{formatTokenAmount(mockOptionData.optionSize, mockOptionData.underlyingSymbol || '2TK')}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Trading Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Premium</div>
                <div className="font-medium">{formatTokenAmount(mockOptionData.premium, mockOptionData.strikeSymbol || 'MTK')}</div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Expiry</div>
                <div className="font-medium">
                  {formatExpiry(mockOptionData.expiry, mockOptionData.isActive, mockOptionData.isFunded)}
                </div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Price of {mockOptionData.underlyingSymbol || '2TK'} at Expiry</div>
                <div className="font-medium">
                  {(() => {
                    const isExpired = mockOptionData.expiry && Date.now() > mockOptionData.expiry * 1000
                    if (!isExpired) {
                      return 'Not yet expired'
                    } else if (mockOptionData.isResolved) {
                      return formatTokenAmount(mockOptionData.priceAtExpiry, mockOptionData.strikeSymbol || 'MTK')
                    } else {
                      return 'Expired - Needs Resolution'
                    }
                  })()}
                </div>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <div className="text-sm text-muted-foreground">Options Book</div>
                <div className="font-mono text-sm break-all">{formatAddress(mockOptionData.optionsBook)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 mb-8">
          {!mockOptionData.isFunded && (
            <Button
              onClick={handleFund}
              disabled={isLoading}
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              <DollarSign className="h-4 w-4 mr-2" />
              Fund Option
            </Button>
          )}
          
          {!mockOptionData.isActive && mockOptionData.isFunded && (
            <Button
              onClick={handleEnter}
              disabled={isLoading}
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Enter as Long
            </Button>
          )}
          
          {(() => {
            const longMatchesAccount = mockOptionData.long && account && mockOptionData.long.toLowerCase() === account.toLowerCase()
            const isExpired = mockOptionData.expiry && Date.now() > mockOptionData.expiry * 1000
            const canExercise = mockOptionData.isActive && isExpired && !mockOptionData.isExercised && longMatchesAccount
            
            return canExercise && (
              <Button
                variant="outline"
                onClick={() => setShowExerciseInput(!showExerciseInput)}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                {showExerciseInput ? 'Hide Exercise' : 'Exercise Option'}
              </Button>
            )
          })()}
          
          {(() => {
            const shortMatchesAccount = mockOptionData.short && account && mockOptionData.short.toLowerCase() === account.toLowerCase()
            const isExpired = mockOptionData.expiry && Date.now() > mockOptionData.expiry * 1000
            const canReclaim = mockOptionData.isActive && isExpired && !mockOptionData.isExercised && !mockOptionData.isResolved && shortMatchesAccount
            
            return canReclaim && (
              <Button
                variant="outline"
                onClick={handleReclaim}
                disabled={isLoading}
              >
                <DollarSign className="h-4 w-4 mr-2" />
                Reclaim Funds
              </Button>
            )
          })()}
        </div>

        {/* Exercise Input Section */}
        {showExerciseInput && (
          <Card>
            <CardHeader>
              <CardTitle>Exercise Option</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertDescription>
                  Enter the amount of MTK tokens you want to spend to exercise this option.
                </AlertDescription>
              </Alert>
              
              <div>
                <Label htmlFor="exerciseAmount">MTK Amount</Label>
                <Input
                  id="exerciseAmount"
                  type="number"
                  value={exerciseAmount}
                  onChange={(e) => setExerciseAmount(e.target.value)}
                  placeholder="Enter MTK amount"
                  step="0.01"
                  min="0"
                />
              </div>
              
              <Button
                onClick={handleExercise}
                disabled={isLoading || !exerciseAmount}
                className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              >
                <DollarSign className="h-4 w-4 mr-2" />
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