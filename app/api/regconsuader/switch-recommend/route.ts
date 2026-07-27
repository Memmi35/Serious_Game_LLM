import { NextRequest, NextResponse } from 'next/server'
import { generateRegConSuaderSwitchRecommendation } from '@/lib/agent/regconsuader/recommend'
import db from '@/lib/db'

// Separate endpoint from /api/agent/switch-recommend (PersuLLM-1) — see
// project memory on keeping PersuLLM-1's own code path untouched.
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

    if (condition !== 'regconsuader') {
      return NextResponse.json({ error: 'Room is not a regconsuader-condition room' }, { status: 400 })
    }

    const rec = await generateRegConSuaderSwitchRecommendation({
      roomId,
      round,
      sessionId,
      persuaderModel,
      currentChoice,
      predictedTime: predictedTime ?? 0,
      realizedTime: realizedTime ?? 0,
    })
    return NextResponse.json({ condition, ...rec })
  } catch (err) {
    console.error('RegConSuader switch-recommend error:', err)
    return NextResponse.json({ error: 'Agent failed' }, { status: 500 })
  }
}
