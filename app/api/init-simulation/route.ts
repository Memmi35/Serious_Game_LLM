import { NextResponse, NextRequest } from "next/server";
import pool from "@/lib/db";
import {
  generateNodes,
  generateEdges,
  generateRoundEndpoints,
  findRoutes,
} from "@/lib/traffic-simulation";

export async function POST() {
  const client = await pool.connect();
  try {
    const gridSize = 5;
    const totalRounds = 5;
    
    // Generate a unique user ID for this session
    const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    // Generate standard graph entities
    const nodes = generateNodes();
    const roundEndpoints = generateRoundEndpoints();
    const origin = roundEndpoints[0][0];
    const destination = roundEndpoints[0][1];

    // 1. Create session (game room) in database
    const sessionQuery = `
      INSERT INTO simulation_sessions (
        user_id, current_round, total_rounds, grid_size, is_complete, current_origin, current_destination
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;
    const sessionResult = await client.query(sessionQuery, [
      userId,
      1,
      totalRounds,
      gridSize,
      false,
      origin,
      destination,
    ]);
    const sessionId = sessionResult.rows[0].id;

    // 2. Generate edges for the first round based on scenarios
    const edges = generateEdges(1);

    // 3. Store the pre-calculated round endpoints linked via tracking session_id
    for (let i = 0; i < roundEndpoints.length; i++) {
      await client.query(
        `INSERT INTO round_endpoints (session_id, round, origin, destination)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, i + 1, roundEndpoints[i][0], roundEndpoints[i][1]]
      );
    }

    // 4. Compute active choices for the current UI state matrix
    const routes = findRoutes(edges, origin, destination);
    
    const predictedTimes: Record<string, number> = {};
    const routesData: Record<string, any> = {};

    for (const [name, route] of Object.entries(routes)) {
      predictedTimes[name] = Math.round(route.totalTravelTime * 100) / 100;
      routesData[name] = {
        path: route.path,
        length: route.path.length - 1,
        predicted_time: route.totalTravelTime,
        total_free_time: route.totalFreeTime,
      };
    }

    // Map network primitives onto snake_case API payload formats expected by frontend types
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

    return NextResponse.json({
      status: "success",
      session_id: sessionId,
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
    console.error("Neon setup failure inside init-simulation:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to initialize simulation room architecture" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}