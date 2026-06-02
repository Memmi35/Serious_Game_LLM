import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateNodes, findRoutes } from "@/lib/traffic-simulation";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const sessionId = request.nextUrl.searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json({ status: "not_initialized", current_round: 0 });
    }

    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .select("*, game_rooms(*)")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ status: "not_initialized", current_round: 0 });
    }

    const room = session.game_rooms;

    if (room.status === "waiting") {
      return NextResponse.json({
        status: "waiting",
        room_id: room.id,
        message: "Waiting for admin to start the game.",
      });
    }

    if (session.has_submitted && room.status !== "completed") {
      // Fetch player's round log and choice distribution for the waiting state
      const { data: playerLog } = await supabase
        .from("round_logs")
        .select("*")
        .eq("session_id", sessionId)
        .eq("round", room.current_round)
        .single();

      // Get all choices for this round to show distribution
      const { data: allLogs } = await supabase
        .from("round_logs")
        .select("chosen_route")
        .eq("round", room.current_round)
        .in("session_id", 
          (await supabase
            .from("simulation_sessions")
            .select("id")
            .eq("room_id", room.id))
            .data?.map(s => s.id) || []
        );

      const distribution: Record<string, number> = {};
      const totalPlayers = allLogs?.length || 0;
      allLogs?.forEach(log => {
        distribution[log.chosen_route] = (distribution[log.chosen_route] || 0) + 1;
      });

      // Get network data for displaying routes
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

      const nodes = generateNodes();
      const routes = findRoutes(edges, room.current_origin, room.current_destination);

      const routesData: Record<string, { path: string[]; length: number; predicted_time: number; total_free_time: number }> = {};
      const predictedTimes: Record<string, number> = {};
      for (const [name, route] of Object.entries(routes)) {
        routesData[name] = {
          path: route.path,
          length: route.path.length - 1,
          predicted_time: route.totalTravelTime,
          total_free_time: route.totalFreeTime,
        };
        predictedTimes[name] = Math.round(route.totalTravelTime * 100) / 100;
      }

      const networkNodes = nodes.map((node) => ({
        id: node.id,
        label: node.label,
        x: node.x * 100,
        y: node.y * 100,
        is_origin: node.id === room.current_origin,
        is_destination: node.id === room.current_destination,
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

      return NextResponse.json({
        status: "submitted_waiting",
        room_id: room.id,
        session_id: sessionId,
        current_round: room.current_round,
        num_rounds: room.total_rounds,
        message: "Choice submitted. Waiting for all players and admin to advance.",
        player_choice: playerLog?.chosen_route || null,
        player_realized_time: playerLog?.realized_time || null,
        choice_distribution: distribution,
        total_submitted: totalPlayers,
        predicted_times: predictedTimes,
        network: { nodes: networkNodes, edges: networkEdges },
        routes: routesData,
        origin: room.current_origin,
        destination: room.current_destination,
      });
    }

    // All state comes from the room, not the session
    const origin = room.current_origin;
    const destination = room.current_destination;
    const nodes = generateNodes();

    const { data: dbEdges, error: edgesError } = await supabase
      .from("traffic_edges")
      .select("*")
      .eq("room_id", room.id);
    if (edgesError) throw edgesError;

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

    const { data: dbLogs } = await supabase
      .from("round_logs")
      .select("*")
      .eq("session_id", sessionId)
      .order("round", { ascending: true });

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

    const routesData: Record<string, { path: string[]; length: number; predicted_time: number; total_free_time: number }> = {};
    const predictedTimes: Record<string, number> = {};
    for (const [name, route] of Object.entries(routes)) {
      routesData[name] = {
        path: route.path,
        length: route.path.length - 1,
        predicted_time: route.totalTravelTime,
        total_free_time: route.totalFreeTime,
      };
      predictedTimes[name] = Math.round(route.totalTravelTime * 100) / 100;
    }

    return NextResponse.json({
      status: "initialized",
      session_id: sessionId,
      current_round: room.current_round,
      num_rounds: room.total_rounds,
      predicted_times: predictedTimes,
      network: { nodes: networkNodes, edges: networkEdges },
      routes: routesData,
      logs: dbLogs ?? [],
      origin,
      destination,
      game_over: room.status === "completed",
      room_status: room.status,
    });
  } catch (error) {
    console.error("Error getting state:", error);
    return NextResponse.json({ status: "error", message: "Failed to get state" }, { status: 500 });
  }
}
