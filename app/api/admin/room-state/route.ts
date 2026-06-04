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

    // Get full game history if game is completed
    let gameHistory = null;
    if (room.status === "completed" && sessionIds.length > 0) {
      const { data: allLogs } = await supabase
        .from("round_logs")
        .select("*")
        .in("session_id", sessionIds)
        .order("round", { ascending: true })
        .order("created_at", { ascending: true });

      // Organize logs by round
      const roundsData: Record<number, any[]> = {};
      allLogs?.forEach(log => {
        if (!roundsData[log.round]) roundsData[log.round] = [];
        // Find session for this log to get user name
        const session = sessions?.find(s => s.id === log.session_id);
        roundsData[log.round].push({
          ...log,
          user_name: session?.user_name || "Player",
        });
      });

      // Calculate stats per round
      const roundStats = Object.entries(roundsData).map(([round, logs]) => {
        const distribution: Record<string, number> = {};
        let totalPredicted = 0;
        let totalRealized = 0;

        logs.forEach(log => {
          distribution[log.chosen_route] = (distribution[log.chosen_route] || 0) + 1;
          totalPredicted += log.predicted_time || 0;
          totalRealized += log.realized_time || 0;
        });

        return {
          round: parseInt(round),
          logs,
          distribution,
          avgPredictedTime: logs.length > 0 ? Math.round((totalPredicted / logs.length) * 100) / 100 : 0,
          avgRealizedTime: logs.length > 0 ? Math.round((totalRealized / logs.length) * 100) / 100 : 0,
          playerCount: logs.length,
        };
      });

      // Calculate overall stats per player
      const playerStats = sessions?.map(session => {
        const playerLogs = allLogs?.filter(l => l.session_id === session.id) || [];
        const totalPredicted = playerLogs.reduce((sum, l) => sum + (l.predicted_time || 0), 0);
        const totalRealized = playerLogs.reduce((sum, l) => sum + (l.realized_time || 0), 0);
        const routeCounts: Record<string, number> = {};
        playerLogs.forEach(l => {
          routeCounts[l.chosen_route] = (routeCounts[l.chosen_route] || 0) + 1;
        });

        return {
          session_id: session.id,
          user_name: session.user_name || "Player",
          rounds_played: playerLogs.length,
          total_predicted_time: Math.round(totalPredicted * 100) / 100,
          total_realized_time: Math.round(totalRealized * 100) / 100,
          avg_predicted_time: playerLogs.length > 0 ? Math.round((totalPredicted / playerLogs.length) * 100) / 100 : 0,
          avg_realized_time: playerLogs.length > 0 ? Math.round((totalRealized / playerLogs.length) * 100) / 100 : 0,
          route_choices: routeCounts,
        };
      });

      gameHistory = {
        roundStats,
        playerStats,
        totalRounds: room.total_rounds,
      };
    }

    return NextResponse.json({ 
      room, 
      sessions,
      choiceDistribution,
      submittedCount,
      totalPlayers: sessions?.length || 0,
      allSubmitted: submittedSessions === (sessions?.length || 0) && submittedSessions > 0,
      gameHistory,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
