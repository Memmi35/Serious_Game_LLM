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
        if (room.current_round >= room.total_rounds) {
          await supabase.from("game_rooms").update({ status: "completed" }).eq("id", room_id);
          await supabase.from("simulation_sessions")
            .update({ is_complete: true })
            .eq("room_id", room_id);
        } else {
          const nextRound = room.current_round + 1;

          // Get shared endpoints for next round
          const { data: nextEndpoint } = await supabase
            .from("room_endpoints")
            .select("*")
            .eq("room_id", room_id)
            .eq("round", nextRound)
            .single();

          // Advance room with new origin/destination
          await supabase.from("game_rooms").update({
            current_round: nextRound,
            current_origin: nextEndpoint?.origin,
            current_destination: nextEndpoint?.destination,
          }).eq("id", room_id);

          // Reset all sessions for next round
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