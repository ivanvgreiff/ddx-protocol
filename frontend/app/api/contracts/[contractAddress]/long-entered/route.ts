import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: { contractAddress: string } }) {
  try {
    const { contractAddress } = params
    const body = await request.json()
    
    // Proxy to your actual backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(`${backendUrl}/api/contracts/${contractAddress}/long-entered`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    
    if (!response.ok) {
      throw new Error(`Backend responded with status: ${response.status}`)
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error proxying long-entered event:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to record long entry' },
      { status: 500 }
    )
  }
}