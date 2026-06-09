import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { generateNodes, findRoutes, bprTime } from "@/lib/traffic-simulation";

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json({ status: "not_initialized", current_round: 0 });
    }

    // Get session + room
    const sessionResult = await pool.query(`
      SELECT s.*, row_to_json(g.*) as game_rooms
      FROM simulation_sessions s
      JOIN game_rooms g ON s.room_id = g.id
      WHERE s.id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return NextResponse.json({ status: "not_initialized", current_round: 0 });
    }

    const session = sessionResult.rows[0];
    const room = session.game_rooms;

    if (room.status === "waiting") {
      return NextResponse.json({
        status: "waiting",
        room_id: room.id,
        message: "Waiting for admin to start the game.",
      });
    }

    if (session.has_submitted && room.status !== "completed") {
      // Get player's round log
      const playerLogResult = await pool.query(`
        SELECT * FROM round_logs
        WHERE session_id = $1 AND round = $2
      `, [sessionId, room.current_round]);
      const playerLog = playerLogResult.rows[0] || null;

      // Get edges
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

      // Get all sessions for this room
      const allSessionsResult = await pool.query(`
        SELECT id, has_submitted FROM simulation_sessions WHERE room_id = $1
      `, [room.id]);
      const allSessions = allSessionsResult.rows;
      const allSessionsCount = allSessions.length;
      const roomSessionIds = allSessions.map((s: any) => s.id);

      // Get room logs for this round
      const roomLogsResult = await pool.query(`
        SELECT chosen_route, session_id, route_path
        FROM round_logs
        WHERE session_id = ANY($1) AND round = $2
      `, [roomSessionIds, room.current_round]);
      const roomLogs = roomLogsResult.rows;

      const roomDistribution: Record<string, number> = {};
      roomLogs.forEach((log: any) => {
        roomDistribution[log.chosen_route] = (roomDistribution[log.chosen_route] || 0) + 1;
      });
      const totalSubmitted = roomLogs.length;
      const allSubmitted = allSessionsCount > 0 && totalSubmitted >= allSessionsCount;

      // Compute realized time if all submitted
      let playerRealizedTime: number | null = null;
      let freshPlayerPredictedTime: number | null = playerLog?.predicted_time ? parseFloat(playerLog.predicted_time) : null;

      if (allSubmitted && playerLog && roomLogs.length > 0) {
        const freshEdgesResult = await pool.query(`
          SELECT * FROM traffic_edges WHERE room_id = $1
        `, [room.id]);
        const freshEdges = freshEdgesResult.rows;

        // Refetch latest logs
        const latestLogsResult = await pool.query(`
          SELECT session_id, route_path, chosen_route, predicted_time
          FROM round_logs
          WHERE session_id = ANY($1) AND round = $2
        `, [roomSessionIds, room.current_round]);
        const logsToUse = latestLogsResult.rows;

        // Build flow map
        const flowMap: Record<string, number> = {};
        for (const log of logsToUse) {
          const path: string[] = log.route_path;
          for (let i = 0; i < path.length - 1; i++) {
            const edgeId = `${room.id}_${path[i]}-${path[i + 1]}`;
            flowMap[edgeId] = (flowMap[edgeId] || 0) + 1;
          }
        }

        const latestPlayerLog = logsToUse.find((l: any) => l.session_id === sessionId);
        const playerPath: string[] = latestPlayerLog?.route_path ?? playerLog.route_path;
        freshPlayerPredictedTime = latestPlayerLog?.predicted_time
          ? parseFloat(latestPlayerLog.predicted_time)
          : freshPlayerPredictedTime;

        let realizedTime = 0;
        for (let i = 0; i < playerPath.length - 1; i++) {
          const edgeId = `${room.id}_${playerPath[i]}-${playerPath[i + 1]}`;
          const edge = freshEdges.find((e: any) => e.id === edgeId);
          if (edge) {
            const roundFlow = edge.base_flow + (flowMap[edgeId] || 0);
            realizedTime += bprTime(parseFloat(edge.free_time), roundFlow, edge.capacity);
          }
        }
        playerRealizedTime = Math.round(realizedTime * 100) / 100;
      }

      return NextResponse.json({
        status: "submitted_waiting",
        room_id: room.id,
        session_id: sessionId,
        current_round: room.current_round,
        num_rounds: room.total_rounds,
        message: "Choice submitted. Waiting for all players and admin to advance.",
        player_choice: playerLog?.chosen_route || null,
        player_predicted_time: freshPlayerPredictedTime,
        player_realized_time: playerRealizedTime,
        all_submitted: allSubmitted,
        choice_distribution: roomDistribution,
        total_submitted: totalSubmitted,
        predicted_times: predictedTimes,
        network: { nodes: networkNodes, edges: networkEdges },
        routes: routesData,
        origin: room.current_origin,
        destination: room.current_destination,
      });
    }

    // Initialized state
    const origin = room.current_origin;
    const destination = room.current_destination;
    const nodes = generateNodes();

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

const logsResult = await pool.query(`
      SELECT * FROM round_logs
      WHERE session_id = $1
      ORDER BY round ASC
    `, [sessionId]);

    const parsedLogs = logsResult.rows.map((log: any) => ({
      ...log,
      predicted_time: log.predicted_time ? parseFloat(log.predicted_time) : null,
      realized_time: log.realized_time ? parseFloat(log.realized_time) : null,
      decision_latency: log.decision_latency ? parseFloat(log.decision_latency) : null,
      route_a_flow: log.route_a_flow ? parseFloat(log.route_a_flow) : null,
      route_b_flow: log.route_b_flow ? parseFloat(log.route_b_flow) : null,
      route_c_flow: log.route_c_flow ? parseFloat(log.route_c_flow) : null,
    }));

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
      logs: parsedLogs,
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