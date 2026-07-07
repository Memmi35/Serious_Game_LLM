import db from '@/lib/db'
import { findRoutes } from '@/lib/traffic-simulation'

export type RouteSummary = {
  name: string
  path: string[]
  predictedTime: number
  congestion: 'low' | 'medium' | 'high'
}

export type RoomContext = {
  origin: string
  destination: string
  routes: RouteSummary[]
  distribution: { route: string; count: number }[]
}

export type HistoryRow = {
  round: number
  initial_choice: string | null
  final_choice: string | null
  predicted_time: number | null
  realized_time: number | null
  choice_reason: string | null
  ai_compliance: boolean | null
}

// Predicted times/routes aren't persisted per round — recompute them the same
// way app/api/make-choice/route.ts does, from the room's live edges.
export async function getRoomContext(roomId: string, round: number): Promise<RoomContext> {
  const roomRes = await db.query(
    `SELECT current_origin, current_destination FROM game_rooms WHERE id = $1`,
    [roomId]
  )
  const room = roomRes.rows[0]
  if (!room) throw new Error(`Room ${roomId} not found`)

  const edgesRes = await db.query(`SELECT * FROM traffic_edges WHERE room_id = $1`, [roomId])
  const edges = edgesRes.rows.map((e) => ({
    id: (e.id as string).replace(`${roomId}_`, ''),
    from: e.from_node,
    to: e.to_node,
    freeTime: parseFloat(e.free_time),
    capacity: e.capacity,
    baseFlow: e.base_flow,
    flow: e.current_flow,
    travelTime: parseFloat(e.travel_time),
  }))

  const routes = findRoutes(edges, room.current_origin, room.current_destination)
  const routeSummaries: RouteSummary[] = Object.values(routes).map((r) => ({
    name: r.name,
    path: r.path,
    predictedTime: r.totalTravelTime,
    congestion: r.congestionLevel,
  }))

  const distRes = await db.query(
    `SELECT rl.chosen_route, COUNT(*)::int as count
     FROM round_logs rl
     JOIN simulation_sessions s ON s.id = rl.session_id
     WHERE s.room_id = $1 AND rl.round = $2
     GROUP BY rl.chosen_route`,
    [roomId, round]
  )

  return {
    origin: room.current_origin,
    destination: room.current_destination,
    routes: routeSummaries,
    distribution: distRes.rows.map((r) => ({ route: r.chosen_route, count: r.count })),
  }
}

export async function getPlayerHistory(sessionId: string): Promise<HistoryRow[]> {
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
}
