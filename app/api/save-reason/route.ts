import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { session_id, round, reason, reason_text, persuasion_transcript } = await request.json();

    if (!session_id || !round || !reason) {
      return NextResponse.json({ status: "error", message: "Missing fields" }, { status: 400 });
    }

    await pool.query(`
      UPDATE round_logs
      SET choice_reason = $1, choice_reason_text = $2, persuasion_transcript = $3
      WHERE session_id = $4 AND round = $5
    `, [reason, reason_text || null, persuasion_transcript ? JSON.stringify(persuasion_transcript) : null, session_id, round]);

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Error saving reason:", error);
    return NextResponse.json({ status: "error", message: "Failed to save reason" }, { status: 500 });
  }
}