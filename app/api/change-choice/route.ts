import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { findRoutes, bprTime } from "@/lib/traffic-simulation";

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const sessionId = data.session_id as string;
    const newRoute = data.new_route as string;

    if (!sessionId || !newRoute) {
      return NextResponse.json({ status: "error", message: "Session ID and new route required" }, { status: 400 });
    }

    // Get session + room
    const sessionResult = await pool.query(`
      SELECT s.*, row_to_json(g.*) as game_rooms
      FROM simulation_sessions s
      JOIN game_rooms g ON s.room_id = g.id
      WHERE s.id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return NextResponse.json({ status: "error", message: "Session not found" }, { status: 400 });
    }

    const session = sessionResult.rows[0];
    const room = session.game_rooms;

    if (!session.has_submitted) {
      return NextResponse.json({ status: "error", message: "You must submit a choice first" }, { status: 400 });
    }

    // Get current round log
    const logResult = await pool.query(`
      SELECT id, chosen_route FROM round_logs
      WHERE session_id = $1 AND round = $2
    `, [sessionId, room.current_round]);

    if (logResult.rows.length === 0) {
      return NextResponse.json({ status: "error", message: "No choice found for current round" }, { status: 400 });
    }

    const currentLog = logResult.rows[0];

    if (currentLog.chosen_route === newRoute) {
      return NextResponse.json({ status: "success", message: "No change needed" });
    }

    const origin = room.current_origin;
    const destination = room.current_destination;

    // Load edges
    const edgesResult = await pool.query(`
      SELECT * FROM traffic_edges WHERE room_id = $1
    `, [room.id]);

    const edges = edgesResult.rows.map((e) => ({
      id: e.id.replace(`${room.id}_`, ""),
      from: e.from_node,
      to: e.to_node,
      freeTime: parseFloat(e.free_time),
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: parseFloat(e.travel_time),
    }));

    const routes = findRoutes(edges, origin, destination);
    const newRouteData = routes[newRoute];

    if (!newRouteData) {
      return NextResponse.json({ status: "error", message: "Invalid route selection" }, { status: 400 });
    }

    // Predicted time = BPR with baseFlow + 1
    let predictedTime = 0;
    for (let i = 0; i < newRouteData.path.length - 1; i++) {
      const fromNode = newRouteData.path[i];
      const toNode = newRouteData.path[i + 1];
      const edge = edges.find(
        (e) => (e.from === fromNode && e.to === toNode) ||
               (e.from === toNode && e.to === fromNode)
      );
      if (edge) predictedTime += bprTime(edge.freeTime, edge.baseFlow + 1, edge.capacity);
    }
    predictedTime = Math.round(predictedTime * 100) / 100;

    // Route flows
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

    // Update round log
    await pool.query(`
      UPDATE round_logs SET
        chosen_route = $1,
        predicted_time = $2,
        realized_time = $3,
        route_a_flow = $4,
        route_b_flow = $5,
        route_c_flow = $6,
        route_path = $7,
        route_edges = $8
      WHERE id = $9
    `, [
      newRoute,
      predictedTime,
      0,
      routeFlows["Route A"] || 0,
      routeFlows["Route B"] || 0,
      routeFlows["Route C"] || 0,
      newRouteData.path,
      JSON.stringify(newRouteData.edges),
      currentLog.id,
    ]);

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