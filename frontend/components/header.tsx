"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Menu, X, Wallet } from "lucide-react"

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <a href="/">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent hover:opacity-80 transition-opacity cursor-pointer">
                  DerivX
                </h1>
              </a>
            </div>
            <nav className="hidden md:ml-10 md:flex md:space-x-8">
              <a href="/" className="text-foreground hover:text-primary transition-colors">
                Dashboard
              </a>
              <a href="/market" className="text-foreground hover:text-primary transition-colors">
                Options Book
              </a>
              <a href="/create" className="text-foreground hover:text-primary transition-colors">
                Create Option
              </a>
              <a href="/my-options" className="text-foreground hover:text-primary transition-colors">
                Futures Book
              </a>
            </nav>
          </div>

          <div className="hidden md:flex md:items-center md:space-x-4">
            <Button variant="outline" size="sm">
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </Button>
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
              <a href="/" className="block px-3 py-2 text-foreground hover:text-primary">
                Dashboard
              </a>
              <a href="/market" className="block px-3 py-2 text-foreground hover:text-primary">
                Options Book
              </a>
              <a href="/create" className="block px-3 py-2 text-foreground hover:text-primary">
                Create Option
              </a>
              <a href="/my-options" className="block px-3 py-2 text-foreground hover:text-primary">
                Futures Book
              </a>
              <div className="px-3 py-2">
                <Button variant="outline" size="sm" className="w-full bg-transparent">
                  <Wallet className="mr-2 h-4 w-4" />
                  Connect Wallet
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
