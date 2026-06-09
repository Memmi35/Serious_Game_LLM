import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  const client = await pool.connect();
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    let logs;

    if (!sessionId) {
      // Return all logs if no session specified
      const result = await client.query(
        "SELECT * FROM round_logs ORDER BY created_at ASC"
      );
      logs = result.rows;
    } else {
      // Return logs for specific session
      const result = await client.query(
        "SELECT * FROM round_logs WHERE session_id = $1 ORDER BY round ASC",
        [sessionId]
      );
      logs = result.rows;
    }

    return NextResponse.json({
      status: "success",
      logs: logs.map((log) => ({
        round: log.round,
        user_id: log.user_id,
        chosen_route: log.chosen_route,
        decision_latency: log.decision_latency,
        // != null fix: ensures if time is 0, it won't mistakenly fall back to null
        predicted_time: log.predicted_time != null ? Number(log.predicted_time) : null,
        realized_time: log.realized_time != null ? Number(log.realized_time) : null,
        route_A_flow: log.route_a_flow,
        route_B_flow: log.route_b_flow,
        route_C_flow: log.route_c_flow,
        grid_size: log.grid_size,
        origin: log.origin,
        destination: log.destination,
        // Handles automated array parsing or parsing JSON strings if stored as text rows
        route_path: typeof log.route_path === "string" ? JSON.parse(log.route_path) : log.route_path,
        route_edges: typeof log.route_edges === "string" ? JSON.parse(log.route_edges) : log.route_edges,
      })),
    });
  } catch (error) {
    console.error("Error getting logs from Neon:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to get logs" },
      { status: 500 }
    );
  } finally {
    // Crucial for Neon connection pooling: release the client back to the pool
    client.release();
  }
}