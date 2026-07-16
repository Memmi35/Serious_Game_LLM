import { NextRequest, NextResponse } from 'next/server'
import { generateSwitchRecommendation } from '@/lib/agent/recommend'
import db from '@/lib/db'

// Opening pitch for the switch/reflection phase — see
// lib/agent/recommend.ts's generateSwitchRecommendation for why this is a
// separate, uncached call rather than reusing GET /api/agent/recommend
// (which caches the *initial* pitch per session_id+round).
export async function POST(req: NextRequest) {
  try {
    const { sessionId, roomId, round, currentChoice, predictedTime, realizedTime } = await req.json()

    if (!sessionId || !roomId || !round || !currentChoice) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    const room = await db.query(
      `SELECT agent_condition, persuader_model FROM game_rooms WHERE id = $1`,
      [roomId]
    )
    const condition = room.rows[0]?.agent_condition ?? 'baseline'
    const persuaderModel = room.rows[0]?.persuader_model ?? undefined

    if (condition === 'baseline') {
      return NextResponse.json({ condition: 'baseline' })
    }

    const rec = await generateSwitchRecommendation({
      roomId,
      round,
      sessionId,
      condition,
      persuaderModel,
      currentChoice,
      predictedTime: predictedTime ?? 0,
      realizedTime: realizedTime ?? 0,
    })
    return NextResponse.json({ condition, ...rec })
  } catch (err) {
    console.error('Switch-recommend error:', err)
    return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
  }
}
