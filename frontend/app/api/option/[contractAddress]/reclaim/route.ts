import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: { contractAddress: string } }) {
  try {
    const { contractAddress } = params
    
    // Proxy to your actual backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(`${backendUrl}/api/option/${contractAddress}/reclaim`, {
      method: 'POST',
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
    console.error('Error proxying reclaim option:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to prepare reclaim transaction' },
      { status: 500 }
    )
  }
}