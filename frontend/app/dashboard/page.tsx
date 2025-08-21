"use client"

import { useState, useEffect } from 'react'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TrendingUp, DollarSign, Clock, AlertCircle, Search, User, Box, Network } from 'lucide-react'

// Mock wallet context - replace with your actual wallet context
const useWallet = () => {
  const [account, setAccount] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  const connectWallet = async () => {
    setIsConnecting(true)
    try {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts'
        })
        setAccount(accounts[0])
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error)
    } finally {
      setIsConnecting(false)
    }
  }

  return { account, connectWallet, isConnecting }
}

// Mock data fetching - replace with your actual API calls
const useQuery = (key: string, fetchFn: () => Promise<any>, options?: any) => {
  const [data, setData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!options?.enabled && options?.enabled !== undefined) return

    setIsLoading(true)
    fetchFn()
      .then(setData)
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [])

  return { data, isLoading }
}

export default function DashboardPage() {
  const { account, connectWallet, isConnecting } = useWallet()
  const [contractAddress, setContractAddress] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [previousBlockNumber, setPreviousBlockNumber] = useState<number | null>(null)

  // Mock network info
  const { data: networkInfo } = useQuery('networkInfo', async () => {
    return {
      network: 'localhost',
      chainId: '31337',
      connected: true
    }
  })

  // Mock blockchain status
  const { data: blockchainStatus } = useQuery('blockNumber', async () => {
    return {
      blockNumber: Math.floor(Math.random() * 1000000) + 1000000,
      connected: true
    }
  })

  // Mock total volume
  const { data: totalVolume = '0' } = useQuery('totalVolume', async () => {
    return '1250.45'
  })

  // Animate block number changes
  useEffect(() => {
    if (blockchainStatus?.blockNumber && previousBlockNumber !== null && blockchainStatus.blockNumber !== previousBlockNumber) {
      setIsUpdating(true)
      setTimeout(() => setIsUpdating(false), 300)
    }
    setPreviousBlockNumber(blockchainStatus?.blockNumber)
  }, [blockchainStatus?.blockNumber, previousBlockNumber])

  const handleContractLookup = (e: React.FormEvent) => {
    e.preventDefault()
    if (contractAddress.trim()) {
      window.location.href = `/option/${contractAddress.trim()}`
    }
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-20">
          <div className="text-center mb-16">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl mb-4">
              Welcome to DDX Protocol
            </h1>
            <p className="text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
              Trade options with ease on the decentralized exchange
            </p>
          </div>
          
          <Card className="max-w-md mx-auto">
            <CardHeader className="text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <CardTitle>Connect Your Wallet</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-muted-foreground mb-6">Connect your MetaMask wallet to start trading options</p>
              <Button 
                onClick={connectWallet} 
                disabled={isConnecting}
                className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
              >
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </Button>
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
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Blockchain Layer-3 Protocol for Decentralized Derivatives Exchange
          </h1>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <Box className="h-8 w-8 mb-4 text-primary" />
              <div className={`text-3xl font-bold mb-2 ${isUpdating ? 'text-primary' : ''} transition-colors`}>
                {blockchainStatus?.blockNumber || '...'}
              </div>
              <p className="text-sm text-muted-foreground">Current Block</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <DollarSign className="h-8 w-8 mb-4 text-primary" />
              <div className="text-3xl font-bold mb-2">
                {totalVolume || 'Loading...'} MTK
              </div>
              <p className="text-sm text-muted-foreground">Total Volume</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col items-center p-6">
              <Network className="h-8 w-8 mb-4 text-primary" />
              <div className="text-3xl font-bold mb-2">
                {networkInfo?.network ? networkInfo.network.charAt(0).toUpperCase() + networkInfo.network.slice(1) : '...'}
              </div>
              <p className="text-sm text-muted-foreground">Network</p>
            </CardContent>
          </Card>
        </div>

        {/* Contract Lookup */}
        <Card className="mb-12">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Search className="h-5 w-5 mr-2" />
              Access Option Contract
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleContractLookup}>
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label htmlFor="contractAddress">Contract Address</Label>
                  <Input
                    id="contractAddress"
                    type="text"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="0x..."
                    pattern="^0x[a-fA-F0-9]{40}$"
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button 
                    type="submit" 
                    disabled={!contractAddress.trim()}
                    className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    View Contract
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => window.location.href = '/market'}
          >
            <TrendingUp className="h-5 w-5" />
            Browse Options
          </Button>
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => window.location.href = '/create'}
          >
            <DollarSign className="h-5 w-5" />
            Draft Contract
          </Button>
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => window.location.href = '/my-options'}
          >
            <Clock className="h-5 w-5" />
            Futures Book
          </Button>
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => window.location.href = '/my-options'}
          >
            <User className="h-5 w-5" />
            My Options
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}