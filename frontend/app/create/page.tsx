"use client"

import { useState } from 'react'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Plus, DollarSign, AlertTriangle } from 'lucide-react'

// Mock wallet context
const useWallet = () => {
  const [account, setAccount] = useState<string | null>("0x1234567890123456789012345678901234567890")
  const sendTransaction = async (txData: any) => {
    console.log('Sending transaction:', txData)
    return { hash: '0xabc123...', wait: () => Promise.resolve() }
  }
  return { account, sendTransaction }
}

export default function CreateOptionPage() {
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
      alert('Copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!account) {
      alert('Please connect your wallet first')
      return
    }

    setIsCreating(true)
    
    try {
      // Mock API call
      console.log('Creating option with data:', {
        ...formData,
        userAddress: account,
        payoffType: payoffType
      })
      
      // Simulate transaction creation
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Mock successful deployment
      setContractDeploymentInfo({
        txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        contractAddress: '0xabcdef1234567890abcdef1234567890abcdef12'
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
      
    } catch (error) {
      console.error('Error creating option:', error)
      alert('Failed to create option contract')
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
                onClick={() => window.location.href = `/option/${contractDeploymentInfo.contractAddress}`}
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
      </main>
      <Footer />
    </div>
  )
}