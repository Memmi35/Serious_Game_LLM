import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateNodes,
  findRoutes,
  computeTravelTime,
  predictTravelTimeML,
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

    // Get the player's current round log to find their previous choice
    const { data: currentLog, error: logError } = await supabase
      .from("round_logs")
      .select("*")
      .eq("session_id", sessionId)
      .eq("round", room.current_round)
      .single();

    if (logError || !currentLog) {
      return NextResponse.json({ status: "error", message: "No choice found for current round" }, { status: 400 });
    }

    const previousRoute = currentLog.chosen_route;

    // If the new route is the same as the current one, no change needed
    if (previousRoute === newRoute) {
      return NextResponse.json({ status: "success", message: "No change needed - same route selected" });
    }

    const origin = room.current_origin;
    const destination = room.current_destination;

    // Load current shared edges
    const { data: dbEdges, error: edgesError } = await supabase
      .from("traffic_edges")
      .select("*")
      .eq("room_id", room.id);
    if (edgesError) throw edgesError;

    let edges = (dbEdges ?? []).map((e) => ({
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
    const previousRouteData = routes[previousRoute];
    const newRouteData = routes[newRoute];

    if (!newRouteData) {
      return NextResponse.json({ status: "error", message: "Invalid route selection" }, { status: 400 });
    }

    // Decrement flow on the previous route edges
    if (previousRouteData) {
      for (let i = 0; i < previousRouteData.path.length - 1; i++) {
        const fromNode = previousRouteData.path[i];
        const toNode = previousRouteData.path[i + 1];
        const edge = edges.find((e) => {
          const stripped = e.id.replace(`${room.id}_`, "");
          const match = displayEdges.find(
            (d) => d.id === stripped &&
              ((d.from === fromNode && d.to === toNode) ||
               (d.from === toNode && d.to === fromNode))
          );
          return !!match;
        });
        if (edge) {
          await supabase.rpc("increment_edge_flow", {
            edge_id: edge.id,
            increment_by: -1,
          });
        }
      }
    }

    // Increment flow on the new route edges
    for (let i = 0; i < newRouteData.path.length - 1; i++) {
      const fromNode = newRouteData.path[i];
      const toNode = newRouteData.path[i + 1];
      const edge = edges.find((e) => {
        const stripped = e.id.replace(`${room.id}_`, "");
        const match = displayEdges.find(
          (d) => d.id === stripped &&
            ((d.from === fromNode && d.to === toNode) ||
             (d.from === toNode && d.to === fromNode))
        );
        return !!match;
      });
      if (edge) {
        await supabase.rpc("increment_edge_flow", {
          edge_id: edge.id,
          increment_by: 1,
        });
      }
    }

    // Re-fetch edges to get true state after atomic increments
    const { data: freshDbEdges } = await supabase
      .from("traffic_edges")
      .select("*")
      .eq("room_id", room.id);

    edges = (freshDbEdges ?? []).map((e) => ({
      id: e.id,
      from: e.from_node,
      to: e.to_node,
      freeTime: e.free_time,
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: e.travel_time,
    }));

    // Recompute travel times
    try {
      const mlPredictions = await predictTravelTimeML(edges);
      edges = edges.map((edge, index) => ({ ...edge, travelTime: mlPredictions[index] }));
    } catch {
      edges = edges.map((edge) => ({
        ...edge,
        travelTime: computeTravelTime(edge.freeTime, edge.flow, edge.capacity),
      }));
    }

    // Write updated travel times back
    for (const edge of edges) {
      await supabase
        .from("traffic_edges")
        .update({ travel_time: edge.travelTime, updated_at: new Date().toISOString() })
        .eq("id", edge.id);
    }

    // Calculate realized time for new route
    const strippedEdges = edges.map((e) => ({ ...e, id: e.id.replace(`${room.id}_`, "") }));
    let realizedTime = 0;
    for (let i = 0; i < newRouteData.path.length - 1; i++) {
      const fromNode = newRouteData.path[i];
      const toNode = newRouteData.path[i + 1];
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

    // Update the round log with the new choice
    await supabase
      .from("round_logs")
      .update({
        chosen_route: newRoute,
        predicted_time: Math.round(newRouteData.totalTravelTime * 100) / 100,
        realized_time: Math.round(realizedTime * 100) / 100,
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
        predicted_time: Math.round(newRouteData.totalTravelTime * 100) / 100,
        realized_time: Math.round(realizedTime * 100) / 100,
        realized_times: realizedTimes,
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
