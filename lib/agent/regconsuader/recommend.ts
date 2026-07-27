// RegConSuader Room 1's pitch generation. Structurally mirrors
// lib/agent/recommend.ts's generateRecommendation, but lives entirely
// separately — see the "keep PersuLLM-1 untouchable" decision in project
// memory. Only lib/agent/ollama.ts (raw model client) and
// lib/agent/context.ts (plain DB reads) are reused, since neither has any
// PersuLLM-specific behavior baked in.
import { ollama } from '@/lib/agent/ollama'
import { getRoomContext, getPlayerHistory } from '@/lib/agent/context'
import db from '@/lib/db'
import {
  REGCONSUADER_SYSTEM_PROMPT,
  STRATEGY_FRAMINGS,
  RECOMMENDATION_INSTRUCTION,
  switchRecommendationInstruction,
  buildContextBlock,
  type MetaStrategy,
} from './prompts'
import { assignStrategy } from './strategy'

type Recommendation = {
  route: 'A' | 'B' | 'C'
  explanation: string
  strategy: MetaStrategy
}

function parseRecommendation(raw: string): { route: 'A' | 'B' | 'C'; explanation: string } | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && ['A', 'B', 'C'].includes(parsed.route) && typeof parsed.explanation === 'string') {
      return { route: parsed.route, explanation: parsed.explanation }
    }
  } catch {
    // fall through to regex fallback below
  }
  const match = raw.match(/Route\s*([ABC])/i)
  if (match) {
    return { route: match[1].toUpperCase() as 'A' | 'B' | 'C', explanation: raw.slice(0, 300) }
  }
  return null
}

export async function generateRegConSuaderRecommendation({
  roomId,
  round,
  sessionId,
  persuaderModel,
}: {
  roomId: string
  round: number
  sessionId: string
  persuaderModel?: string
}): Promise<Recommendation> {
  // cache check — same table PersuLLM-1 uses, since it's condition-agnostic
  // infra (keyed on session_id+round, no PersuLLM-specific logic of its own)
  const cached = await db.query(
    `SELECT recommended_route, explanation, regconsuader_strategy
     FROM agent_recommendations
     WHERE session_id = $1 AND round = $2`,
    [sessionId, round]
  )
  if (cached.rows.length > 0 && cached.rows[0].regconsuader_strategy) {
    return {
      route: cached.rows[0].recommended_route,
      explanation: cached.rows[0].explanation,
      strategy: cached.rows[0].regconsuader_strategy,
    }
  }

  const strategy = assignStrategy(sessionId, round)

  const [roomCtx, history] = await Promise.all([
    getRoomContext(roomId, round),
    getPlayerHistory(sessionId),
  ])

  const contextBlock = buildContextBlock(roomCtx, history)

  const raw = await ollama.chat(
    [
      { role: 'system', content: REGCONSUADER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${contextBlock}\n\n${STRATEGY_FRAMINGS[strategy]}\n\n${RECOMMENDATION_INSTRUCTION}`,
      },
    ],
    { json: true, model: persuaderModel }
  )

  const parsed = parseRecommendation(raw)
  if (!parsed) {
    throw new Error(`RegConSuader model returned unusable response: ${raw.slice(0, 200)}`)
  }

  await db.query(
    `INSERT INTO agent_recommendations
       (session_id, room_id, round, recommended_route, explanation, regconsuader_strategy)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id, round) DO NOTHING`,
    [sessionId, roomId, round, parsed.route, parsed.explanation, strategy]
  )

  return { ...parsed, strategy }
}

// Switch-phase pitch — same "one-off, not cached" reasoning as PersuLLM-1's
// generateSwitchRecommendation (agent_recommendations is keyed on
// session_id+round and already holds this round's initial pitch; reusing it
// here would collide). Reads back the strategy already assigned to this
// player/round (via the cache check above having run first in practice, but
// falls back to reassigning deterministically if called standalone) so the
// switch pitch stays consistent with the opening pitch's framing.
export async function generateRegConSuaderSwitchRecommendation({
  roomId,
  round,
  sessionId,
  persuaderModel,
  currentChoice,
  predictedTime,
  realizedTime,
}: {
  roomId: string
  round: number
  sessionId: string
  persuaderModel?: string
  currentChoice: string
  predictedTime: number
  realizedTime: number
}): Promise<Recommendation> {
  const cached = await db.query(
    `SELECT regconsuader_strategy FROM agent_recommendations WHERE session_id = $1 AND round = $2`,
    [sessionId, round]
  )
  const strategy: MetaStrategy = cached.rows[0]?.regconsuader_strategy ?? assignStrategy(sessionId, round)

  const [roomCtx, history] = await Promise.all([
    getRoomContext(roomId, round),
    getPlayerHistory(sessionId),
  ])

  const contextBlock = buildContextBlock(roomCtx, history)
  const gapPct = predictedTime > 0 ? (((realizedTime - predictedTime) / predictedTime) * 100).toFixed(1) : '0.0'
  const gapDirection = realizedTime >= predictedTime ? 'slower' : 'faster'
  const switchContext = `This round, the player chose ${currentChoice}. Predicted travel time was ${predictedTime}s; realized travel time (based on everyone's actual choices) was ${realizedTime}s — that's ${Math.abs(Number(gapPct))}% ${gapDirection} than expected.`

  const raw = await ollama.chat(
    [
      { role: 'system', content: REGCONSUADER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${contextBlock}\n\n${switchContext}\n\n${switchRecommendationInstruction(strategy)}`,
      },
    ],
    { json: true, model: persuaderModel }
  )

  const parsed = parseRecommendation(raw)
  if (!parsed) {
    throw new Error(`RegConSuader switch model returned unusable response: ${raw.slice(0, 200)}`)
  }

  return { ...parsed, strategy }
}
