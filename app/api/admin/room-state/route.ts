import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get("room_id");

    if (!roomId) return NextResponse.json({ error: "Missing room_id" }, { status: 400 });

    // Get room
    const roomResult = await pool.query(`
      SELECT * FROM game_rooms WHERE id = $1
    `, [roomId]);

    if (roomResult.rows.length === 0) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const room = roomResult.rows[0];

    // Get sessions
    const sessionsResult = await pool.query(`
      SELECT * FROM simulation_sessions WHERE room_id = $1
    `, [roomId]);
    const sessions = sessionsResult.rows;
    const sessionIds = sessions.map((s: any) => s.id);

    // Get choice distribution for current round
    let choiceDistribution: Record<string, number> = {};
    let submittedCount = 0;

    if (sessionIds.length > 0) {
      const roundLogsResult = await pool.query(`
        SELECT chosen_route FROM round_logs
        WHERE round = $1 AND session_id = ANY($2)
      `, [room.current_round, sessionIds]);

      submittedCount = roundLogsResult.rows.length;
      roundLogsResult.rows.forEach((log: any) => {
        choiceDistribution[log.chosen_route] = (choiceDistribution[log.chosen_route] || 0) + 1;
      });
    }

    const submittedSessions = sessions.filter((s: any) => s.has_submitted).length;

    // Get full game history if completed
    let gameHistory = null;
    if (room.status === "completed" && sessionIds.length > 0) {
const allLogsResult = await pool.query(`
        SELECT * FROM round_logs
        WHERE session_id = ANY($1)
        ORDER BY round ASC, created_at ASC
      `, [sessionIds]);
      const allLogs = allLogsResult.rows.map((log: any) => ({
        ...log,
        predicted_time: log.predicted_time ? parseFloat(log.predicted_time) : null,
        realized_time: log.realized_time ? parseFloat(log.realized_time) : null,
        decision_latency: log.decision_latency ? parseFloat(log.decision_latency) : null,
        route_a_flow: log.route_a_flow ? parseFloat(log.route_a_flow) : null,
        route_b_flow: log.route_b_flow ? parseFloat(log.route_b_flow) : null,
        route_c_flow: log.route_c_flow ? parseFloat(log.route_c_flow) : null,
      }));

      // Organize by round
      const roundsData: Record<number, any[]> = {};
      allLogs.forEach((log: any) => {
        if (!roundsData[log.round]) roundsData[log.round] = [];
        const session = sessions.find((s: any) => s.id === log.session_id);
        roundsData[log.round].push({
          ...log,
          user_name: session?.user_name || "Player",
        });
      });

      const roundStats = Object.entries(roundsData).map(([round, logs]) => {
        const distribution: Record<string, number> = {};
        let totalPredicted = 0;
        let totalRealized = 0;

        logs.forEach((log: any) => {
          distribution[log.chosen_route] = (distribution[log.chosen_route] || 0) + 1;
          totalPredicted += parseFloat(log.predicted_time) || 0;
          totalRealized += parseFloat(log.realized_time) || 0;
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

      const playerStats = sessions.map((session: any) => {
        const playerLogs = allLogs.filter((l: any) => l.session_id === session.id);
        const totalPredicted = playerLogs.reduce((sum: number, l: any) => sum + (parseFloat(l.predicted_time) || 0), 0);
        const totalRealized = playerLogs.reduce((sum: number, l: any) => sum + (parseFloat(l.realized_time) || 0), 0);
        const routeCounts: Record<string, number> = {};
        playerLogs.forEach((l: any) => {
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
      totalPlayers: sessions.length,
      allSubmitted: submittedSessions === sessions.length && submittedSessions > 0,
      gameHistory,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}