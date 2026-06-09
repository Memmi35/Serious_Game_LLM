import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  const client = await pool.connect();
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    let logs;

    if (sessionId) {
      // Get logs for specific session
      const result = await client.query(
        "SELECT * FROM round_logs WHERE session_id = $1 ORDER BY round ASC",
        [sessionId]
      );
      logs = result.rows;
    } else {
      // Get all logs
      const result = await client.query(
        "SELECT * FROM round_logs ORDER BY created_at ASC"
      );
      logs = result.rows;
    }

    if (!logs || logs.length === 0) {
      return NextResponse.json(
        { status: "error", message: "No simulation data found" },
        { status: 400 }
      );
    }

    // Generate CSV content
    const headers = [
      "round",
      "user_id",
      "chosen_route",
      "decision_latency",
      "predicted_time",
      "realized_time",
      "route_A_flow",
      "route_B_flow",
      "route_C_flow",
      "grid_size",
      "origin",
      "destination",
      "route_path",
    ];

    const rows = logs.map((log) => {
      // Handle formatting arrays into clean readable CSV strings safely
      let pathStr = "";
      if (log.route_path) {
        const parsedPath = typeof log.route_path === "string" 
          ? JSON.parse(log.route_path) 
          : log.route_path;
        if (Array.isArray(parsedPath)) {
          pathStr = parsedPath.join("->");
        }
      }

      return [
        log.round,
        `"${log.user_id || ""}"`, // Wrap user string profiles in quotes
        `"${log.chosen_route || ""}"`,
        log.decision_latency ?? 0,
        log.predicted_time ?? "",
        log.realized_time ?? "",
        log.route_a_flow ?? 0,
        log.route_b_flow ?? 0,
        log.route_c_flow ?? 0,
        log.grid_size ?? 5,
        `"${log.origin || ""}"`,
        `"${log.destination || ""}"`,
        `"${pathStr}"`, // Escape commas inside arrows if any exist
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");

    // Return CSV as downloadable file asset
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=simulation_logs_${new Date().toISOString().split('T')[0]}.csv`,
      },
    });
  } catch (error) {
    console.error("Error downloading logs from Neon:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to compile log sheets" },
      { status: 500 }
    );
  } finally {
    // Return connection to pool instantly
    client.release();
  }
}