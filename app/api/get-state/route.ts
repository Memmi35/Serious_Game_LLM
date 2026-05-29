import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateNodes, findRoutes } from "@/lib/traffic-simulation";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const sessionId = request.nextUrl.searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json({
        status: "not_initialized",
        current_round: 0,
      });
    }

    // Get session
    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({
        status: "not_initialized",
        current_round: 0,
      });
    }

    const gridSize = session.grid_size;
    const nodes = generateNodes(gridSize);

    // Get edges from database
    const { data: dbEdges, error: edgesError } = await supabase
      .from("traffic_edges")
      .select("*");

    if (edgesError) throw edgesError;

    const edges = dbEdges.map((e) => ({
      id: e.id,
      from: e.from_node,
      to: e.to_node,
      freeTime: e.free_time,
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: e.travel_time,
    }));

    // Find routes for current round
    const routes = findRoutes(edges, session.current_origin, session.current_destination);

    // Get logs for this session
    const { data: dbLogs, error: logsError } = await supabase
      .from("round_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("round", { ascending: true });

    if (logsError) throw logsError;

    // Prepare network data
    const networkNodes = nodes.map((node) => ({
      id: node.id,
      label: node.label,
      x: node.x * 100,
      y: node.y * 100,
      is_origin: node.id === session.current_origin,
      is_destination: node.id === session.current_destination,
    }));

    const networkEdges = edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      free_time: edge.freeTime,
      capacity: edge.capacity,
      base_flow: edge.baseFlow,
      flow: edge.flow,
      travel_time: edge.travelTime,
    }));

    // Prepare routes data
    const routesData: Record<string, { path: string[]; length: number; predicted_time: number; total_free_time: number }> = {};
    for (const [name, route] of Object.entries(routes)) {
      routesData[name] = {
        path: route.path,
        length: route.path.length - 1,
        predicted_time: route.totalTravelTime,
        total_free_time: route.totalFreeTime,
      };
    }

    // Calculate predicted times
    const predictedTimes: Record<string, number> = {};
    for (const [name, route] of Object.entries(routes)) {
      predictedTimes[name] = Math.round(route.totalTravelTime * 100) / 100;
    }

    // Format logs
    const logs = dbLogs.map((log) => ({
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
    }));

    return NextResponse.json({
      status: "initialized",
      session_id: sessionId,
      current_round: session.current_round,
      num_rounds: session.total_rounds,
      predicted_times: predictedTimes,
      network: { nodes: networkNodes, edges: networkEdges },
      routes: routesData,
      origin: session.current_origin,
      destination: session.current_destination,
      logs,
      game_over: session.is_complete,
    });
  } catch (error) {
    console.error("Error getting state:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to get state" },
      { status: 500 }
    );
  }
}
