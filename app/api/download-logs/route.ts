import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const sessionId = request.nextUrl.searchParams.get("session_id");

    let logs;

    if (sessionId) {
      // Get logs for specific session
      const { data, error } = await supabase
        .from("round_logs")
        .select("*")
        .eq("session_id", sessionId)
        .order("round", { ascending: true });

      if (error) throw error;
      logs = data;
    } else {
      // Get all logs
      const { data, error } = await supabase
        .from("round_logs")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;
      logs = data;
    }

    if (!logs || logs.length === 0) {
      return NextResponse.json(
        { status: "error", message: "No simulation data" },
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

    const rows = logs.map((log) =>
      [
        log.round,
        log.user_id,
        log.chosen_route,
        log.decision_latency,
        log.predicted_time,
        log.realized_time,
        log.route_a_flow,
        log.route_b_flow,
        log.route_c_flow,
        log.grid_size,
        log.origin,
        log.destination,
        log.route_path.join("->"),
      ].join(",")
    );

    const csvContent = [headers.join(","), ...rows].join("\n");

    // Return CSV as downloadable file
    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=simulation_logs_${new Date().toISOString()}.csv`,
      },
    });
  } catch (error) {
    console.error("Error downloading logs:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to download logs" },
      { status: 500 }
    );
  }
}
