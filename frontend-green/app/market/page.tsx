"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Navigation } from "@/components/navigation"
import {
  Search,
  Filter,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  BarChart3,
  ArrowUpRight,
  ArrowLeft,
} from "lucide-react"
import Link from "next/link"

// Mock data for options contracts
const mockOptions = [
  {
    id: "1",
    asset: "ETH",
    type: "Call",
    strike: 2500,
    expiry: "2024-03-15",
    premium: 0.15,
    payoffType: "Linear",
    volume24h: 125000,
    openInterest: 450,
    impliedVol: 0.65,
    delta: 0.42,
    status: "active",
  },
  {
    id: "2",
    asset: "BTC",
    type: "Put",
    strike: 45000,
    expiry: "2024-02-28",
    premium: 0.08,
    payoffType: "Quadratic",
    volume24h: 89000,
    openInterest: 320,
    impliedVol: 0.58,
    delta: -0.35,
    status: "active",
  },
  {
    id: "3",
    asset: "ETH",
    type: "Call",
    strike: 3000,
    expiry: "2024-04-20",
    premium: 0.22,
    payoffType: "Logarithmic",
    volume24h: 67000,
    openInterest: 180,
    impliedVol: 0.72,
    delta: 0.28,
    status: "active",
  },
  {
    id: "4",
    asset: "BTC",
    type: "Call",
    strike: 50000,
    expiry: "2024-03-30",
    premium: 0.18,
    payoffType: "Linear",
    volume24h: 156000,
    openInterest: 620,
    impliedVol: 0.61,
    delta: 0.38,
    status: "active",
  },
]

export default function OptionsMarket() {
  const [searchTerm, setSearchTerm] = useState("")
  const [filterType, setFilterType] = useState("all")
  const [filterAsset, setFilterAsset] = useState("all")
  const [sortBy, setSortBy] = useState("volume")

  const filteredOptions = mockOptions.filter((option) => {
    const matchesSearch =
      option.asset.toLowerCase().includes(searchTerm.toLowerCase()) ||
      option.type.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesType = filterType === "all" || option.type.toLowerCase() === filterType.toLowerCase()
    const matchesAsset = filterAsset === "all" || option.asset.toLowerCase() === filterAsset.toLowerCase()

    return matchesSearch && matchesType && matchesAsset
  })

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
            <h1 className="text-3xl font-bold">Options Market</h1>
            <p className="text-muted-foreground">Browse and trade available option contracts</p>
          </div>
        </div>

        {/* Market Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Contracts</CardTitle>
              <BarChart3 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2,847</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-chart-1">+12</span> new today
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">24h Volume</CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">$1.8M</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-chart-2">-2.1%</span> from yesterday
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Open Interest</CardTitle>
              <DollarSign className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">$4.2M</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-chart-1">+5.8%</span> from last week
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Premium</CardTitle>
              <Clock className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">0.16 ETH</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-chart-1">+3.2%</span> from last hour
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card className="bg-card border-border mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Filter & Search
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search by asset or option type..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={filterAsset} onValueChange={setFilterAsset}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Asset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Assets</SelectItem>
                  <SelectItem value="eth">ETH</SelectItem>
                  <SelectItem value="btc">BTC</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="call">Call Options</SelectItem>
                  <SelectItem value="put">Put Options</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="volume">Volume</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="expiry">Expiry</SelectItem>
                  <SelectItem value="strike">Strike Price</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Options Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Available Options</CardTitle>
            <CardDescription>{filteredOptions.length} contracts available for trading</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Strike</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Payoff</TableHead>
                    <TableHead>24h Volume</TableHead>
                    <TableHead>Open Interest</TableHead>
                    <TableHead>IV</TableHead>
                    <TableHead>Delta</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOptions.map((option) => (
                    <TableRow key={option.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center">
                            <span className="text-xs font-bold text-primary">{option.asset.charAt(0)}</span>
                          </div>
                          {option.asset}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={option.type === "Call" ? "default" : "secondary"}>
                          {option.type === "Call" ? (
                            <TrendingUp className="w-3 h-3 mr-1" />
                          ) : (
                            <TrendingDown className="w-3 h-3 mr-1" />
                          )}
                          {option.type}
                        </Badge>
                      </TableCell>
                      <TableCell>${option.strike.toLocaleString()}</TableCell>
                      <TableCell>{option.expiry}</TableCell>
                      <TableCell className="font-mono">{option.premium} ETH</TableCell>
                      <TableCell>
                        <Badge variant="outline">{option.payoffType}</Badge>
                      </TableCell>
                      <TableCell>${option.volume24h.toLocaleString()}</TableCell>
                      <TableCell>{option.openInterest}</TableCell>
                      <TableCell>{(option.impliedVol * 100).toFixed(1)}%</TableCell>
                      <TableCell className={option.delta > 0 ? "text-chart-1" : "text-chart-2"}>
                        {option.delta > 0 ? "+" : ""}
                        {option.delta.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" className="bg-chart-1 hover:bg-chart-1/90 text-white">
                            Buy
                          </Button>
                          <Button size="sm" variant="outline">
                            Sell
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="mt-8 text-center">
          <Card className="bg-card border-border p-6">
            <h3 className="text-lg font-semibold mb-2">Don't see what you're looking for?</h3>
            <p className="text-muted-foreground mb-4">
              Create your own custom option contract with personalized parameters
            </p>
            <Link href="/create">
              <Button className="bg-primary hover:bg-primary/90">
                Create Custom Option
                <ArrowUpRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  )
}
