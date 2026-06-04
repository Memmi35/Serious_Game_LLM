import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateEdges, generateRoundEndpoints, bprTime } from "@/lib/traffic-simulation";
export async function POST() {
  try {
    const supabase = await createClient();
    const totalRounds = 5;
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();

    // Generate shared round endpoints for this room
    const roundEndpoints = generateRoundEndpoints();
    const origin = roundEndpoints[0][0];
    const destination = roundEndpoints[0][1];

    // Create the room with first round's origin/destination
    const { error: roomError } = await supabase.from("game_rooms").insert({
      id: roomId,
      status: "waiting",
      current_round: 1,
      total_rounds: totalRounds,
      current_origin: origin,
      current_destination: destination,
    });
    if (roomError) throw roomError;

    // Store all round endpoints on the room
    const endpointInserts = roundEndpoints.map((ep, index) => ({
      room_id: roomId,
      round: index + 1,
      origin: ep[0],
      destination: ep[1],
    }));
    const { error: endpointsError } = await supabase
      .from("room_endpoints")
      .insert(endpointInserts);
    if (endpointsError) throw endpointsError;

    // Create room-scoped edges
    const edges = generateEdges();
    const edgeInserts = edges.map((edge) => ({
      id: `${roomId}_${edge.id}`,
      room_id: roomId,
      from_node: edge.from,
      to_node: edge.to,
      free_time: edge.freeTime,
      capacity: edge.capacity,
      base_flow: edge.baseFlow,
      current_flow: edge.flow,
      travel_time: bprTime(edge.freeTime, edge.baseFlow, edge.capacity),
    }));
    const { error: insertError } = await supabase
      .from("traffic_edges")
      .insert(edgeInserts);
    if (insertError) throw insertError;

    return NextResponse.json({ status: "success", room_id: roomId });
  } catch (error) {
    console.error("Error creating room:", error);
    return NextResponse.json({ status: "error", message: "Failed to create room" }, { status: 500 });
  }
}