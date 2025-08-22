import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ contractAddress: string }> }) {
  try {
    const { contractAddress } = await params
    
    // Proxy to your actual backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(`${backendUrl}/api/option/${contractAddress}`, {
      method: 'GET',
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
    console.error('Error fetching option details:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch option details' },
      { status: 404 }
    )
  }
}