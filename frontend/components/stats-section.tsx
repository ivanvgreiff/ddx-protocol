import { Card, CardContent } from "@/components/ui/card"

const stats = [
  { label: "Total Volume", value: "$12.4B", change: "+15.2%" },
  { label: "Open Interest", value: "$2.8B", change: "+8.7%" },
  { label: "Active Traders", value: "45.2K", change: "+12.1%" },
  { label: "Total Value Locked", value: "$890M", change: "+5.4%" },
]

export function StatsSection() {
  return (
    <section className="py-16 bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">Platform Statistics</h2>
          <p className="text-muted-foreground">Real-time metrics showcasing the growth and adoption of our platform</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((stat, index) => (
            <Card key={index} className="text-center">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-foreground mb-2">{stat.value}</div>
                <div className="text-sm text-muted-foreground mb-2">{stat.label}</div>
                <div className="text-sm text-green-600 font-medium">{stat.change}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
