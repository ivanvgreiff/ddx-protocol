"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { BarChart3, Menu, Wallet, User } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useWallet } from "@/contexts/WalletContext"

const navigationItems = [
  { href: "/", label: "Dashboard" },
  { href: "/market", label: "Options Market" },
  { href: "/create", label: "Create Option" },
]

export function Navigation() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const { account, connectWallet, disconnectWallet, isConnecting } = useWallet()

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/"
    }
    return pathname.startsWith(href)
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold">DDX Protocol</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-6">
              {navigationItems.map((item) => (
                <Link key={item.href} href={item.href}>
                  <Button
                    variant="ghost"
                    className={cn(
                      "text-muted-foreground hover:text-primary transition-colors",
                      isActive(item.href) && "text-foreground bg-accent",
                    )}
                  >
                    {item.label}
                  </Button>
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {account ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2 bg-accent px-3 py-2 rounded-lg">
                  <User className="w-4 h-4" />
                  <span className="text-sm font-mono">{formatAddress(account)}</span>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={disconnectWallet}
                  className="text-xs"
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button 
                className="bg-primary hover:bg-primary/90" 
                onClick={connectWallet}
                disabled={isConnecting}
              >
                <Wallet className="w-4 h-4 mr-2" />
                {isConnecting ? 'Connecting...' : 'Connect Wallet'}
              </Button>
            )}

            {/* Mobile Navigation */}
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="sm">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px] sm:w-[400px]">
                <div className="flex flex-col gap-4 mt-8">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                      <BarChart3 className="w-5 h-5 text-primary-foreground" />
                    </div>
                    <span className="text-xl font-bold">DDX Protocol</span>
                  </div>

                  {/* Mobile Wallet Info */}
                  {account && (
                    <div className="mb-4 p-3 bg-accent rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-4 h-4" />
                        <span className="text-sm font-mono">{formatAddress(account)}</span>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={disconnectWallet}
                        className="w-full text-xs"
                      >
                        Disconnect Wallet
                      </Button>
                    </div>
                  )}

                  <nav className="flex flex-col gap-2">
                    {navigationItems.map((item) => (
                      <Link key={item.href} href={item.href} onClick={() => setIsOpen(false)}>
                        <Button
                          variant="ghost"
                          className={cn(
                            "w-full justify-start text-muted-foreground hover:text-primary transition-colors",
                            isActive(item.href) && "text-foreground bg-accent",
                          )}
                        >
                          {item.label}
                        </Button>
                      </Link>
                    ))}
                  </nav>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  )
}
