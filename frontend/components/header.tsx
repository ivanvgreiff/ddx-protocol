"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Menu, X, Wallet } from "lucide-react"

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
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

  const disconnectWallet = () => {
    setAccount(null)
  }

  const formatAddress = (address: string) => {
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <a href="/">
                <h1 className="text-4xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent animate-gradient-strong hover:opacity-80 transition-opacity cursor-pointer">
                  DDX
                </h1>
              </a>
            </div>
            <nav className="hidden md:ml-10 md:flex md:space-x-8">
              <a href="/market" className="text-foreground hover:text-primary transition-colors">
                Options Book
              </a>
              <a href="/my-options" className="text-foreground hover:text-primary transition-colors">
                My Options
              </a>
              <a href="/create" className="text-foreground hover:text-primary transition-colors">
                Draft Contract
              </a>
            </nav>
          </div>

          <div className="hidden md:flex md:items-center md:space-x-4">
            {account ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="neon-button" onClick={disconnectWallet}>
                  <Wallet className="mr-2 h-4 w-4" />
                  {formatAddress(account)}
                </Button>
              </div>
            ) : (
              <Button 
                variant="outline" 
                size="sm"
                className="neon-button"
                onClick={connectWallet}
                disabled={isConnecting}
              >
                <Wallet className="mr-2 h-4 w-4" />
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </Button>
            )}
          </div>

          <div className="md:hidden">
            <Button variant="ghost" size="sm" onClick={() => setIsMenuOpen(!isMenuOpen)}>
              {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>
          </div>
        </div>

        {isMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
              <a href="/market" className="block px-3 py-2 text-foreground hover:text-primary">
                Options Book
              </a>
              <a href="/my-options" className="block px-3 py-2 text-foreground hover:text-primary">
                My Options
              </a>
              <a href="/create" className="block px-3 py-2 text-foreground hover:text-primary">
                Draft Contract
              </a>
              <div className="px-3 py-2">
                {account ? (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full bg-transparent neon-button"
                    onClick={disconnectWallet}
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    {formatAddress(account)}
                  </Button>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full bg-transparent neon-button"
                    onClick={connectWallet}
                    disabled={isConnecting}
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
