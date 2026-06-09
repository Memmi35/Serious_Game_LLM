import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { room_id, user_name } = await request.json();

    // Get room
    const roomResult = await pool.query(`
      SELECT * FROM game_rooms WHERE id = $1
    `, [room_id]);

    if (roomResult.rows.length === 0) {
      return NextResponse.json({ status: "error", message: "Room not found" }, { status: 404 });
    }

    const room = roomResult.rows[0];

    if (room.status === "completed") {
      return NextResponse.json({ status: "error", message: "Room already completed" }, { status: 400 });
    }

    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Insert session
    const sessionResult = await pool.query(`
      INSERT INTO simulation_sessions 
        (room_id, user_id, user_name, current_round, total_rounds, grid_size, is_complete, has_submitted)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      room_id,
      userId,
      user_name || "Player",
      room.current_round,
      room.total_rounds,
      5,
      false,
      false,
    ]);

    const session = sessionResult.rows[0];

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