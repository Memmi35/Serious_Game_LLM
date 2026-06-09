import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  findRoutes,
} from "@/lib/traffic-simulation";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const data = await request.json();
    const sessionId = data.session_id as string;
    const newRoute = data.new_route as string;

    if (!sessionId || !newRoute) {
      return NextResponse.json({ status: "error", message: "Session ID and new route required" }, { status: 400 });
    }

    // Fetch session and room in one query
    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .select("*, game_rooms(*)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ status: "error", message: "Session not found" }, { status: 400 });
    }

    if (!session.has_submitted) {
      return NextResponse.json({ status: "error", message: "You must submit a choice first" }, { status: 400 });
    }

    const room = session.game_rooms;

    // Get the player's current round log
    const { data: currentLog, error: logError } = await supabase
      .from("round_logs")
      .select("id, chosen_route")
      .eq("session_id", sessionId)
      .eq("round", room.current_round)
      .single();

    if (logError || !currentLog) {
      return NextResponse.json({ status: "error", message: "No choice found for current round" }, { status: 400 });
    }

    // If same route, return early
    if (currentLog.chosen_route === newRoute) {
      return NextResponse.json({ status: "success", message: "No change needed" });
    }

    const origin = room.current_origin;
    const destination = room.current_destination;

    // Load edges once
    const { data: dbEdges } = await supabase
      .from("traffic_edges")
      .select("*")
      .eq("room_id", room.id);

    const edges = (dbEdges ?? []).map((e) => ({
      id: e.id.replace(`${room.id}_`, ""),
      from: e.from_node,
      to: e.to_node,
      freeTime: e.free_time,
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: e.travel_time,
    }));

    const routes = findRoutes(edges, origin, destination);
    const newRouteData = routes[newRoute];

    if (!newRouteData) {
      return NextResponse.json({ status: "error", message: "Invalid route selection" }, { status: 400 });
    }

// Predicted time = BPR with flow+1 (consistent with make-choice)
    const { bprTime } = await import("@/lib/traffic-simulation");
    let predictedTime = 0;
    for (let i = 0; i < newRouteData.path.length - 1; i++) {
      const fromNode = newRouteData.path[i];
      const toNode = newRouteData.path[i + 1];
      const edge = edges.find(
        (e) => (e.from === fromNode && e.to === toNode) ||
               (e.from === toNode && e.to === fromNode)
      );
if (edge) predictedTime += bprTime(edge.freeTime, edge.baseFlow + 1, edge.capacity);    }
    predictedTime = Math.round(predictedTime * 100) / 100;

    const routeFlows: Record<string, number> = {};
    for (const [name, route] of Object.entries(routes)) {
      let totalFlow = 0;
      for (let i = 0; i < route.path.length - 1; i++) {
        const fromNode = route.path[i];
        const toNode = route.path[i + 1];
        const edge = edges.find(
          (e) => (e.from === fromNode && e.to === toNode) ||
                 (e.from === toNode && e.to === fromNode)
        );
        if (edge) totalFlow += edge.flow;
      }
      routeFlows[name] = Math.round(totalFlow * 100) / 100;
    }

    // Update the round log with the new choice (single DB call)
    await supabase
      .from("round_logs")
      .update({
        chosen_route: newRoute,
        predicted_time: predictedTime,
              realized_time: 0,
        route_a_flow: routeFlows["Route A"] || 0,
        route_b_flow: routeFlows["Route B"] || 0,
        route_c_flow: routeFlows["Route C"] || 0,
        route_path: newRouteData.path,
        route_edges: newRouteData.edges,
      })
      .eq("id", currentLog.id);

    return NextResponse.json({
      status: "success",
      round_result: {
        round: room.current_round,
        chosen_route: newRoute,
        chosen_route_path: newRouteData.path,
        predicted_time: predictedTime,
        realized_time: 0,
        origin,
        destination,
        route_flows: routeFlows,
      },
    });
  } catch (error) {
    console.error("Error changing choice:", error);
    return NextResponse.json({ status: "error", message: "Failed to change choice" }, { status: 500 });
  }
}
