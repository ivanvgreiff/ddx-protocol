"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface WalletContextType {
  account: string | null
  isConnecting: boolean
  connectWallet: () => Promise<void>
  disconnectWallet: () => void
  sendTransaction: (txData: any) => Promise<any>
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
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

    // Set up MetaMask event listeners
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          // User disconnected their wallet
          setAccount(null)
        } else {
          // User switched accounts or connected
          setAccount(accounts[0])
        }
      }

      const handleChainChanged = (chainId: string) => {
        // Reload page when chain changes to ensure proper state
        window.location.reload()
      }

      // Add event listeners
      ;(window as any).ethereum.on('accountsChanged', handleAccountsChanged)
      ;(window as any).ethereum.on('chainChanged', handleChainChanged)

      // Cleanup function
      return () => {
        ;(window as any).ethereum.removeListener('accountsChanged', handleAccountsChanged)
        ;(window as any).ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, []) // Remove account dependency to prevent reconnection loops

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
    // Note: MetaMask doesn't have a true "disconnect" method
    // We just clear our local state and rely on the accountsChanged event
    // to handle any external wallet state changes
  }

  const sendTransaction = async (txData: any) => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const txHash = await (window as any).ethereum.request({
          method: 'eth_sendTransaction',
          params: [txData],
        })
        
        // Return a transaction object with wait method
        return {
          hash: txHash,
          wait: async () => {
            // Simple wait implementation - in production you'd want proper receipt checking
            return new Promise(resolve => setTimeout(resolve, 2000))
          }
        }
      } catch (error) {
        console.error('Transaction failed:', error)
        throw error
      }
    }
    throw new Error('MetaMask not available')
  }

  const value = {
    account,
    isConnecting,
    connectWallet,
    disconnectWallet,
    sendTransaction,
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}
