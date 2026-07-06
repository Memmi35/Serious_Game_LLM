import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { generateEdges, generateRoundEndpoints, bprTime } from "@/lib/traffic-simulation";

export async function POST(request: Request) {
  const client = await pool.connect();
  try {
    // read agent_condition from request body, default to 'baseline'
    const body = await request.json().catch(() => ({}))
    const agentCondition = body.agent_condition ?? 'baseline'

    const totalRounds = 5;
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();

    const roundEndpoints = generateRoundEndpoints();
    const origin = roundEndpoints[0][0];
    const destination = roundEndpoints[0][1];

    await client.query("BEGIN");

    // Create room — now includes agent_condition
    await client.query(`
      INSERT INTO game_rooms (id, status, current_round, total_rounds, current_origin, current_destination, agent_condition)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [roomId, "waiting", 1, totalRounds, origin, destination, agentCondition]);

    // Insert round endpoints
    for (let i = 0; i < roundEndpoints.length; i++) {
      await client.query(`
        INSERT INTO room_endpoints (room_id, round, origin, destination)
        VALUES ($1, $2, $3, $4)
      `, [roomId, i + 1, roundEndpoints[i][0], roundEndpoints[i][1]]);
    }

    // Insert edges
    const edges = generateEdges();
    for (const edge of edges) {
      await client.query(`
        INSERT INTO traffic_edges (id, room_id, from_node, to_node, free_time, capacity, base_flow, current_flow, travel_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        `${roomId}_${edge.id}`,
        roomId,
        edge.from,
        edge.to,
        edge.freeTime,
        edge.capacity,
        edge.baseFlow,
        edge.flow,
        bprTime(edge.freeTime, edge.baseFlow, edge.capacity),
      ]);
    }

    await client.query("COMMIT");

    return NextResponse.json({ status: "success", room_id: roomId });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating room:", error);
    return NextResponse.json({ status: "error", message: "Failed to create room" }, { status: 500 });
  } finally {
    client.release();
  }
}