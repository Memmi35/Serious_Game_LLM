import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateNodes,
  findRoutes,
  computeTravelTime,
} from "@/lib/traffic-simulation";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const data = await request.json();
    const sessionId = data.session_id as string;
    const chosenRoute = data.chosen_route as string;
    const decisionLatency = (data.decision_latency as number) || 0;

    if (!sessionId) {
      return NextResponse.json({ status: "error", message: "Session ID required" }, { status: 400 });
    }

    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .select("*, game_rooms(*)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ status: "error", message: "Session not found" }, { status: 400 });
    }

    if (session.has_submitted) {
      return NextResponse.json({ status: "error", message: "Already submitted for this round" }, { status: 400 });
    }

    const room = session.game_rooms;
    const origin = room.current_origin;
    const destination = room.current_destination;

    // Load current shared edges
    const { data: dbEdges, error: edgesError } = await supabase
      .from("traffic_edges")
      .select("*")
      .eq("room_id", room.id);
    if (edgesError) throw edgesError;

    const edges = (dbEdges ?? []).map((e) => ({
      id: e.id,
      from: e.from_node,
      to: e.to_node,
      freeTime: e.free_time,
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: e.travel_time,
    }));

    const displayEdges = edges.map((e) => ({
      ...e,
      id: e.id.replace(`${room.id}_`, ""),
    }));

    const routes = findRoutes(displayEdges, origin, destination);
    const selectedRouteData = routes[chosenRoute];

    if (!selectedRouteData) {
      return NextResponse.json({ status: "error", message: "Invalid route selection" }, { status: 400 });
    }

    // Use current predicted time (based on current flow state - same for all users)
    const predictedTime = selectedRouteData.totalTravelTime;

    // Calculate realized time based on CURRENT edge state (not incrementing flow yet)
    // This ensures all users who select before admin advances see the same predicted times
    const strippedEdges = edges.map((e) => ({ ...e, id: e.id.replace(`${room.id}_`, "") }));
    let realizedTime = 0;
    for (let i = 0; i < selectedRouteData.path.length - 1; i++) {
      const fromNode = selectedRouteData.path[i];
      const toNode = selectedRouteData.path[i + 1];
      const edge = strippedEdges.find(
        (e) => (e.from === fromNode && e.to === toNode) ||
               (e.from === toNode && e.to === fromNode)
      );
      if (edge) realizedTime += edge.travelTime;
    }

    const realizedTimes: Record<string, number> = {};
    const routeFlows: Record<string, number> = {};
    for (const [name, route] of Object.entries(routes)) {
      let totalTime = 0;
      let totalFlow = 0;
      for (let i = 0; i < route.path.length - 1; i++) {
        const fromNode = route.path[i];
        const toNode = route.path[i + 1];
        const edge = strippedEdges.find(
          (e) => (e.from === fromNode && e.to === toNode) ||
                 (e.from === toNode && e.to === fromNode)
        );
        if (edge) { totalTime += edge.travelTime; totalFlow += edge.flow; }
      }
      realizedTimes[name] = Math.round(totalTime * 100) / 100;
      routeFlows[name] = Math.round(totalFlow * 100) / 100;
    }

    // Log the round (store the choice, flow updates happen when admin advances round)
    await supabase.from("round_logs").insert({
      session_id: sessionId,
      round: room.current_round,
      user_id: session.user_id,
      origin,
      destination,
      chosen_route: chosenRoute,
      decision_latency: Math.round(decisionLatency * 100) / 100,
      predicted_time: Math.round(predictedTime * 100) / 100,
      realized_time: Math.round(realizedTime * 100) / 100,
      route_a_flow: routeFlows["Route A"] || 0,
      route_b_flow: routeFlows["Route B"] || 0,
      route_c_flow: routeFlows["Route C"] || 0,
      route_path: selectedRouteData.path,
      route_edges: selectedRouteData.edges,
      grid_size: session.grid_size,
    });

    // Mark this user as submitted — do NOT advance round or update flows
    await supabase
      .from("simulation_sessions")
      .update({ has_submitted: true, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    return NextResponse.json({
      status: "success",
      round_result: {
        round: room.current_round,
        chosen_route: chosenRoute,
        chosen_route_path: selectedRouteData.path,
        predicted_time: Math.round(predictedTime * 100) / 100,
        realized_time: Math.round(realizedTime * 100) / 100,
        realized_times: realizedTimes,
        origin,
        destination,
        route_flows: routeFlows,
      },
      simulation_complete: room.status === "completed",
    });
  } catch (error) {
    console.error("Error processing choice:", error);
    return NextResponse.json({ status: "error", message: "Failed to process choice" }, { status: 500 });
  }
}
