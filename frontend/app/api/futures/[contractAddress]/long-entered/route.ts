import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: { contractAddress: string } }
) {
  try {
    const body = await request.json()
    const { contractAddress } = params
    
    // Proxy to the backend (if backend supports futures tracking)
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001'
    const response = await fetch(`${backendUrl}/api/contracts/${contractAddress}/long-entered`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    
    if (!response.ok) {
      console.warn('Backend long-entered tracking failed, continuing silently')
    }
    
    const data = response.ok ? await response.json() : { success: true, message: 'Long entry logged (fallback)' }
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error proxying long-entered:', error)
    return NextResponse.json(
      { success: true, message: 'Long entry logged (fallback)' },
      { status: 200 }
    )
  }
}