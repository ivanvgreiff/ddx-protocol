import { Header } from "@/components/header"
import { HeroSection } from "@/components/hero-section"
import { TradingInterface } from "@/components/trading-interface"
import { StatsSection } from "@/components/stats-section"
import { FeaturesSection } from "@/components/features-section"
import { Footer } from "@/components/footer"

export default function ReferencePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <HeroSection />
        <TradingInterface />
        <StatsSection />
        <FeaturesSection />
      </main>
      <Footer />
    </div>
  )
}