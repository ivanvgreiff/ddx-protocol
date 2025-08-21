"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TrendingUp, TrendingDown } from "lucide-react"

const tradingPairs = [
  { symbol: "BTC-PERP", price: "$67,234.50", change: "+2.34%", volume: "$1.2B", positive: true },
  { symbol: "ETH-PERP", price: "$3,456.78", change: "+1.87%", volume: "$890M", positive: true },
  { symbol: "SOL-PERP", price: "$156.23", change: "-0.45%", volume: "$234M", positive: false },
  { symbol: "AVAX-PERP", price: "$34.56", change: "+3.21%", volume: "$123M", positive: true },
]

export function TradingInterface() {
  const [selectedPair, setSelectedPair] = useState(tradingPairs[0])
  const [orderType, setOrderType] = useState("market")

  return (
    <section id="trade" className="py-16 bg-muted/30">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">Advanced Trading Interface</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Professional-grade tools for derivatives trading with real-time data and advanced order types
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Trading Pairs */}
          <Card>
            <CardHeader>
              <CardTitle>Markets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tradingPairs.map((pair) => (
                <div
                  key={pair.symbol}
                  className={`p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedPair.symbol === pair.symbol ? "bg-primary/10 border border-primary/20" : "hover:bg-muted"
                  }`}
                  onClick={() => setSelectedPair(pair)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium">{pair.symbol}</div>
                      <div className="text-sm text-muted-foreground">{pair.volume}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{pair.price}</div>
                      <div className={`text-sm flex items-center ${pair.positive ? "text-green-600" : "text-red-600"}`}>
                        {pair.positive ? (
                          <TrendingUp className="h-3 w-3 mr-1" />
                        ) : (
                          <TrendingDown className="h-3 w-3 mr-1" />
                        )}
                        {pair.change}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Chart Placeholder */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {selectedPair.symbol}
                <Badge variant={selectedPair.positive ? "default" : "destructive"}>{selectedPair.change}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 bg-gradient-to-br from-primary/5 to-accent/5 rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground mb-2">{selectedPair.price}</div>
                  <div className="text-muted-foreground">Chart visualization would appear here</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Form */}
          <Card>
            <CardHeader>
              <CardTitle>Place Order</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={orderType} onValueChange={setOrderType}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="market">Market</TabsTrigger>
                  <TabsTrigger value="limit">Limit</TabsTrigger>
                </TabsList>
                <TabsContent value="market" className="space-y-4 mt-4">
                  <div>
                    <label className="text-sm font-medium">Size</label>
                    <Input placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Leverage</label>
                    <div className="flex gap-2 mt-2">
                      {[1, 5, 10, 25, 50].map((lev) => (
                        <Button key={lev} variant="outline" size="sm">
                          {lev}x
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button className="bg-green-600 hover:bg-green-700">Long</Button>
                    <Button className="bg-red-600 hover:bg-red-700">Short</Button>
                  </div>
                </TabsContent>
                <TabsContent value="limit" className="space-y-4 mt-4">
                  <div>
                    <label className="text-sm font-medium">Price</label>
                    <Input placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Size</label>
                    <Input placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Leverage</label>
                    <div className="flex gap-2 mt-2">
                      {[1, 5, 10, 25, 50].map((lev) => (
                        <Button key={lev} variant="outline" size="sm">
                          {lev}x
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button className="bg-green-600 hover:bg-green-700">Long</Button>
                    <Button className="bg-red-600 hover:bg-red-700">Short</Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
