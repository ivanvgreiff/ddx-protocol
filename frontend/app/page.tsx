"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TrendingUp, DollarSign, Clock, AlertCircle, Search, User, Box, Network } from 'lucide-react'

// Real wallet context hook
const useWallet = () => {
  const [account, setAccount] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

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

  const connectWallet = async () => {
    setIsConnecting(true)
    try {
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts'
        })
        setAccount(accounts[0])
      } else {
        alert('MetaMask is not installed. Please install MetaMask to continue.')
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error)
      alert('Failed to connect wallet. Please try again.')
    } finally {
      setIsConnecting(false)
    }
  }

  return { account, connectWallet, isConnecting }
}

// Real data fetching hook with proper error handling
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

export default function HomePage() {
  const router = useRouter()
  const { account, connectWallet, isConnecting } = useWallet()
  const [contractAddress, setContractAddress] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const [previousBlockNumber, setPreviousBlockNumber] = useState<number | null>(null)

  // Fetch network info once and cache permanently
  const { data: networkInfo } = useQuery('networkInfo', async () => {
    const response = await fetch('/api/blockchain/status')
    if (!response.ok) {
      throw new Error('Failed to fetch network info')
    }
    const data = await response.json()
    return {
      network: data.network,
      chainId: data.chainId,
      connected: data.connected
    }
  }, {
    refetchInterval: undefined, // Cache permanently like the old version
  })

  // Fetch current block number every minute
  const { data: blockchainStatus } = useQuery('blockNumber', async () => {
    const response = await fetch('/api/blockchain/status')
    if (!response.ok) {
      throw new Error('Failed to fetch blockchain status')
    }
    return await response.json()
  }, {
    refetchInterval: 60000, // Every 60 seconds
  })

  // Get total volume directly from OptionsBook contract
  const { data: totalVolume } = useQuery('totalVolume', async () => {
    try {
      // Use the optimized endpoint that we created
      const response = await fetch('/api/factory/all-contracts')
      if (!response.ok) {
        throw new Error('Failed to fetch total volume')
      }
      const data = await response.json()
      
      console.log('📊 Total volume debug:', {
        responseData: data,
        totalVolumeRaw: data.totalVolume,
        totalVolumeType: typeof data.totalVolume
      })
      
      // Use direct total volume from OptionsBook contract (already in wei)
      const totalVolumeWei = data.totalVolume || '0'
      
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
  }, {
    refetchInterval: 60000, // Update every 60 seconds
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
      router.push(`/option/${contractAddress.trim()}`)
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
            Trade Derivatives{" "}
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient">
              Decentralized
            </span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            Blockchain Layer-3 Protocol for Decentralized Derivatives Exchange
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Card className="hover:translate-y-[-5px] transition-transform duration-300">
            <CardContent className="flex flex-col items-center p-6">
              <Box className="h-8 w-8 mb-4 text-primary" />
              <div className={`text-3xl font-bold mb-2 ${isUpdating ? 'text-primary' : ''} transition-colors duration-300`}>
                {blockchainStatus?.blockNumber || '...'}
              </div>
              <p className="text-sm text-muted-foreground">Current Block</p>
            </CardContent>
          </Card>

          <Card className="hover:translate-y-[-5px] transition-transform duration-300">
            <CardContent className="flex flex-col items-center p-6">
              <DollarSign className="h-8 w-8 mb-4 text-primary" />
              <div className="text-3xl font-bold mb-2">
                {totalVolume || 'Loading...'} MTK
              </div>
              <p className="text-sm text-muted-foreground">Total Volume</p>
            </CardContent>
          </Card>

          <Card className="hover:translate-y-[-5px] transition-transform duration-300">
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
            onClick={() => router.push('/market')}
          >
            <TrendingUp className="h-5 w-5" />
            Browse Options
          </Button>
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => router.push('/create')}
          >
            <DollarSign className="h-5 w-5" />
            Draft Contract
          </Button>
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => router.push('/my-options')}
          >
            <Clock className="h-5 w-5" />
            Futures Book
          </Button>
          <Button
            variant="outline"
            className="h-16 flex items-center justify-center gap-2"
            onClick={() => router.push('/my-options')}
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
