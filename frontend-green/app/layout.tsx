'use client'

import type React from "react"
import { DM_Sans } from "next/font/google"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WalletProvider } from "@/contexts/WalletContext"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"
import { useState } from "react"

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <html lang="en" className={`${dmSans.variable} dark`}>
      <body className="font-sans antialiased">
        <QueryClientProvider client={queryClient}>
          <WalletProvider>
            {children}
            <Toaster 
              position="top-right"
              toastOptions={{
                duration: 4000,
              }}
            />
          </WalletProvider>
        </QueryClientProvider>
      </body>
    </html>
  )
}
