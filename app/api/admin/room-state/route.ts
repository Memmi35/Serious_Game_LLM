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

    // Get choice distribution for current round
    const sessionIds = (sessions || []).map(s => s.id);
    let choiceDistribution: Record<string, number> = {};
    let submittedCount = 0;
    
    if (sessionIds.length > 0) {
      const { data: roundLogs } = await supabase
        .from("round_logs")
        .select("chosen_route")
        .eq("round", room.current_round)
        .in("session_id", sessionIds);

      submittedCount = roundLogs?.length || 0;
      roundLogs?.forEach(log => {
        choiceDistribution[log.chosen_route] = (choiceDistribution[log.chosen_route] || 0) + 1;
      });
    }

    // Count how many have submitted
    const submittedSessions = (sessions || []).filter(s => s.has_submitted).length;

    return NextResponse.json({ 
      room, 
      sessions,
      choiceDistribution,
      submittedCount,
      totalPlayers: sessions?.length || 0,
      allSubmitted: submittedSessions === (sessions?.length || 0) && submittedSessions > 0
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
