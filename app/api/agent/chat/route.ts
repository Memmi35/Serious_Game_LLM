import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { ollama } from '@/lib/agent/ollama'
import { getRoomContext, getPlayerHistory } from '@/lib/agent/context'
import { systemPromptFor, buildContextBlock, CHAT_INSTRUCTION } from '@/lib/agent/prompts'

// Set AGENT_MODE=ollama in .env.local once the model server is reachable.
const USE_MOCK = process.env.AGENT_MODE !== 'ollama'

export async function POST(req: NextRequest) {
  try {
    const { sessionId, roomId, round, message, history } = await req.json()

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

    try {
      const [roomCtx, playerHistory] = await Promise.all([
        getRoomContext(roomId, round),
        getPlayerHistory(sessionId),
      ])

      const contextBlock = buildContextBlock(roomCtx, playerHistory, condition)

      const priorMessages = Array.isArray(history)
        ? history
            .slice(-8)
            .map((m: { role: string; content: string }) => ({
              role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
              content: m.content,
            }))
        : []

      const reply = await ollama.chat([
        { role: 'system', content: `${systemPromptFor(condition)}\n\n${CHAT_INSTRUCTION}` },
        { role: 'user', content: contextBlock },
        ...priorMessages,
        { role: 'user', content: message },
      ])

      return NextResponse.json({ reply: reply || 'The advisor had nothing to add.' })
    } catch (modelErr) {
      console.error('Ollama chat call failed:', modelErr)
      return NextResponse.json({
        reply: 'The advisor is temporarily unreachable — try again in a moment.',
      })
    }
  } catch (err) {
    console.error('Chat error:', err)
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}
