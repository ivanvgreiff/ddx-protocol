import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, Zap, BarChart3, Users, Lock, Coins } from "lucide-react"

const features = [
  {
    icon: Shield,
    title: "Non-Custodial Security",
    description:
      "Your funds remain in your wallet at all times. Trade with complete peace of mind knowing you maintain full control.",
  },
  {
    icon: Zap,
    title: "Lightning Fast Execution",
    description: "Sub-second order execution powered by optimistic rollups and advanced matching algorithms.",
  },
  {
    icon: BarChart3,
    title: "Advanced Analytics",
    description:
      "Professional-grade charting tools, market data, and portfolio analytics for informed trading decisions.",
  },
  {
    icon: Users,
    title: "Community Governance",
    description: "Participate in protocol governance and help shape the future of decentralized derivatives trading.",
  },
  {
    icon: Lock,
    title: "Audited Smart Contracts",
    description: "All smart contracts are thoroughly audited by leading security firms to ensure maximum safety.",
  },
  {
    icon: Coins,
    title: "Multi-Asset Support",
    description: "Trade derivatives on crypto, commodities, forex, and synthetic assets all in one platform.",
  },
]

export function FeaturesSection() {
  return (
    <section className="py-16 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">Why Choose DerivX</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Built for traders, by traders. Experience the next generation of derivatives trading with cutting-edge
            technology and uncompromising security.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="rounded-full bg-primary/10 p-3 w-fit mb-4">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
