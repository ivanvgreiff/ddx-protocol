import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ contractAddress: string }> }) {
  try {
    const { contractAddress } = await params
    const body = await request.json()
    
    // Proxy to your actual backend
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(`${backendUrl}/api/option/${contractAddress}/enter`, {
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
    console.error('Error proxying enter option:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to prepare enter transaction' },
      { status: 500 }
    )
  }
}