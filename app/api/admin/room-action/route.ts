import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { room_id, action } = await request.json();

    if (!room_id || !action) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    if (action === "start") {
      await supabase.from("game_rooms").update({ status: "playing" }).eq("id", room_id);

} else if (action === "next_round") {
  const { data: room } = await supabase
    .from("game_rooms").select("*").eq("id", room_id).single();

  if (room) {
    // Step 1: Get all sessions and their round logs
    const { data: sessions } = await supabase
      .from("simulation_sessions")
      .select("id")
      .eq("room_id", room_id);

    const sessionIds = (sessions ?? []).map((s: any) => s.id);

    const { data: currentRoundLogs } = await supabase
      .from("round_logs")
      .select("*")
      .in("session_id", sessionIds)
      .eq("round", room.current_round);

    // Step 2: Load current edges
    const { data: dbEdges } = await supabase
      .from("traffic_edges")
      .select("*")
      .eq("room_id", room_id);

    if (dbEdges && currentRoundLogs && currentRoundLogs.length > 0) {
      const { bprTime } = await import("@/lib/traffic-simulation");

      // Step 3: Add +1 flow per player on their chosen route edges
      const updatedEdges = dbEdges.map((e: any) => ({ ...e }));
      for (const log of currentRoundLogs) {
        const path: string[] = log.route_path;
        for (let i = 0; i < path.length - 1; i++) {
          const edgeId = `${room_id}_${path[i]}-${path[i + 1]}`;
          const edge = updatedEdges.find((e: any) => e.id === edgeId);
          if (edge) edge.current_flow += 1;
        }
      }

      // Step 4: Recompute BPR travel times with aggregated flows
      for (const edge of updatedEdges) {
        edge.travel_time = bprTime(edge.free_time, edge.current_flow, edge.capacity); // round only at sum
      }

      // Step 5: Compute and write realized time for each player
      for (const log of currentRoundLogs) {
        const path: string[] = log.route_path;
        let realizedTime = 0;
        for (let i = 0; i < path.length - 1; i++) {
          const edgeId = `${room_id}_${path[i]}-${path[i + 1]}`;
          const edge = updatedEdges.find((e: any) => e.id === edgeId);
          if (edge) realizedTime += edge.travel_time;
        }
        await supabase
          .from("round_logs")
          .update({ realized_time: Math.round(realizedTime * 100) / 100 })
          .eq("id", log.id);
      }

      // Step 6: Persist updated flows and travel times
      for (const edge of updatedEdges) {
        await supabase
          .from("traffic_edges")
          .update({ current_flow: edge.current_flow, travel_time: edge.travel_time })
          .eq("id", edge.id);
      }
    }

    if (room.current_round >= room.total_rounds) {
      await supabase.from("game_rooms").update({ status: "completed" }).eq("id", room_id);
      await supabase.from("simulation_sessions")
        .update({ is_complete: true })
        .eq("room_id", room_id);
    } else {
      const nextRound = room.current_round + 1;

      const { data: nextEndpoint } = await supabase
        .from("room_endpoints")
        .select("*")
        .eq("room_id", room_id)
        .eq("round", nextRound)
        .single();

      await supabase.from("game_rooms").update({
        current_round: nextRound,
        current_origin: nextEndpoint?.origin,
        current_destination: nextEndpoint?.destination,
      }).eq("id", room_id);

      await supabase.from("simulation_sessions").update({
        current_round: nextRound,
        has_submitted: false,
        updated_at: new Date().toISOString(),
      }).eq("room_id", room_id);
    }
  }
}

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}