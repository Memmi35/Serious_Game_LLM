import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { bprTime, generateEdges } from "@/lib/traffic-simulation";

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    const { room_id, action } = await request.json();

    if (!room_id || !action) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    if (action === "start") {
      await client.query(`
        UPDATE game_rooms SET status = 'playing' WHERE id = $1
      `, [room_id]);

    } else if (action === "next_round") {
      const roomResult = await client.query(`
        SELECT * FROM game_rooms WHERE id = $1
      `, [room_id]);

      if (roomResult.rows.length === 0) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }
      const room = roomResult.rows[0];

      // Get sessions
      const sessionsResult = await client.query(`
        SELECT id FROM simulation_sessions WHERE room_id = $1
      `, [room_id]);
      const sessionIds = sessionsResult.rows.map((s: any) => s.id);

      // Get current round logs
      const roundLogsResult = await client.query(`
        SELECT * FROM round_logs
        WHERE session_id = ANY($1) AND round = $2
      `, [sessionIds, room.current_round]);
      const currentRoundLogs = roundLogsResult.rows;

      // Get edges
      const edgesResult = await client.query(`
        SELECT * FROM traffic_edges WHERE room_id = $1
      `, [room_id]);
      const dbEdges = edgesResult.rows;

      if (dbEdges.length > 0 && currentRoundLogs.length > 0) {
        // Step 1: Add +1 flow per player on their chosen route edges
        const updatedEdges = dbEdges.map((e: any) => ({ ...e }));
        for (const log of currentRoundLogs) {
          const path: string[] = log.route_path;
          for (let i = 0; i < path.length - 1; i++) {
            const edgeId = `${room_id}_${path[i]}-${path[i + 1]}`;
            const edge = updatedEdges.find((e: any) => e.id === edgeId);
            if (edge) edge.current_flow += 1;
          }
        }

        // Step 2: Recompute BPR travel times
        for (const edge of updatedEdges) {
          edge.travel_time = bprTime(
            parseFloat(edge.free_time),
            edge.current_flow,
            edge.capacity
          );
        }

        // Step 3: Compute and write realized time for each player
        await client.query("BEGIN");
        for (const log of currentRoundLogs) {
          const path: string[] = log.route_path;
          let realizedTime = 0;
          for (let i = 0; i < path.length - 1; i++) {
            const edgeId = `${room_id}_${path[i]}-${path[i + 1]}`;
            const edge = updatedEdges.find((e: any) => e.id === edgeId);
            if (edge) realizedTime += edge.travel_time;
          }
          await client.query(`
            UPDATE round_logs SET realized_time = $1 WHERE id = $2
          `, [Math.round(realizedTime * 100) / 100, log.id]);
        }

        // Step 4: Persist updated edge flows and travel times
        for (const edge of updatedEdges) {
          await client.query(`
            UPDATE traffic_edges
            SET current_flow = $1, travel_time = $2
            WHERE id = $3
          `, [edge.current_flow, edge.travel_time, edge.id]);
        }
        await client.query("COMMIT");
      }

      if (room.current_round >= room.total_rounds) {
        // Mark game completed
        await client.query(`
          UPDATE game_rooms SET status = 'completed' WHERE id = $1
        `, [room_id]);
        await client.query(`
          UPDATE simulation_sessions SET is_complete = true WHERE room_id = $1
        `, [room_id]);
      } else {
        const nextRound = room.current_round + 1;

        // Get next endpoint
        const endpointResult = await client.query(`
          SELECT * FROM room_endpoints WHERE room_id = $1 AND round = $2
        `, [room_id, nextRound]);
        const nextEndpoint = endpointResult.rows[0];

        // Advance room
        await client.query(`
          UPDATE game_rooms
          SET current_round = $1, current_origin = $2, current_destination = $3
          WHERE id = $4
        `, [nextRound, nextEndpoint?.origin, nextEndpoint?.destination, room_id]);

        // Regenerate edges for the new scenario
        const newEdges = generateEdges(nextRound);
        
        // Clear old edges for room
        await client.query(`DELETE FROM traffic_edges WHERE room_id = $1`, [room_id]);
        
        // Insert new round edges
        for (const edge of newEdges) {
          await client.query(`
            INSERT INTO traffic_edges (id, room_id, from_node, to_node, free_time, capacity, base_flow, current_flow, travel_time)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            `${room_id}_${edge.id}`,
            room_id,
            edge.from,
            edge.to,
            edge.freeTime,
            edge.capacity,
            edge.baseFlow,
            edge.flow,
            bprTime(edge.freeTime, edge.baseFlow, edge.capacity),
          ]);
        }

        // Reset sessions for next round
        await client.query(`
          UPDATE simulation_sessions
          SET current_round = $1, has_submitted = false, updated_at = now()
          WHERE room_id = $2
        `, [nextRound, room_id]);
      }
    }

    return NextResponse.json({ status: "success" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  } finally {
    client.release();
  }
}