import { Button } from "@/components/ui/button"
import { ArrowRight, Shield, Zap, TrendingUp } from "lucide-react"

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-background via-background to-muted py-20 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Trade Derivatives{" "}
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              Decentralized
            </span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground max-w-2xl mx-auto">
            Access perpetual futures, options, and synthetic assets on the most advanced decentralized derivatives
            platform. Trade with zero slippage and maximum capital efficiency.
          </p>
          <div className="mt-10 flex items-center justify-center gap-x-6">
            <Button
              size="lg"
              className="bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90"
            >
              Start Trading
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" size="lg">
              View Documentation
            </Button>
          </div>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-primary/10 p-3 mb-4">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Fully Decentralized</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Non-custodial trading with complete control over your assets
            </p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-accent/10 p-3 mb-4">
              <Zap className="h-6 w-6 text-accent" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Lightning Fast</h3>
            <p className="text-sm text-muted-foreground mt-2">Sub-second execution with optimistic rollup technology</p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="rounded-full bg-primary/10 p-3 mb-4">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Deep Liquidity</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Access to global liquidity pools and institutional market makers
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
