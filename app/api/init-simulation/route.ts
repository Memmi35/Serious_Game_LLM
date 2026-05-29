import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  generateNodes,
  generateEdges,
  generateRoundEndpoints,
  findRoutes,
} from "@/lib/traffic-simulation";

export async function POST() {
  try {
    const supabase = await createClient();
    const gridSize = 5;
    const totalRounds = 5;
    
    // Generate a unique user ID for this session
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate nodes
    const nodes = generateNodes();
    
    // Check if traffic_edges table is empty, if so initialize with default edges
    const { data: existingEdges, error: checkError } = await supabase
      .from("traffic_edges")
      .select("id")
      .limit(1);
    
    if (checkError) throw checkError;
    
    let edges;
    
    if (!existingEdges || existingEdges.length === 0) {
      // Initialize edges in the database
      edges = generateEdges();
      
      const edgeInserts = edges.map((edge) => ({
        id: edge.id,
        from_node: edge.from,
        to_node: edge.to,
        free_time: edge.freeTime,
        capacity: edge.capacity,
        base_flow: edge.baseFlow,
        current_flow: edge.flow,
        travel_time: edge.travelTime,
      }));
      
      const { error: insertError } = await supabase
        .from("traffic_edges")
        .insert(edgeInserts);
      
      if (insertError) throw insertError;
    } else {
      // Load existing edges from database
      const { data: dbEdges, error: loadError } = await supabase
        .from("traffic_edges")
        .select("*");
      
      if (loadError) throw loadError;
      
      edges = dbEdges.map((e) => ({
        id: e.id,
        from: e.from_node,
        to: e.to_node,
        freeTime: e.free_time,
        capacity: e.capacity,
        baseFlow: e.base_flow,
        flow: e.current_flow,
        travelTime: e.travel_time,
      }));
    }
    
    // Generate round endpoints (pre-defined origin-destination pairs)
    const roundEndpoints = generateRoundEndpoints();
    const origin = roundEndpoints[0][0];
    const destination = roundEndpoints[0][1];
    
    // Create session in database
    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .insert({
        user_id: userId,
        current_round: 1,
        total_rounds: totalRounds,
        grid_size: gridSize,
        is_complete: false,
        current_origin: origin,
        current_destination: destination,
      })
      .select()
      .single();
    
    if (sessionError) throw sessionError;
    
    // Store round endpoints
    const endpointInserts = roundEndpoints.map((ep, index) => ({
      session_id: session.id,
      round: index + 1,
      origin: ep[0],
      destination: ep[1],
    }));
    
    const { error: endpointsError } = await supabase
      .from("round_endpoints")
      .insert(endpointInserts);
    
    if (endpointsError) throw endpointsError;
    
    // Find routes for the first round
    const routes = findRoutes(edges, origin, destination);
    
    // Calculate predicted times
    const predictedTimes: Record<string, number> = {};
    for (const [name, route] of Object.entries(routes)) {
      predictedTimes[name] = Math.round(route.totalTravelTime * 100) / 100;
    }
    
    // Prepare network data for visualization
    const networkNodes = nodes.map((node) => ({
      id: node.id,
      label: node.label,
      x: node.x * 100,
      y: node.y * 100,
      is_origin: node.id === origin,
      is_destination: node.id === destination,
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

    return NextResponse.json({
      status: "success",
      session_id: session.id,
      user_id: userId,
      grid_size: gridSize,
      num_rounds: totalRounds,
      network: { nodes: networkNodes, edges: networkEdges },
      routes: routesData,
      current_round: 1,
      predicted_times: predictedTimes,
      origin,
      destination,
    });
  } catch (error) {
    console.error("Error initializing simulation:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to initialize simulation" },
      { status: 500 }
    );
  }
}
