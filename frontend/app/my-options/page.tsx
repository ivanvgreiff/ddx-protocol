"use client"

import { useState } from 'react'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle } from 'lucide-react'

// Mock wallet context
const useWallet = () => {
  const [account, setAccount] = useState<string | null>("0x1234567890123456789012345678901234567890")
  return { account }
}

// Mock data for user's options
const mockMyOptions = [
  {
    contractAddress: '0x1234567890123456789012345678901234567890',
    role: 'short',
    underlyingSymbol: '2TK',
    strikeSymbol: 'MTK',
    strikePrice: '1.5',
    optionSize: '100',
    premium: '50',
    expiry: Date.now() + 5 * 60 * 1000,
    isFilled: true,
    isExercised: false,
    isFunded: true,
    isResolved: true,
    priceAtExpiry: '2.0'
  },
  {
    contractAddress: '0x5678901234567890123456789012345678901234',
    role: 'long',
    underlyingSymbol: '2TK',
    strikeSymbol: 'MTK',
    strikePrice: '2.0',
    optionSize: '200',
    premium: '75',
    expiry: Date.now() - 2 * 60 * 1000,
    isFilled: true,
    isExercised: false,
    isFunded: true,
    isResolved: true,
    priceAtExpiry: '2.5'
  }
]

export default function MyOptionsPage() {
  const { account } = useWallet()

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <h1 className="text-3xl font-bold text-center mb-8">Futures Book</h1>
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
        <h1 className="text-3xl font-bold text-center mb-8">Futures Book</h1>

        {mockMyOptions.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Options Found</h3>
              <p className="text-muted-foreground">You don't have any options yet. Create or buy some options to get started!</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {mockMyOptions.map((option, index) => (
              <Card key={index} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      {option.underlyingSymbol}/{option.strikeSymbol}
                    </CardTitle>
                    <Badge
                      variant={option.role === 'short' ? 'destructive' : 'default'}
                    >
                      {option.role === 'short' ? 'Short' : 'Long'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Strike Price:</span>
                      <div className="font-medium">{option.strikePrice} {option.strikeSymbol}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Option Size:</span>
                      <div className="font-medium">{option.optionSize} {option.underlyingSymbol}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Premium:</span>
                      <div className="font-medium">{option.premium} {option.strikeSymbol}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expiry:</span>
                      <div className="font-medium">
                        {new Date(option.expiry).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {option.priceAtExpiry && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Price at Expiry:</span>
                      <div className="font-medium">{option.priceAtExpiry} {option.strikeSymbol}</div>
                    </div>
                  )}

                  <div className="text-sm">
                    <span className="text-muted-foreground">Status:</span>
                    <div className="font-medium">
                      {option.isExercised ? 'Exercised' : 
                       option.expiry < Date.now() ? 'Expired' : 
                       option.isFilled ? 'Active' : 'Funded'}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}