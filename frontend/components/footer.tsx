import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Github, Twitter, MessageCircle } from "lucide-react"

export function Footer() {
  return (
    <footer className="bg-card border-t border-border">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <h3 className="text-lg font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              DerivX
            </h3>
            <p className="text-sm text-muted-foreground">
              The most advanced decentralized derivatives trading platform. Trade with confidence, security, and
              complete control.
            </p>
            <div className="flex space-x-4">
              <Button variant="ghost" size="sm">
                <Twitter className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <Github className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <MessageCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Products</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Perpetual Futures
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Options
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Synthetic Assets
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Liquidity Pools
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Resources</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Documentation
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  API Reference
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Security Audits
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-primary transition-colors">
                  Bug Bounty
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Stay Updated</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Get the latest updates on new features and market insights.
            </p>
            <div className="flex space-x-2">
              <Input placeholder="Enter your email" className="flex-1" />
              <Button size="sm">Subscribe</Button>
            </div>
          </div>
        </div>

        <div className="border-t border-border mt-8 pt-8 text-center text-sm text-muted-foreground">
          <p>&copy; 2024 DerivX. All rights reserved. Built on decentralized infrastructure.</p>
        </div>
      </div>
    </footer>
  )
}
