import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(request: Request) {
  const data = await request.json();
  const response = await fetch('http://127.0.0.1:5001', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    model_loaded: true,
    model_type: "RandomForestRegressor (Python)",
  });
}
