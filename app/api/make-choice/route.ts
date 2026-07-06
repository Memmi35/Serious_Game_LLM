import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { findRoutes, bprTime } from "@/lib/traffic-simulation";

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const sessionId = data.session_id as string;
    const chosenRoute = data.chosen_route as string;
    const decisionLatency = (data.decision_latency as number) || 0;

    if (!sessionId) {
      return NextResponse.json({ status: "error", message: "Session ID required" }, { status: 400 });
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

    if (session.has_submitted) {
      return NextResponse.json({ status: "error", message: "Already submitted for this round" }, { status: 400 });
    }

    const origin = room.current_origin;
    const destination = room.current_destination;

    // Load edges
    const edgesResult = await pool.query(`
      SELECT * FROM traffic_edges WHERE room_id = $1
    `, [room.id]);

    const edges = edgesResult.rows.map((e) => ({
      id: e.id,
      from: e.from_node,
      to: e.to_node,
      freeTime: parseFloat(e.free_time),
      capacity: e.capacity,
      baseFlow: e.base_flow,
      flow: e.current_flow,
      travelTime: parseFloat(e.travel_time),
    }));

    const strippedEdges = edges.map((e) => ({
      ...e,
      id: e.id.replace(`${room.id}_`, ""),
    }));

    const routes = findRoutes(strippedEdges, origin, destination);
    const selectedRouteData = routes[chosenRoute];

    if (!selectedRouteData) {
      return NextResponse.json({ status: "error", message: "Invalid route selection" }, { status: 400 });
    }

    // Predicted time = BPR with baseFlow + 1
    let predictedTime = 0;
    for (let i = 0; i < selectedRouteData.path.length - 1; i++) {
      const fromNode = selectedRouteData.path[i];
      const toNode = selectedRouteData.path[i + 1];
      const edge = strippedEdges.find(
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
        const edge = strippedEdges.find(
          (e) => (e.from === fromNode && e.to === toNode) ||
                 (e.from === toNode && e.to === fromNode)
        );
        if (edge) totalFlow += edge.flow;
      }
      routeFlows[name] = Math.round(totalFlow * 100) / 100;
    }

    // Insert round log
    await pool.query(`
      INSERT INTO round_logs 
        (session_id, round, user_id, origin, destination, chosen_route, initial_choice, final_choice, decision_latency, predicted_time, realized_time, route_a_flow, route_b_flow, route_c_flow, route_path, route_edges, grid_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `, [
      sessionId,
      room.current_round,
      session.user_id,
      origin,
      destination,
      chosenRoute,
      chosenRoute,
      chosenRoute,
      Math.round(decisionLatency * 100) / 100,
      predictedTime,
      0,
      routeFlows["Route A"] || 0,
      routeFlows["Route B"] || 0,
      routeFlows["Route C"] || 0,
      selectedRouteData.path,
      JSON.stringify(selectedRouteData.edges),
      session.grid_size,
    ]);

    // ── COMPLIANCE LOGGING ────────────────────────────────────────────────────
    try {
      const rec = await pool.query(
        `SELECT recommended_route
         FROM agent_recommendations
         WHERE session_id = $1 AND round = $2`,
        [sessionId, room.current_round]
      )

      const recommendedRoute = rec.rows[0]?.recommended_route ?? null

      const compliance = recommendedRoute !== null
        ? (chosenRoute === recommendedRoute)
        : null

      const agentCondition = room.agent_condition ?? 'baseline'

      await pool.query(
        `UPDATE round_logs
         SET ai_recommended_route = $1,
             ai_compliance        = $2,
             agent_condition      = $3
         WHERE session_id = $4 AND round = $5`,
        [recommendedRoute, compliance, agentCondition, sessionId, room.current_round]
      )
    } catch (complianceErr) {
      // never break submission because of compliance logging
      console.error('Compliance logging error:', complianceErr)
    }
    // ── END COMPLIANCE LOGGING ────────────────────────────────────────────────

    // Mark session as submitted
    await pool.query(`
      UPDATE simulation_sessions 
      SET has_submitted = true, updated_at = now()
      WHERE id = $1
    `, [sessionId]);

    return NextResponse.json({
      status: "success",
      round_result: {
        round: room.current_round,
        chosen_route: chosenRoute,
        initial_choice: chosenRoute,
        final_choice: chosenRoute,
        chosen_route_path: selectedRouteData.path,
        predicted_time: predictedTime,
        realized_time: null,
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