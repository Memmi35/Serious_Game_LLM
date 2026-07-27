import { NextRequest, NextResponse } from 'next/server'
import { generateRegConSuaderRecommendation } from '@/lib/agent/regconsuader/recommend'
import db from '@/lib/db'

// Separate endpoint from /api/agent/recommend (PersuLLM-1) — see project
// memory on keeping PersuLLM-1's own code path untouched.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId') ?? ''
  const roomId = searchParams.get('roomId') ?? ''
  const round = parseInt(searchParams.get('round') ?? '')

  if (!sessionId || !roomId || !round) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }

  const room = await db.query(
    `SELECT agent_condition, persuader_model FROM game_rooms WHERE id = $1`,
    [roomId]
  )

  const condition = room.rows[0]?.agent_condition ?? 'baseline'
  const persuaderModel = room.rows[0]?.persuader_model ?? undefined

  if (condition !== 'regconsuader') {
    return NextResponse.json({ error: 'Room is not a regconsuader-condition room' }, { status: 400 })
  }

  try {
    const rec = await generateRegConSuaderRecommendation({ roomId, round, sessionId, persuaderModel })
    return NextResponse.json({ condition, ...rec })
  } catch (err) {
    console.error('RegConSuader recommend error:', err)
    return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
  }
}
