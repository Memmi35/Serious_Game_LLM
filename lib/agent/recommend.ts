import { ollama } from './ollama'
import { getRoomContext, getPlayerHistory } from './context'
import { systemPromptFor, buildContextBlock, RECOMMENDATION_INSTRUCTION, switchInstructionFor } from './prompts'
import { getMockRecommendation } from './mock'
import db from '@/lib/db'

// Set AGENT_MODE=ollama in .env.local once the model server is reachable.
const USE_MOCK = process.env.AGENT_MODE !== 'ollama'

type Recommendation = {
  route: 'A' | 'B' | 'C'
  explanation: string
}

function parseRecommendation(raw: string): Recommendation | null {
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

async function callModel(
  roomId: string,
  round: number,
  sessionId: string,
  condition: string,
  persuaderModel?: string
): Promise<Recommendation> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 400))
    return getMockRecommendation(sessionId, round, condition)
  }

  try {
    const [roomCtx, history] = await Promise.all([
      getRoomContext(roomId, round),
      getPlayerHistory(sessionId),
    ])

    const contextBlock = buildContextBlock(roomCtx, history, condition)
    const raw = await ollama.chat(
      [
        { role: 'system', content: systemPromptFor(condition) },
        { role: 'user', content: `${contextBlock}\n\n${RECOMMENDATION_INSTRUCTION}` },
      ],
      { json: true, model: persuaderModel }
    )

    const parsed = parseRecommendation(raw)
    if (parsed) return parsed
    throw new Error(`Model returned unusable response: ${raw.slice(0, 200)}`)
  } catch (err) {
    console.error('Ollama call failed, falling back to mock:', err)
    const fallback = getMockRecommendation(sessionId, round, condition)
    return { ...fallback, explanation: `${fallback.explanation} (offline fallback — model server unreachable)` }
  }
}

export async function generateRecommendation({
  roomId,
  round,
  sessionId,
  condition,
  persuaderModel,
}: {
  roomId: string
  round: number
  sessionId: string
  condition: string
  persuaderModel?: string
}): Promise<Recommendation> {
  // check cache first — never call the model twice for same session+round
  const cached = await db.query(
    `SELECT recommended_route, explanation
     FROM agent_recommendations
     WHERE session_id = $1 AND round = $2`,
    [sessionId, round]
  )

  if (cached.rows.length > 0) {
    return {
      route: cached.rows[0].recommended_route as 'A' | 'B' | 'C',
      explanation: cached.rows[0].explanation,
    }
  }

  const rec = await callModel(roomId, round, sessionId, condition, persuaderModel)

  await db.query(
    `INSERT INTO agent_recommendations
       (session_id, room_id, round, recommended_route, explanation)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, round) DO NOTHING`,
    [sessionId, roomId, round, rec.route, rec.explanation]
  )

  return rec
}

// Switch-phase pitch — deliberately NOT cached via agent_recommendations
// (that table is keyed on session_id+round and already holds the initial
// pitch for this round; reusing it here would either collide or require a
// schema change). This is a one-off call per agent per round, same as the
// initial pitch is in practice, just without the reload-safety concern a
// real human player's page refresh would otherwise motivate.
export async function generateSwitchRecommendation({
  roomId,
  round,
  sessionId,
  condition,
  persuaderModel,
  currentChoice,
  predictedTime,
  realizedTime,
}: {
  roomId: string
  round: number
  sessionId: string
  condition: string
  persuaderModel?: string
  currentChoice: string
  predictedTime: number
  realizedTime: number
}): Promise<Recommendation> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 400))
    return getMockRecommendation(sessionId, round, condition)
  }

  try {
    const [roomCtx, history] = await Promise.all([
      getRoomContext(roomId, round),
      getPlayerHistory(sessionId),
    ])

    const contextBlock = buildContextBlock(roomCtx, history, condition)
    const gapPct = predictedTime > 0 ? (((realizedTime - predictedTime) / predictedTime) * 100).toFixed(1) : '0.0'
    const gapDirection = realizedTime >= predictedTime ? 'slower' : 'faster'
    const switchContext = `This round, the player chose ${currentChoice}. Predicted travel time was ${predictedTime}s; realized travel time (based on everyone's actual choices) was ${realizedTime}s — that's ${Math.abs(Number(gapPct))}% ${gapDirection} than expected.`

    const raw = await ollama.chat(
      [
        { role: 'system', content: systemPromptFor(condition) },
        { role: 'user', content: `${contextBlock}\n\n${switchContext}\n\n${switchInstructionFor(condition)}` },
      ],
      { json: true, model: persuaderModel }
    )

    const parsed = parseRecommendation(raw)
    if (parsed) return parsed
    throw new Error(`Model returned unusable response: ${raw.slice(0, 200)}`)
  } catch (err) {
    console.error('Switch-phase Ollama call failed, falling back to mock:', err)
    const fallback = getMockRecommendation(sessionId, round, condition)
    return { ...fallback, explanation: `${fallback.explanation} (offline fallback — model server unreachable)` }
  }
}
