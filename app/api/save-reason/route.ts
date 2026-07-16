import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { session_id, round, reason, reason_text, persuasion_transcript, phase } = await request.json();

    if (!session_id || !round || !reason) {
      return NextResponse.json({ status: "error", message: "Missing fields" }, { status: 400 });
    }

    // phase: 'initial' (default) writes the original choice_reason/
    // persuasion_transcript columns; 'switch' writes the separate
    // switch_reason/switch_transcript columns added for the switch-phase
    // persuasion dialogue — reusing the initial columns would overwrite
    // that round's initial-choice data instead of recording both.
    const transcriptJson = persuasion_transcript ? JSON.stringify(persuasion_transcript) : null;
    if (phase === "switch") {
      await pool.query(`
        UPDATE round_logs
        SET switch_reason = $1, switch_transcript = $2
        WHERE session_id = $3 AND round = $4
      `, [reason, transcriptJson, session_id, round]);
    } else {
      await pool.query(`
        UPDATE round_logs
        SET choice_reason = $1, choice_reason_text = $2, persuasion_transcript = $3
        WHERE session_id = $4 AND round = $5
      `, [reason, reason_text || null, transcriptJson, session_id, round]);
    }

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Error saving reason:", error);
    return NextResponse.json({ status: "error", message: "Failed to save reason" }, { status: 500 });
  }
}