import { generateText } from 'ai'
import { getRoomState, getPlayerHistory, submitRecommendation } from './tools'
import { CENTRAL_SYSTEM_PROMPT } from './prompts'
import { getMockRecommendation } from './mock'
import db from '@/lib/db'

// ─── FLIP THIS TO false WHEN YOU GET SERVER ACCESS ────────────────────────────
const USE_MOCK = true
// ─────────────────────────────────────────────────────────────────────────────

type Recommendation = {
  route: 'A' | 'B' | 'C'
  explanation: string
}

async function callModel(
  roomId: string,
  round: number,
  sessionId: string,
  condition: string   // add this parameter
): Promise<Recommendation> {

  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 800))
    return getMockRecommendation(sessionId, round, condition)  // pass condition
  }

  // ── UNCOMMENT WHEN SERVER IS READY ────────────────────────────────────────
  // import { ollama } from 'ollama-ai-provider'
  // const model = ollama('llama3.1')
  // ─────────────────────────────────────────────────────────────────────────

  // @ts-expect-error: optional dependency used only when USE_MOCK is false
  const { ollama } = await import('ollama-ai-provider')

  const result = await generateText({
    model: ollama('llama3.1'),
    system: CENTRAL_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Room ${roomId}, Round ${round}, Session ${sessionId}. Please recommend a route.`,
      },
    ],
    tools: {
      getRoomState,
      getPlayerHistory,
      submitRecommendation,
    },
    // 'maxSteps' is not a valid option on the generateText call; remove it
  })

  // try to find the submitRecommendation tool call
  const submission = result.steps
    .flatMap(s => s.toolCalls ?? [])
    .find(tc => tc.toolName === 'submitRecommendation')

  if (!submission) {
    // fallback: parse plain text if model did not use the tool
    const text = result.text ?? ''
    const routeMatch = text.match(/Route\s+([ABC])/i)
    if (routeMatch) {
      return {
        route: routeMatch[1].toUpperCase() as 'A' | 'B' | 'C',
        explanation: text.slice(0, 200),
      }
    }
    throw new Error('Agent did not submit a recommendation')
  }

  // typing for tool call can be dynamic; cast to any to access args
  return (submission as any).args as Recommendation
}

export async function generateRecommendation({
  roomId,
  round,
  sessionId,
  condition,
}: {
  roomId: string
  round: number
  sessionId: string
  condition: string   // add this
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

  const rec = await callModel(roomId, round, sessionId, condition)

  await db.query(
    `INSERT INTO agent_recommendations
       (session_id, room_id, round, recommended_route, explanation)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, round) DO NOTHING`,
    [sessionId, roomId, round, rec.route, rec.explanation]
  )

  return rec
}