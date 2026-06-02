import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { room_id, user_name } = await request.json();

    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .select("*")
      .eq("id", room_id)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ status: "error", message: "Room not found" }, { status: 404 });
    }
    if (room.status === "completed") {
      return NextResponse.json({ status: "error", message: "Room already completed" }, { status: 400 });
    }

    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // One session per user per room — reads origin/destination from room
    const { data: session, error: sessionError } = await supabase
      .from("simulation_sessions")
      .insert({
        room_id,
        user_id: userId,
        user_name: user_name || "Player",
        current_round: room.current_round,
        total_rounds: room.total_rounds,
        grid_size: 5,
        is_complete: false,
        has_submitted: false,
        // No per-user origin/destination — we use room's
      })
      .select()
      .single();

    if (sessionError) throw sessionError;

    return NextResponse.json({
      status: "success",
      session_id: session.id,
      user_id: userId,
      room_id,
    });
  } catch (error) {
    console.error("Error joining room:", error);
    return NextResponse.json({ status: "error", message: "Failed to join room" }, { status: 500 });
  }
}