import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { session_id, round, reason, reason_text } = await request.json();

    if (!session_id || !round || !reason) {
      return NextResponse.json({ status: "error", message: "Missing fields" }, { status: 400 });
    }

    const { error } = await supabase
      .from("round_logs")
      .update({
        choice_reason: reason,
        choice_reason_text: reason_text || null,
      })
      .eq("session_id", session_id)
      .eq("round", round);

    if (error) throw error;

    return NextResponse.json({ status: "success" });
  } catch (error) {
    console.error("Error saving reason:", error);
    return NextResponse.json({ status: "error", message: "Failed to save reason" }, { status: 500 });
  }
}