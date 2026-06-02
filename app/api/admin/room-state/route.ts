import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const roomId = request.nextUrl.searchParams.get("room_id");

    if (!roomId) return NextResponse.json({ error: "Missing room_id" }, { status: 400 });

    const { data: room, error: roomError } = await supabase
      .from("game_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (roomError || !room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const { data: sessions, error: sessionsError } = await supabase
      .from("simulation_sessions")
      .select("*")
      .eq("room_id", roomId);

    if (sessionsError) throw sessionsError;

    return NextResponse.json({ room, sessions });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
