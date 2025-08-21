'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { ethers } from 'ethers'
import { toast } from 'sonner'

interface WalletContextType {
  account: string | null
  provider: ethers.BrowserProvider | null
  signer: ethers.JsonRpcSigner | null
  isConnecting: boolean
  chainId: bigint | null
  isMetaMaskInstalled: () => boolean
  connectWallet: () => Promise<boolean>
  disconnectWallet: () => void
  switchNetwork: (targetChainId: number) => Promise<boolean>
  sendTransaction: (transactionData: any) => Promise<ethers.TransactionResponse | null>
  signMessage: (message: string) => Promise<string | null>
}

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export const useWallet = () => {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [chainId, setChainId] = useState<bigint | null>(null)

  // Check if MetaMask is installed
  const isMetaMaskInstalled = () => {
    return typeof window !== 'undefined' && window.ethereum
  }

  // Connect to MetaMask
  const connectWallet = async (): Promise<boolean> => {
    if (!isMetaMaskInstalled()) {
      toast.error('MetaMask is not installed. Please install MetaMask first.')
      return false
    }

    setIsConnecting(true)
    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      })

      if (accounts.length > 0) {
        const provider = new ethers.BrowserProvider(window.ethereum)
        // Disable ENS resolution
        provider.getResolver = async () => null
        const signer = await provider.getSigner()
        const network = await provider.getNetwork()

        setAccount(accounts[0])
        setProvider(provider)
        setSigner(signer)
        setChainId(network.chainId)

        toast.success('Wallet connected successfully!')
        return true
      }
    } catch (error) {
      console.error('Error connecting wallet:', error)
      toast.error('Failed to connect wallet. Please try again.')
      return false
    } finally {
      setIsConnecting(false)
    }
    return false
  }

  // Disconnect wallet
  const disconnectWallet = () => {
    setAccount(null)
    setProvider(null)
    setSigner(null)
    setChainId(null)
    toast.success('Wallet disconnected')
  }

  // Switch network
  const switchNetwork = async (targetChainId: number): Promise<boolean> => {
    if (!isMetaMaskInstalled()) {
      toast.error('MetaMask is not installed')
      return false
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      })
      toast.success('Network switched successfully')
      return true
    } catch (error) {
      console.error('Error switching network:', error)
      toast.error('Failed to switch network')
      return false
    }
  }

  // Send transaction
  const sendTransaction = async (transactionData: any): Promise<ethers.TransactionResponse | null> => {
    if (!signer) {
      toast.error('Please connect your wallet first')
      return null
    }

    try {
      const tx = await signer.sendTransaction(transactionData)
      toast.success('Transaction sent! Waiting for confirmation...')
      return tx
    } catch (error: any) {
      console.error('Transaction error:', error)
      toast.error('Transaction failed: ' + error.message)
      return null
    }
  }

  // Sign message
  const signMessage = async (message: string): Promise<string | null> => {
    if (!signer) {
      toast.error('Please connect your wallet first')
      return null
    }

    try {
      const signature = await signer.signMessage(message)
      toast.success('Message signed successfully')
      return signature
    } catch (error: any) {
      console.error('Signing error:', error)
      toast.error('Failed to sign message')
      return null
    }
  }

  // Listen for account changes
  useEffect(() => {
    if (isMetaMaskInstalled()) {
      const handleAccountsChanged = (accounts: string[]) => {
        if (accounts.length === 0) {
          // User disconnected their wallet
          disconnectWallet()
        } else if (account !== accounts[0]) {
          // User switched accounts
          setAccount(accounts[0])
          toast.success('Account changed')
        }
      }

      const handleChainChanged = (chainId: string) => {
        setChainId(BigInt(parseInt(chainId, 16)))
        toast.success('Network changed')
      }

      window.ethereum.on('accountsChanged', handleAccountsChanged)
      window.ethereum.on('chainChanged', handleChainChanged)

      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
        window.ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [account])

  // Auto-connect if previously connected
  useEffect(() => {
    const checkConnection = async () => {
      if (isMetaMaskInstalled() && window.ethereum.selectedAddress) {
        await connectWallet()
      }
    }

    checkConnection()
  }, [])

  const value: WalletContextType = {
    account,
    provider,
    signer,
    isConnecting,
    chainId,
    isMetaMaskInstalled,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    sendTransaction,
    signMessage,
  }

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  )
}

// Add type declaration for window.ethereum
declare global {
  interface Window {
    ethereum: any
  }
}