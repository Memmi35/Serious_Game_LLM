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
    const chosenRoute = data.chosen_route as string;
    const decisionLatency = (data.decision_latency as number) || 0;

    if (!sessionId) {
      return NextResponse.json(
        { status: "error", message: "Session ID required" },
        { status: 400 }
      );
    }

    // Get current session
    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { status: "error", message: "Session not found" },
        { status: 400 }
      );
    }

    if (session.is_complete) {
      return NextResponse.json(
        { status: "error", message: "Simulation completed" },
        { status: 400 }
      );
    }

    const gridSize = session.grid_size;
    const nodes = generateNodes();

    // Load current edges from database
    const { data: dbEdges, error: edgesError } = await supabase
      .from("traffic_edges")
      .select("*");

    if (edgesError) throw edgesError;

    let edges = dbEdges.map((e) => ({
      id: e.id,
      from: e.from_node,
      to: e.to_node,
      freeTime: e.free_time,
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: e.travel_time,
    }));

    // Find current routes
    const routes = findRoutes(edges, session.current_origin, session.current_destination);
    const selectedRouteData = routes[chosenRoute];

    if (!selectedRouteData) {
      return NextResponse.json(
        { status: "error", message: "Invalid route selection" },
        { status: 400 }
      );
    }

    // Store predicted time before flow update
    const predictedTime = selectedRouteData.totalTravelTime;

    // We do NOT reset flows here so that traffic accumulates dynamically 
    // round over round, making the grid become progressively more congested.

    // Add flow to the chosen route's edges
    for (let i = 0; i < selectedRouteData.path.length - 1; i++) {
      const fromNode = selectedRouteData.path[i];
      const toNode = selectedRouteData.path[i + 1];
      
      const edgeIndex = edges.findIndex(
        (e) => (e.from === fromNode && e.to === toNode) || 
               (e.from === toNode && e.to === fromNode)
      );
      
      if (edgeIndex !== -1) {
        edges[edgeIndex].flow += 1;
      }
    }

    // Recompute travel times using ML model (with BPR fallback)
    try {
      const mlPredictions = await predictTravelTimeML(edges);
      edges = edges.map((edge, index) => ({
        ...edge,
        travelTime: mlPredictions[index],
      }));
    } catch {
      // Fallback to BPR formula
      edges = edges.map((edge) => ({
        ...edge,
        travelTime: computeTravelTime(edge.freeTime, edge.flow, edge.capacity),
      }));
    }

    // Update edges in database
    const edgeUpdates = edges.map((edge) => ({
      id: edge.id,
      from_node: edge.from,
      to_node: edge.to,
      free_time: edge.freeTime,
      capacity: edge.capacity,
      base_flow: edge.baseFlow,
      current_flow: edge.flow,
      travel_time: edge.travelTime,
      updated_at: new Date().toISOString(),
    }));

    for (const update of edgeUpdates) {
      const { error: updateError } = await supabase
        .from("traffic_edges")
        .update({
          current_flow: update.current_flow,
          travel_time: update.travel_time,
          updated_at: update.updated_at,
        })
        .eq("id", update.id);
      
      if (updateError) throw updateError;
    }

    // Calculate realized time (after flow update)
    let realizedTime = 0;
    for (let i = 0; i < selectedRouteData.path.length - 1; i++) {
      const fromNode = selectedRouteData.path[i];
      const toNode = selectedRouteData.path[i + 1];
      const edge = edges.find(
        (e) => (e.from === fromNode && e.to === toNode) || 
               (e.from === toNode && e.to === fromNode)
      );
      if (edge) realizedTime += edge.travelTime;
    }

    // Compute realized times for all routes
    const realizedTimes: Record<string, number> = {};
    for (const [name, route] of Object.entries(routes)) {
      let totalTime = 0;
      for (let i = 0; i < route.path.length - 1; i++) {
        const fromNode = route.path[i];
        const toNode = route.path[i + 1];
        const edge = edges.find(
          (e) => (e.from === fromNode && e.to === toNode) || 
                 (e.from === toNode && e.to === fromNode)
        );
        if (edge) totalTime += edge.travelTime;
      }
      realizedTimes[name] = Math.round(totalTime * 100) / 100;
    }

    // Compute route flows
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

    // Log the round
    const { error: logError } = await supabase
      .from("round_logs")
      .insert({
        session_id: sessionId,
        round: session.current_round,
        user_id: session.user_id,
        origin: session.current_origin,
        destination: session.current_destination,
        chosen_route: chosenRoute,
        decision_latency: Math.round(decisionLatency * 100) / 100,
        predicted_time: Math.round(predictedTime * 100) / 100,
        realized_time: Math.round(realizedTime * 100) / 100,
        route_a_flow: routeFlows["Route A"] || 0,
        route_b_flow: routeFlows["Route B"] || 0,
        route_c_flow: routeFlows["Route C"] || 0,
        route_path: selectedRouteData.path,
        route_edges: selectedRouteData.edges,
        grid_size: gridSize,
      });

    if (logError) throw logError;

    // Prepare result
    const roundResult: Record<string, unknown> = {
      round: session.current_round,
      chosen_route: chosenRoute,
      chosen_route_path: selectedRouteData.path,
      predicted_time: Math.round(predictedTime * 100) / 100,
      realized_time: Math.round(realizedTime * 100) / 100,
      realized_times: realizedTimes,
      grid_size: gridSize,
      origin: session.current_origin,
      destination: session.current_destination,
      route_flows: routeFlows,
    };

    // Check if simulation is complete
    const isComplete = session.current_round >= session.total_rounds;

    if (!isComplete) {
      // Get next round endpoints
      const { data: nextEndpoint, error: nextError } = await supabase
        .from("round_endpoints")
        .select("*")
        .eq("session_id", sessionId)
        .eq("round", session.current_round + 1)
        .single();

      if (nextError) throw nextError;

      // Update session for next round
      const { error: updateSessionError } = await supabase
        .from("simulation_sessions")
        .update({
          current_round: session.current_round + 1,
          current_origin: nextEndpoint.origin,
          current_destination: nextEndpoint.destination,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (updateSessionError) throw updateSessionError;

      // Find routes for next round
      const nextRoutes = findRoutes(edges, nextEndpoint.origin, nextEndpoint.destination);

      // Prepare network data for next round
      const networkNodes = nodes.map((node) => ({
        id: node.id,
        label: node.label,
        x: node.x * 100,
        y: node.y * 100,
        is_origin: node.id === nextEndpoint.origin,
        is_destination: node.id === nextEndpoint.destination,
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

      const routesData: Record<string, { path: string[]; length: number; predicted_time: number; total_free_time: number }> = {};
      for (const [name, route] of Object.entries(nextRoutes)) {
        routesData[name] = {
          path: route.path,
          length: route.path.length - 1,
          predicted_time: route.totalTravelTime,
          total_free_time: route.totalFreeTime,
        };
      }

      const nextPredictedTimes: Record<string, number> = {};
      for (const [name, route] of Object.entries(nextRoutes)) {
        nextPredictedTimes[name] = Math.round(route.totalTravelTime * 100) / 100;
      }

      roundResult.network = { nodes: networkNodes, edges: networkEdges };
      roundResult.routes = routesData;
      roundResult.next_predictions = nextPredictedTimes;
      roundResult.next_origin = nextEndpoint.origin;
      roundResult.next_destination = nextEndpoint.destination;
    } else {
      // Mark simulation as complete
      const { error: completeError } = await supabase
        .from("simulation_sessions")
        .update({
          is_complete: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (completeError) throw completeError;
    }

    return NextResponse.json({
      status: "success",
      round_result: roundResult,
      simulation_complete: isComplete,
    });
  } catch (error) {
    console.error("Error processing choice:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to process choice" },
      { status: 500 }
    );
  }
}
