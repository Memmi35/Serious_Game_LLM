import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const sessionId = request.nextUrl.searchParams.get("session_id");

    if (!sessionId) {
      // Return all logs if no session specified
      const { data: logs, error } = await supabase
        .from("round_logs")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) throw error;

      return NextResponse.json({
        status: "success",
        logs: logs.map((log) => ({
          round: log.round,
          user_id: log.user_id,
          chosen_route: log.chosen_route,
          decision_latency: log.decision_latency,
          predicted_time: log.predicted_time,
          realized_time: log.realized_time,
          route_A_flow: log.route_a_flow,
          route_B_flow: log.route_b_flow,
          route_C_flow: log.route_c_flow,
          grid_size: log.grid_size,
          origin: log.origin,
          destination: log.destination,
          route_path: log.route_path,
          route_edges: log.route_edges,
        })),
      });
    }

    // Return logs for specific session
    const { data: logs, error } = await supabase
      .from("round_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("round", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      status: "success",
      logs: logs.map((log) => ({
        round: log.round,
        user_id: log.user_id,
        chosen_route: log.chosen_route,
        decision_latency: log.decision_latency,
        predicted_time: log.predicted_time,
        realized_time: log.realized_time,
        route_A_flow: log.route_a_flow,
        route_B_flow: log.route_b_flow,
        route_C_flow: log.route_c_flow,
        grid_size: log.grid_size,
        origin: log.origin,
        destination: log.destination,
        route_path: log.route_path,
        route_edges: log.route_edges,
      })),
    });
  } catch (error) {
    console.error("Error getting logs:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to get logs" },
      { status: 500 }
    );
  }
}
