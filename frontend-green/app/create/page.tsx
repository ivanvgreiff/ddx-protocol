"use client"

import { useState } from "react"
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Separator } from "@/components/ui/separator"
import { Navigation } from "@/components/navigation"
import { useWallet } from "@/contexts/WalletContext"
import { ArrowLeft, TrendingUp, TrendingDown, Calculator, Calendar, DollarSign, Info, CheckCircle, AlertTriangle, Copy } from "lucide-react"
import { toast } from "sonner"
import { ethers } from 'ethers'
import axios from 'axios'
import Link from "next/link"

interface ContractDeploymentInfo {
  txHash: string
  contractAddress: string
}

export default function CreateOption() {
  const router = useRouter()
  const { account, sendTransaction } = useWallet()
  const [step, setStep] = useState(1)
  const [isCreating, setIsCreating] = useState(false)
  const [contractDeploymentInfo, setContractDeploymentInfo] = useState<ContractDeploymentInfo | null>(null)
  const [formData, setFormData] = useState({
    optionType: "",
    underlyingToken: "",
    strikeToken: "",
    underlyingSymbol: "",
    strikeSymbol: "",
    strikePrice: "",
    optionSize: "",
    premium: "",
    oracle: "",
    payoffType: "",
    description: "",
  })

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const nextStep = () => {
    if (step < 4) setStep(step + 1)
  }

  const prevStep = () => {
    if (step > 1) setStep(step - 1)
  }

  const isStepComplete = (stepNumber: number) => {
    switch (stepNumber) {
      case 1:
        return formData.optionType && formData.underlyingToken && formData.strikeToken
      case 2:
        return formData.strikePrice && formData.optionSize && formData.payoffType
      case 3:
        return formData.premium && formData.oracle && formData.underlyingSymbol && formData.strikeSymbol
      case 4:
        return true
      default:
        return false
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard!')
    }).catch(() => {
      toast.error('Failed to copy')
    })
  }

  const handleSubmit = async () => {
    if (!account) {
      toast.error('Please connect your wallet first')
      return
    }

    setIsCreating(true)
    
    // Show initial loading message
    toast.loading('Preparing transactions...')
    
    try {
      // Step 1: Get transaction data from backend
      const requestData = {
        ...formData,
        userAddress: account,
        payoffType: formData.payoffType
      }
      const endpoint = formData.optionType === 'call' ? '/api/option/create-call' : '/api/option/create-put'
      const response = await axios.post(endpoint, requestData)
      
      // Check if backend detected transaction would fail
      if (!response.data.success) {
        const errorMsg = response.data.details || response.data.error || 'Unknown error'
        toast.dismiss()
        toast.error(`Contract Error: ${errorMsg}`)
        return
      }
      
      if (response.data.success && response.data.data) {
        const { approveTransaction, createTransaction, tokenToApprove, amountToApprove, optionsBookAddress } = response.data.data
        
        // Step 2: Check current allowance
        toast.dismiss()
        toast.loading('Checking token allowance...')
        
        const provider = new ethers.BrowserProvider(window.ethereum)
        const tokenContract = new ethers.Contract(
          tokenToApprove,
          ['function allowance(address owner, address spender) view returns (uint256)'],
          provider
        )
        
        const currentAllowance = await tokenContract.allowance(account, optionsBookAddress)
        const requiredAmount = ethers.getBigInt(amountToApprove)
        
        console.log('Current allowance:', ethers.formatUnits(currentAllowance, 18))
        console.log('Required amount:', ethers.formatUnits(requiredAmount, 18))
        
        // Step 3: Send separate approval transaction if needed
        if (currentAllowance < requiredAmount) {
          toast.dismiss()
          toast.loading('Please approve token spending... (Transaction 1/2)')
          
          console.log('Sending approval transaction:', approveTransaction)
          const approveTx = await sendTransaction(approveTransaction)
          
          if (approveTx) {
            toast.loading('Waiting for approval confirmation... (Transaction 1/2)')
            await approveTx.wait()
            toast.success('✅ Token approval confirmed!')
          } else {
            throw new Error('Approval transaction failed')
          }
        } else {
          toast.success('✅ Token already approved!')
        }
        
        // Step 4: Send separate option creation transaction
        toast.loading('Please confirm option creation... (Transaction 2/2)')
        
        console.log('Sending option creation transaction:', createTransaction)
        
        const tx = await sendTransaction(createTransaction)
        
        if (tx) {
          toast.loading('Waiting for option creation confirmation...')
          
          // Wait for confirmation
          const receipt = await tx.wait()
          const deployTxHash = tx.hash
          
          toast.success('Option created successfully!')
          
          // Extract contract address from the transaction logs
          let contractAddress = null
          try {
            console.log('Extracting contract address from transaction receipt...')
            
            // Look for OptionCreated event in the logs
            const optionCreatedLog = receipt.logs.find((log: any) => {
              // OptionsBook OptionCreated event has 3 topics: event signature, creator, instance
              return log.topics && log.topics.length === 3
            })
            
            if (optionCreatedLog) {
              // The contract address is the second indexed parameter (topics[2])
              contractAddress = ethers.getAddress('0x' + optionCreatedLog.topics[2].slice(26))
              console.log('✅ Extracted contract address from logs:', contractAddress)
            }
          } catch (error) {
            console.warn('Failed to extract contract address from logs:', error)
          }
          
          // Auto-register the contract in the database
          if (contractAddress && ethers.isAddress(contractAddress)) {
            try {
              console.log('Auto-registering contract in database...')
              await axios.post('/api/contracts/auto-register', {
                transactionHash: deployTxHash,
                contractAddress: contractAddress,
                optionType: formData.optionType,
                shortAddress: account,
                underlyingToken: formData.underlyingToken,
                strikeToken: formData.strikeToken,
                underlyingSymbol: formData.underlyingSymbol,
                strikeSymbol: formData.strikeSymbol,
                strikePrice: formData.strikePrice,
                optionSize: formData.optionSize,
                premium: formData.premium,
                oracle: formData.oracle
              })
              console.log('✅ Contract auto-registered successfully')
            } catch (error) {
              console.warn('Failed to auto-register contract:', error)
            }
          }
          
          // Fallback: use transaction hash if we can't get the contract address
          if (!contractAddress) {
            contractAddress = `Transaction: ${deployTxHash.substring(0, 10)}...`
          }
          
        toast.success(`${formData.optionType === 'call' ? 'Call' : 'Put'} option contract deployed at: ${contractAddress}`)
        console.log('Deploy transaction hash:', deployTxHash)
        console.log('Contract address:', contractAddress)
        
        // Show success message
        setContractDeploymentInfo({
          txHash: deployTxHash,
          contractAddress: contractAddress
        })
        
        // Reset form
        setFormData({
          optionType: "",
          underlyingToken: "",
          strikeToken: "",
          underlyingSymbol: "",
          strikeSymbol: "",
          strikePrice: "",
          optionSize: "",
          premium: "",
          oracle: "",
          payoffType: "",
          description: "",
        })
        }
      }
    } catch (error: any) {
      console.error('Error creating option:', error)
      
      // Dismiss any loading toasts
      toast.dismiss()
      
      // Handle specific error types
      let errorMessage = 'Failed to create option contract'
      
      if (error.code === 4001) {
        errorMessage = 'Transaction cancelled by user'
      } else if (error.message && error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient ETH for gas fees'
      } else if (error.message && error.message.includes('missing revert data')) {
        errorMessage = `Transaction failed - likely insufficient tokens. For ${formData.optionType} options, you need ${formData.optionSize} ${formData.optionType === 'call' ? formData.underlyingSymbol : formData.strikeSymbol} tokens in your wallet.`
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.message) {
        errorMessage = error.message
      }
      
      toast.error(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  if (!account) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto px-6 py-8">
          <div className="flex items-center gap-4 mb-8">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold">Create Option Contract</h1>
            </div>
          </div>
          
          <Card className="bg-card border-border max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-primary" />
              <CardTitle className="text-2xl">Connect Your Wallet</CardTitle>
              <CardDescription>
                Please connect your wallet to create options
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="container mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Create Option Contract</h1>
            <p className="text-muted-foreground">Design your custom derivatives contract with modular payoff logic</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Progress Steps */}
          <div className="lg:col-span-1">
            <Card className="bg-card border-border sticky top-24">
              <CardHeader>
                <CardTitle className="text-lg">Creation Steps</CardTitle>
                <CardDescription>Follow these steps to create your option contract</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { number: 1, title: "Basic Setup", description: "Option type and underlying asset" },
                  { number: 2, title: "Contract Terms", description: "Strike price, expiry, and payoff" },
                  { number: 3, title: "Pricing & Collateral", description: "Premium and collateral requirements" },
                  { number: 4, title: "Review & Deploy", description: "Final review and deployment" },
                ].map((stepItem) => (
                  <div key={stepItem.number} className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                        step === stepItem.number
                          ? "bg-primary text-primary-foreground"
                          : isStepComplete(stepItem.number)
                            ? "bg-chart-1 text-white"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isStepComplete(stepItem.number) && step > stepItem.number ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        stepItem.number
                      )}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{stepItem.title}</h4>
                      <p className="text-sm text-muted-foreground">{stepItem.description}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Main Form */}
          <div className="lg:col-span-2">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Step {step} of 4{step === 1 && <TrendingUp className="w-5 h-5 text-primary" />}
                  {step === 2 && <Calculator className="w-5 h-5 text-primary" />}
                  {step === 3 && <DollarSign className="w-5 h-5 text-primary" />}
                  {step === 4 && <CheckCircle className="w-5 h-5 text-primary" />}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Step 1: Basic Setup */}
                {step === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Basic Option Setup</h3>
                      <p className="text-muted-foreground mb-6">
                        Choose the fundamental parameters for your option contract
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label className="text-base font-medium">Option Type</Label>
                        <p className="text-sm text-muted-foreground mb-3">
                          Select whether this is a call or put option
                        </p>
                        <RadioGroup
                          value={formData.optionType}
                          onValueChange={(value) => handleInputChange("optionType", value)}
                          className="grid grid-cols-2 gap-4"
                        >
                          <div className="flex items-center space-x-2 border border-border rounded-lg p-4 hover:bg-accent/50">
                            <RadioGroupItem value="call" id="call" />
                            <Label htmlFor="call" className="flex items-center gap-2 cursor-pointer">
                              <TrendingUp className="w-4 h-4 text-chart-1" />
                              <div>
                                <div className="font-medium">Call Option</div>
                                <div className="text-xs text-muted-foreground">Long can buy 2TK at strike price using MTK</div>
                              </div>
                            </Label>
                          </div>
                          <div className="flex items-center space-x-2 border border-border rounded-lg p-4 hover:bg-accent/50">
                            <RadioGroupItem value="put" id="put" />
                            <Label htmlFor="put" className="flex items-center gap-2 cursor-pointer">
                              <TrendingDown className="w-4 h-4 text-chart-2" />
                              <div>
                                <div className="font-medium">Put Option</div>
                                <div className="text-xs text-muted-foreground">Long can sell 2TK at strike price for MTK</div>
                              </div>
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="underlyingToken" className="text-base font-medium">
                            Underlying Token Address
                          </Label>
                          <p className="text-sm text-muted-foreground mb-3">
                            The token contract address (e.g., 2TK)
                          </p>
                          <Input
                            id="underlyingToken"
                            type="text"
                            value={formData.underlyingToken}
                            onChange={(e) => handleInputChange("underlyingToken", e.target.value)}
                            placeholder="0x..."
                            className="font-mono"
                          />
                        </div>

                        <div>
                          <Label htmlFor="strikeToken" className="text-base font-medium">
                            Strike Token Address
                          </Label>
                          <p className="text-sm text-muted-foreground mb-3">
                            The strike price token contract address (e.g., MTK)
                          </p>
                          <Input
                            id="strikeToken"
                            type="text"
                            value={formData.strikeToken}
                            onChange={(e) => handleInputChange("strikeToken", e.target.value)}
                            placeholder="0x..."
                            className="font-mono"
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="description" className="text-base font-medium">
                          Contract Description
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">
                          Optional description for your contract (visible to traders)
                        </p>
                        <Textarea
                          id="description"
                          placeholder="Describe your option contract strategy..."
                          value={formData.description}
                          onChange={(e) => handleInputChange("description", e.target.value)}
                          className="min-h-[100px]"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Contract Terms */}
                {step === 2 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Contract Terms</h3>
                      <p className="text-muted-foreground mb-6">
                        Define the strike price, expiration, and payoff structure
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="strike" className="text-base font-medium">
                          Strike Price (in MTK per 2TK)
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">
                          The price at which the option can be exercised
                        </p>
                        <Input
                          id="strike"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="1.5"
                          value={formData.strikePrice}
                          onChange={(e) => handleInputChange("strikePrice", e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="optionSize" className="text-base font-medium">
                          Option Size (amount of 2TK tokens)
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">Number of underlying tokens in the contract</p>
                        <Input
                          id="optionSize"
                          type="number"
                          min="0"
                          placeholder="100"
                          value={formData.optionSize}
                          onChange={(e) => handleInputChange("optionSize", e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-base font-medium">Payoff Structure</Label>
                      <p className="text-sm text-muted-foreground mb-3">Choose how the option payoff is calculated</p>
                      <RadioGroup
                        value={formData.payoffType}
                        onValueChange={(value) => handleInputChange("payoffType", value)}
                        className="space-y-3"
                      >
                        <div className="flex items-center space-x-2 border border-border rounded-lg p-4 hover:bg-accent/50">
                          <RadioGroupItem value="Linear" id="linear" />
                          <Label htmlFor="linear" className="flex-1 cursor-pointer">
                            <div className="font-medium">Linear Payoff</div>
                            <div className="text-sm text-muted-foreground">
                              Standard option payoff: max(S-K, 0) for calls, max(K-S, 0) for puts
                            </div>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2 border border-border rounded-lg p-4 hover:bg-accent/50">
                          <RadioGroupItem value="Quadratic" id="quadratic" />
                          <Label htmlFor="quadratic" className="flex-1 cursor-pointer">
                            <div className="font-medium">Quadratic Payoff</div>
                            <div className="text-sm text-muted-foreground">
                              Accelerated gains: payoff increases quadratically with favorable price movements
                            </div>
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2 border border-border rounded-lg p-4 hover:bg-accent/50">
                          <RadioGroupItem value="Logarithmic" id="logarithmic" />
                          <Label htmlFor="logarithmic" className="flex-1 cursor-pointer">
                            <div className="font-medium">Logarithmic Payoff</div>
                            <div className="text-sm text-muted-foreground">
                              Diminishing returns: payoff increases logarithmically, reducing extreme outcomes
                            </div>
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                )}

                {/* Step 3: Pricing & Collateral */}
                {step === 3 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Pricing & Collateral</h3>
                      <p className="text-muted-foreground mb-6">Set the premium price and collateral requirements</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="premium" className="text-base font-medium">
                          Premium (amount of MTK tokens)
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">Premium buyers pay to purchase this option</p>
                        <Input
                          id="premium"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="50"
                          value={formData.premium}
                          onChange={(e) => handleInputChange("premium", e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="oracle" className="text-base font-medium">
                          Oracle Address
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">Smart contract that provides price data</p>
                        <Input
                          id="oracle"
                          type="text"
                          placeholder="0x..."
                          value={formData.oracle}
                          onChange={(e) => handleInputChange("oracle", e.target.value)}
                          className="font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="underlyingSymbol" className="text-base font-medium">
                          Underlying Symbol
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">Symbol for the underlying token</p>
                        <Input
                          id="underlyingSymbol"
                          type="text"
                          placeholder="2TK"
                          value={formData.underlyingSymbol}
                          onChange={(e) => handleInputChange("underlyingSymbol", e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="strikeSymbol" className="text-base font-medium">
                          Strike Symbol
                        </Label>
                        <p className="text-sm text-muted-foreground mb-3">Symbol for the strike token</p>
                        <Input
                          id="strikeSymbol"
                          type="text"
                          placeholder="MTK"
                          value={formData.strikeSymbol}
                          onChange={(e) => handleInputChange("strikeSymbol", e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="bg-muted/50 border border-border rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Info className="w-5 h-5 text-primary mt-0.5" />
                        <div>
                          <h4 className="font-medium mb-1">Two-Transaction Process</h4>
                          <p className="text-sm text-muted-foreground">
                            First you'll approve token spending, then create the option contract. You'll see 2 separate MetaMask popups.
                            You need {formData.optionSize || 'X'} {formData.optionType === 'call' ? formData.underlyingSymbol || '2TK' : formData.strikeSymbol || 'MTK'} tokens in your wallet.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Review & Deploy */}
                {step === 4 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Review & Deploy</h3>
                      <p className="text-muted-foreground mb-6">Review your contract details before deployment</p>
                    </div>

                    <div className="space-y-6">
                      <Card className="bg-muted/50 border-border">
                        <CardHeader>
                          <CardTitle className="text-lg">Contract Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label className="text-sm text-muted-foreground">Option Type</Label>
                              <div className="flex items-center gap-2 mt-1">
                                {formData.optionType === "call" ? (
                                  <TrendingUp className="w-4 h-4 text-chart-1" />
                                ) : (
                                  <TrendingDown className="w-4 h-4 text-chart-2" />
                                )}
                                <Badge variant={formData.optionType === "call" ? "default" : "secondary"}>
                                  {formData.optionType?.toUpperCase()}
                                </Badge>
                              </div>
                            </div>
                            <div>
                              <Label className="text-sm text-muted-foreground">Underlying Token</Label>
                              <p className="font-medium mt-1 font-mono text-xs">{formData.underlyingToken || 'Not specified'}</p>
                            </div>
                            <div>
                              <Label className="text-sm text-muted-foreground">Strike Price</Label>
                              <p className="font-medium mt-1">${formData.strikePrice}</p>
                            </div>
                            <div>
                              <Label className="text-sm text-muted-foreground">Expiration</Label>
                              <p className="font-medium mt-1">{formData.expirationDate}</p>
                            </div>
                            <div>
                              <Label className="text-sm text-muted-foreground">Payoff Type</Label>
                              <Badge variant="outline" className="mt-1">
                                {formData.payoffType?.charAt(0).toUpperCase() + formData.payoffType?.slice(1)}
                              </Badge>
                            </div>
                            <div>
                              <Label className="text-sm text-muted-foreground">Premium</Label>
                              <p className="font-medium mt-1">{formData.premium} ETH</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <Info className="w-5 h-5 text-destructive mt-0.5" />
                          <div>
                            <h4 className="font-medium text-destructive mb-1">Important Notice</h4>
                            <p className="text-sm text-destructive/80">
                              Once deployed, this contract cannot be modified. Please review all parameters carefully.
                              Your collateral of {formData.collateral} ETH will be locked until expiration.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Navigation Buttons */}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={prevStep} disabled={step === 1}>
                    Previous
                  </Button>
                  <div className="flex gap-2">
                    {step < 4 ? (
                      <Button
                        onClick={nextStep}
                        disabled={!isStepComplete(step)}
                        className="bg-primary hover:bg-primary/90"
                      >
                        Next Step
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleSubmit}
                        disabled={isCreating}
                        className="bg-primary hover:bg-primary/90"
                      >
                        {isCreating ? 'Processing...' : `Deploy ${formData.optionType === 'call' ? 'Call' : 'Put'} Option (2 Transactions)`}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Success Message */}
        {contractDeploymentInfo && (
          <Card className="bg-card border-border mt-8">
            <CardHeader className="text-center">
              <CardTitle className="text-xl text-primary">
                ✅ {formData.optionType === 'call' ? 'Call' : 'Put'} Option Contract Created Successfully!
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm text-muted-foreground">Transaction Hash</Label>
                    <p className="font-mono text-sm break-all">{contractDeploymentInfo.txHash}</p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => copyToClipboard(contractDeploymentInfo.txHash)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="bg-muted/50 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm text-muted-foreground">Contract Address</Label>
                    <p className="font-mono text-sm break-all">{contractDeploymentInfo.contractAddress}</p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => copyToClipboard(contractDeploymentInfo.contractAddress)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="text-center">
                <p className="text-sm text-muted-foreground mb-4">
                  You can now fund the contract (as the short seller) and have someone enter as long position
                </p>
                <Button 
                  onClick={() => router.push(`/option/${contractDeploymentInfo.contractAddress}`)}
                  className="bg-primary hover:bg-primary/90"
                >
                  View Contract Details
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
