import { tool } from 'ai'
import { z } from 'zod'
import  db  from '@/lib/db'

export const getRoomState = tool({
  description:
    'Get current round routes with predicted travel times and ' +
    'live choice distribution across all players in the room.',
  inputSchema: z.object({
    roomId: z.string(),
    round: z.number(),
  }),
  execute: async ({ roomId, round }) => {
    const distribution = await db.query(
      `SELECT chosen_route, COUNT(*) as count
       FROM round_logs
       WHERE room_id = $1 AND round = $2
       GROUP BY chosen_route`,
      [roomId, round]
    )
    const routes = await db.query(
      `SELECT route_label, predicted_time, route_path
       FROM round_endpoints
       WHERE room_id = $1 AND round = $2`,
      [roomId, round]
    )
    return {
      routes: routes.rows,
      distribution: distribution.rows,
    }
  },
})

export const getPlayerHistory = tool({
  description:
    'Get this player past choices and outcomes across all previous rounds.',
  inputSchema: z.object({
    sessionId: z.string(),
  }),
  execute: async ({ sessionId }) => {
    const rows = await db.query(
      `SELECT round, initial_choice, final_choice,
              predicted_time, realized_time,
              choice_reason, ai_compliance
       FROM round_logs
       WHERE session_id = $1
       ORDER BY round ASC`,
      [sessionId]
    )
    return rows.rows
  },
})

export const submitRecommendation = tool({
  description:
    'Submit your final route recommendation and plain-language explanation. ' +
    'Call this once you have read the room state and player history.',
  inputSchema: z.object({
    route: z.enum(['A', 'B', 'C']),
    explanation: z.string().max(200),
  }),
})