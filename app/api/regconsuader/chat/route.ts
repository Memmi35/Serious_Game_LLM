import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { ollama } from '@/lib/agent/ollama'
import { getRoomContext, getPlayerHistory } from '@/lib/agent/context'
import { REGCONSUADER_SYSTEM_PROMPT, buildContextBlock, reactiveChatInstruction, type MetaStrategy } from '@/lib/agent/regconsuader/prompts'
import { pickStrategyFromScorecard } from '@/lib/agent/regconsuader/strategy'

// Separate endpoint from /api/agent/chat (PersuLLM-1) — see project memory
// on keeping PersuLLM-1's own code path untouched.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, roomId, round, message, history } = await req.json()

    if (!sessionId || !roomId || !message) {
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

    // Use the same strategy this player/round was already pitched with —
    // read it back from the cached recommendation rather than reassigning,
    // so a mid-round chat doesn't switch framing mid-conversation.
    const cached = await db.query(
      `SELECT regconsuader_strategy FROM agent_recommendations WHERE session_id = $1 AND round = $2`,
      [sessionId, round]
    )
    const strategy: MetaStrategy = cached.rows[0]?.regconsuader_strategy ?? (await pickStrategyFromScorecard(sessionId, round))

    const [roomCtx, playerHistory] = await Promise.all([
      getRoomContext(roomId, round),
      getPlayerHistory(sessionId),
    ])

    const contextBlock = buildContextBlock(roomCtx, playerHistory)

    const priorMessages = Array.isArray(history)
      ? history
          .slice(-8)
          .map((m: { role: string; content: string }) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: m.content,
          }))
      : []

    try {
      const reply = await ollama.chat(
        [
          { role: 'system', content: `${REGCONSUADER_SYSTEM_PROMPT}\n\n${reactiveChatInstruction(strategy)}` },
          { role: 'user', content: contextBlock },
          ...priorMessages,
          { role: 'user', content: message },
        ],
        { model: persuaderModel }
      )
      return NextResponse.json({ reply: reply || 'The advisor had nothing to add.' })
    } catch (modelErr) {
      // Matches lib/agent/agent/chat/route.ts's exact pattern: degrade to a
      // 200 with a placeholder reply instead of a 500. Room T0WQ (qwq:32b)
      // died here at round 4/5, 187 minutes in — the recommend/switch-
      // recommend calls already got this fallback treatment, but this
      // endpoint was missed, so a single slow chat call still took the
      // whole run down instead of degrading gracefully like the rest of
      // the pipeline now does.
      console.error('RegConSuader Ollama chat call failed:', modelErr)
      return NextResponse.json({
        reply: 'The advisor is temporarily unreachable — try again in a moment.',
      })
    }
  } catch (err) {
    console.error('RegConSuader chat error:', err)
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}
