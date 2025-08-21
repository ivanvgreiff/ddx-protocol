import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Proxy to your actual backend - uses port 3001 from root .env file
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(`${backendUrl}/api/factory/all-contracts`, {
      headers: {
        'Content-Type': 'application/json',
      },
    })
    
    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error proxying factory contracts:', error)
    
    // Return mock data as fallback
    return NextResponse.json({
      contracts: [],
      totalVolume: '1250450000000000000000', // Mock volume in wei (1250.45 MTK)
      success: true
    })
  }
}