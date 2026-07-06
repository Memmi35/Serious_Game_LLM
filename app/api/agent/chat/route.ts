import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

// ── TOGGLE THIS WHEN SERVER IS READY ─────────────────────────────────────────
const USE_MOCK = true
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { sessionId, roomId, round, message } = await req.json()

    if (!sessionId || !roomId || !message) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    // get condition from DB
    const room = await pool.query(
      `SELECT agent_condition FROM game_rooms WHERE id = $1`,
      [roomId]
    )
    const condition = room.rows[0]?.agent_condition ?? 'baseline'

    if (condition === 'baseline') {
      return NextResponse.json({
        reply: 'No AI advisor available in baseline condition.',
      })
    }

    if (USE_MOCK) {
      // mock: always reply with condition identity
      const reply =
        condition === 'central'
          ? `I am the CENTRAL agent. I can see all players in the room. You asked: "${message}"`
          : `I am your PERSONAL agent. I can see only your history. You asked: "${message}"`

      return NextResponse.json({ reply })
    }

    // ── REAL MODEL CALL (uncomment when server ready) ─────────────────────────
    // const { generateText } = await import('ai')
    // const { ollama } = await import('ollama-ai-provider')
    // const { getRoomState, getPlayerHistory } = await import('@/lib/agent/tools')
    // const { CENTRAL_SYSTEM_PROMPT } = await import('@/lib/agent/prompts')
    //
    // const result = await generateText({
    //   model: ollama('llama3.1'),
    //   system: CENTRAL_SYSTEM_PROMPT,
    //   messages: [
    //     ...history.map((m: any) => ({ role: m.role, content: m.content })),
    //   ],
    //   tools: { getRoomState, getPlayerHistory },
    //   maxSteps: 4,
    // })
    // return NextResponse.json({ reply: result.text })
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ reply: 'Model not available yet.' })

  } catch (err) {
    console.error('Chat error:', err)
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}