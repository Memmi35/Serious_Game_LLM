import { NextRequest, NextResponse } from 'next/server'
import { generateRecommendation } from '@/lib/agent/recommend'
import  db  from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId') ?? ''
  const roomId    = searchParams.get('roomId') ?? ''
  const round     = parseInt(searchParams.get('round') ?? '')

  if (!sessionId || !roomId || !round) {
    return NextResponse.json(
      { error: 'Missing params' },
      { status: 400 }
    )
  }

const room = await db.query(
  `SELECT agent_condition FROM game_rooms WHERE id = $1`,
  [roomId]
)

  const condition = room.rows[0]?.agent_condition ?? 'baseline'

  if (condition === 'baseline') {
    return NextResponse.json({ condition: 'baseline' })
  }

  try {
    const rec = await generateRecommendation({ roomId, round, sessionId, condition })
    return NextResponse.json({ condition, ...rec })
  } catch (err) {
    console.error('Agent error:', err)
    return NextResponse.json(
      { error: 'Agent failed' },
      { status: 500 }
    )
  }
}