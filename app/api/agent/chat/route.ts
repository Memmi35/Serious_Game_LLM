import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { ollama } from '@/lib/agent/ollama'
import { getRoomContext, getPlayerHistory } from '@/lib/agent/context'
import { systemPromptFor, buildContextBlock, chatInstructionFor } from '@/lib/agent/prompts'
import {
  CENTRAL_SYSTEM_PROMPT_V2,
  CENTRAL_NO_NUMBERS_SYSTEM_PROMPT_V2,
  PERSUADE_CHAT_INSTRUCTION_V2,
  PERSUADE_CHAT_INSTRUCTION_V2_OPEN,
} from '@/lib/agent/prompts-v2'

// Set AGENT_MODE=ollama in .env.local once the model server is reachable.
const USE_MOCK = process.env.AGENT_MODE !== 'ollama'

// Same ablation-study component toggle as lib/agent/recommend.ts -- keep
// both endpoints on the same prompt version for a given room, since a
// mid-round switch between v1/v2 phrasing would confound the comparison
// with a "the advisor contradicted its own opening tone" artifact.
const PROMPT_VERSION = process.env.PROMPT_VERSION === 'v2' ? 'v2' : 'v1'

function versionedSystemAndChatInstruction(condition: string): string {
  if (PROMPT_VERSION === 'v2' && (condition === 'central' || condition === 'central_no_numbers')) {
    const suppressed = condition === 'central_no_numbers'
    const system = suppressed ? CENTRAL_NO_NUMBERS_SYSTEM_PROMPT_V2 : CENTRAL_SYSTEM_PROMPT_V2
    const chatInstruction = suppressed ? PERSUADE_CHAT_INSTRUCTION_V2 : PERSUADE_CHAT_INSTRUCTION_V2_OPEN
    return `${system}\n\n${chatInstruction}`
  }
  return `${systemPromptFor(condition)}\n\n${chatInstructionFor(condition)}`
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, roomId, round, message, history } = await req.json()

    if (!sessionId || !roomId || !message) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 })
    }

    // get condition from DB
    const room = await pool.query(
      `SELECT agent_condition, persuader_model FROM game_rooms WHERE id = $1`,
      [roomId]
    )
    const condition = room.rows[0]?.agent_condition ?? 'baseline'
    const persuaderModel = room.rows[0]?.persuader_model ?? undefined

    if (condition === 'baseline') {
      return NextResponse.json({
        reply: 'No AI advisor available in baseline condition.',
      })
    }

    if (USE_MOCK) {
      // mock: always reply with condition identity
      const reply =
        condition === 'central'
          ? `I am PersuLLM, and I'd suggest a different route than that. (mock mode — you asked: "${message}")`
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

      const reply = await ollama.chat(
        [
          { role: 'system', content: versionedSystemAndChatInstruction(condition) },
          { role: 'user', content: contextBlock },
          ...priorMessages,
          { role: 'user', content: message },
        ],
        { model: persuaderModel }
      )

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
