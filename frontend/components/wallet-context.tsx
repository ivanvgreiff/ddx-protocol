"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { ethers } from 'ethers'

interface WalletContextType {
  account: string | null
  provider: ethers.BrowserProvider | null
  signer: ethers.Signer | null
  isConnecting: boolean
  chainId: bigint | null
  isMetaMaskInstalled: () => boolean
  connectWallet: () => Promise<boolean>
  disconnectWallet: () => void
  switchNetwork: (targetChainId: number) => Promise<boolean>
  sendTransaction: (transactionData: any) => Promise<any>
  signMessage: (message: string) => Promise<string | null>
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

// Simple toast replacement - you can replace this with your preferred toast library
const toast = {
  success: (message: string) => {
    console.log('✅', message)
  },
  error: (message: string) => {
    console.error('❌', message)
  }
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [account, setAccount] = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer, setSigner] = useState<ethers.Signer | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [chainId, setChainId] = useState<bigint | null>(null)

  // Check if MetaMask is installed
  const isMetaMaskInstalled = () => {
    return typeof window !== 'undefined' && (window as any).ethereum
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
      const accounts = await (window as any).ethereum.request({
        method: 'eth_requestAccounts',
      })

      if (accounts.length > 0) {
        try {
          // Verify ethereum object exists and has the required methods
          if (!(window as any).ethereum || typeof (window as any).ethereum.request !== 'function') {
            throw new Error('Invalid ethereum provider')
          }

          console.log('Creating ethers BrowserProvider...')
          const provider = new ethers.BrowserProvider((window as any).ethereum)
          console.log('BrowserProvider created successfully')
          
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
        } catch (providerError: any) {
          console.error('Error creating provider:', providerError)
          console.error('Provider error details:', {
            message: providerError.message,
            stack: providerError.stack,
            ethereumExists: !!(window as any).ethereum,
            ethereumType: typeof (window as any).ethereum
          })
          
          // Fallback: still set account but without full provider functionality
          setAccount(accounts[0])
          setProvider(null)
          setSigner(null)
          setChainId(null)
          toast.success('Wallet connected (limited functionality - will use direct MetaMask calls)')
          return true
        }
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
      await (window as any).ethereum.request({
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
  const sendTransaction = async (transactionData: any) => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return null
    }

    console.log('sendTransaction called with:', { transactionData, hasSigner: !!signer, hasProvider: !!provider })

    try {
      // If we have a signer, use ethers.js
      if (signer) {
        console.log('Using ethers.js signer for transaction')
        const tx = await signer.sendTransaction(transactionData)
        toast.success('Transaction sent! Waiting for confirmation...')
        return tx
      }
      
      // Fallback to direct MetaMask interaction
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        console.log('Using direct MetaMask interaction for transaction')
        const txHash = await (window as any).ethereum.request({
          method: 'eth_sendTransaction',
          params: [transactionData],
        })
        
        toast.success('Transaction sent! Waiting for confirmation...')
        
        // Return a transaction object with wait method
        return {
          hash: txHash,
          wait: async () => {
            // Simple wait implementation - poll for receipt
            return new Promise((resolve) => {
              const pollForReceipt = async () => {
                try {
                  const receipt = await (window as any).ethereum.request({
                    method: 'eth_getTransactionReceipt',
                    params: [txHash],
                  })
                  if (receipt) {
                    resolve(receipt)
                  } else {
                    setTimeout(pollForReceipt, 2000)
                  }
                } catch {
                  setTimeout(pollForReceipt, 2000)
                }
              }
              pollForReceipt()
            })
          }
        }
      }
      
      throw new Error('No wallet connection available')
    } catch (error) {
      console.error('Transaction error:', error)
      toast.error('Transaction failed: ' + (error as any).message)
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
    } catch (error) {
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

      ;(window as any).ethereum.on('accountsChanged', handleAccountsChanged)
      ;(window as any).ethereum.on('chainChanged', handleChainChanged)

      return () => {
        ;(window as any).ethereum.removeListener('accountsChanged', handleAccountsChanged)
        ;(window as any).ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [account])

  // Auto-connect disabled - users must manually click to connect
  // useEffect(() => {
  //   const checkConnection = async () => {
  //     if (isMetaMaskInstalled()) {
  //       try {
  //         // Check if there are any connected accounts
  //         const accounts = await (window as any).ethereum.request({
  //           method: 'eth_accounts'
  //         })
  //         if (accounts.length > 0) {
  //           await connectWallet()
  //         }
  //       } catch (error) {
  //         console.error('Failed to check existing connection:', error)
  //       }
  //     }
  //   }

  //   checkConnection()
  // }, [])

  const value = {
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
