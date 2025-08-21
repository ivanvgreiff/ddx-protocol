'use client'

import { useState, useEffect } from "react"
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Navigation } from "@/components/navigation"
import { useWallet } from "@/contexts/WalletContext"
import { ArrowUpRight, TrendingUp, DollarSign, Activity, Users, BarChart3, Search, AlertCircle, Network } from "lucide-react"
import axios from 'axios'
import Link from 'next/link'

export default function Dashboard() {
  const router = useRouter()
  const { account, connectWallet } = useWallet()
  const [contractAddress, setContractAddress] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [previousBlockNumber, setPreviousBlockNumber] = useState<number | null>(null)

  // Fetch network info once and cache permanently
  const { data: networkInfo } = useQuery({
    queryKey: ['networkInfo'],
    queryFn: async () => {
      const response = await axios.get('/api/blockchain/status')
      return {
        network: response.data.network,
        chainId: response.data.chainId,
        connected: response.data.connected
      }
    },
    staleTime: Infinity, // Never consider stale - cache forever
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 5000
  })

  // Fetch current block number every minute
  const { data: blockchainStatus } = useQuery({
    queryKey: ['blockNumber'],
    queryFn: async () => {
      const response = await axios.get('/api/blockchain/status')
      return response.data
    },
    refetchInterval: 60000, // Every 60 seconds
    staleTime: 50000, // Consider stale after 50 seconds
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 5000
  })

  // Animate block number changes
  useEffect(() => {
    if (blockchainStatus?.blockNumber && previousBlockNumber !== null && blockchainStatus.blockNumber !== previousBlockNumber) {
      setIsUpdating(true)
      setTimeout(() => setIsUpdating(false), 300)
    }
    setPreviousBlockNumber(blockchainStatus?.blockNumber)
  }, [blockchainStatus?.blockNumber, previousBlockNumber])

  // Get total volume directly from OptionsBook contract
  const { data: totalVolume = '0' } = useQuery({
    queryKey: ['totalVolume'],
    queryFn: async () => {
      try {
        // Use the optimized endpoint
        const response = await axios.get('/api/factory/all-contracts')
        
        console.log('📊 Total volume debug:', {
          responseData: response.data,
          totalVolumeRaw: response.data.totalVolume,
          totalVolumeType: typeof response.data.totalVolume
        })
        
        // Use direct total volume from OptionsBook contract (already in wei)
        const totalVolumeWei = response.data.totalVolume || '0'
        
        // Convert from wei to MTK for display
        const totalVolumeNumber = parseFloat(totalVolumeWei)
        const volumeInMTK = totalVolumeNumber / Math.pow(10, 18)
        
        console.log('📊 Volume conversion debug:', {
          totalVolumeWei,
          totalVolumeNumber,
          volumeInMTK,
          finalDisplay: volumeInMTK.toFixed(2)
        })
        
        return volumeInMTK.toFixed(2)
      } catch (error) {
        console.error('❌ Error fetching total volume:', error)
        return '0'
      }
    },
    refetchInterval: 60000, // Update every 60 seconds
    staleTime: 0, // Always consider stale to force fresh requests
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 10000
  })

  const handleContractLookup = (e: React.FormEvent) => {
    e.preventDefault()
    if (contractAddress.trim()) {
      router.push(`/option/${contractAddress.trim()}`)
    }
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        
        <section className="container mx-auto px-6 py-16">
          <div className="text-center max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-4">
              Blockchain Layer-3 Protocol for Decentralized Derivatives Exchange
            </Badge>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Welcome to DDX Protocol
            </h1>
            <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
              Trade options with ease on the decentralized exchange
            </p>
          </div>
        </section>
        
        <div className="container mx-auto px-6">
          <Card className="bg-card border-border max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-primary" />
              <CardTitle className="text-2xl">Connect Your Wallet</CardTitle>
              <CardDescription>
                Connect your MetaMask wallet to start trading options
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button onClick={connectWallet} size="lg" className="bg-primary hover:bg-primary/90">
                Connect Wallet
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-16">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4">
            Fully On-Chain Derivatives
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
            Blockchain Layer-3 Protocol for Decentralized Derivatives Exchange
          </h1>
        </div>
      </section>

      {/* Protocol Stats */}
      <section className="container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Current Block</CardTitle>
              <BarChart3 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold transition-colors ${isUpdating ? 'text-primary' : ''}`}>
                {blockchainStatus?.blockNumber || '...'}
              </div>
              <p className="text-xs text-muted-foreground">Live blockchain data</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Volume</CardTitle>
              <DollarSign className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {totalVolume || 'Loading...'} MTK
              </div>
              <p className="text-xs text-muted-foreground">Total trading volume</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Network</CardTitle>
              <Network className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {networkInfo?.network ? networkInfo.network.charAt(0).toUpperCase() + networkInfo.network.slice(1) : '...'}
              </div>
              <p className="text-xs text-muted-foreground">Connected network</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Contract Lookup */}
      <section className="container mx-auto px-6 py-12">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Access Option Contract
            </CardTitle>
            <CardDescription>
              Enter a contract address to view and interact with existing option contracts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleContractLookup} className="flex gap-4">
              <div className="flex-1">
                <Label htmlFor="contract-address" className="sr-only">Contract Address</Label>
                <Input
                  id="contract-address"
                  type="text"
                  value={contractAddress}
                  onChange={(e) => setContractAddress(e.target.value)}
                  placeholder="0x..."
                  pattern="^0x[a-fA-F0-9]{40}$"
                  className="font-mono"
                />
              </div>
              <Button type="submit" disabled={!contractAddress.trim()}>
                <Search className="w-4 h-4 mr-2" />
                View Contract
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* Quick Actions */}
      <section className="container mx-auto px-6 py-16">
        <div className="bg-card border border-border rounded-lg p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Ready to Start Trading?</h2>
            <p className="text-muted-foreground">Access the options market or create your own custom contracts</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Link href="/market">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                <TrendingUp className="w-6 h-6" />
                Browse Options
              </Button>
            </Link>
            <Link href="/create">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                <DollarSign className="w-6 h-6" />
                Draft Contract
              </Button>
            </Link>
            <Link href="/my-options">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                <Activity className="w-6 h-6" />
                Futures Book
              </Button>
            </Link>
            <Link href="/my-options">
              <Button variant="outline" className="w-full h-20 flex flex-col gap-2">
                <Users className="w-6 h-6" />
                My Options
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/50 mt-16">
        <div className="container mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center gap-2 mb-4 md:mb-0">
              <div className="w-6 h-6 bg-primary rounded flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">DDX Protocol</span>
            </div>
            <p className="text-sm text-muted-foreground">© 2024 DDX Protocol. Decentralized derivatives trading.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
