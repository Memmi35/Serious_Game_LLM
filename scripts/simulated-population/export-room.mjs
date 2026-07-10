#!/usr/bin/env node
// Exports everything stored for a single room (game_rooms, room_endpoints,
// simulation_sessions + simulation_agents persona metadata, round_logs, and
// the final traffic_edges snapshot) into one local JSON file, so a
// simulated-population run can be inspected/analyzed without a DB client.
//
// Usage:
//   node scripts/simulated-population/export-room.mjs <room_id> [out_dir]
//
// Example:
//   node scripts/simulated-population/export-room.mjs 91DU
//   -> writes data/simulated-population/91DU.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readDatabaseUrl() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^DATABASE_URL=(.+)$/);
    if (match) return match[1].trim();
  }
  throw new Error("DATABASE_URL not found in .env.local");
}

async function main() {
  const roomId = process.argv[2];
  const outDir = process.argv[3] || path.join(REPO_ROOT, "data", "simulated-population");

  if (!roomId) {
    console.error("Usage: node scripts/simulated-population/export-room.mjs <room_id> [out_dir]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: readDatabaseUrl() });

  const roomResult = await pool.query("SELECT * FROM game_rooms WHERE id = $1", [roomId]);
  const room = roomResult.rows[0];
  if (!room) {
    console.error(`Room ${roomId} not found`);
    await pool.end();
    process.exit(1);
  }

  const roomEndpoints = await pool.query(
    "SELECT round, origin, destination FROM room_endpoints WHERE room_id = $1 ORDER BY round",
    [roomId]
  );

  const agents = await pool.query(
    `SELECT s.id AS session_id, s.user_id, s.user_name, s.current_round, s.total_rounds,
            s.is_complete, s.has_submitted, s.created_at AS session_created_at,
            a.agent_index, a.persona_label, a.llm_backend, a.risk_aversion,
            a.delay_sensitivity, a.trust_in_advice, a.decision_latency_mean,
            a.decision_latency_sigma, a.route_stickiness, a.softmax_temperature,
            a.commute_habit
     FROM simulation_sessions s
     LEFT JOIN simulation_agents a ON a.session_id = s.id
     WHERE s.room_id = $1
     ORDER BY a.agent_index NULLS LAST, s.created_at`,
    [roomId]
  );

  const sessionIds = agents.rows.map((r) => r.session_id);

  const roundLogs = await pool.query(
    `SELECT * FROM round_logs
     WHERE session_id = ANY($1)
     ORDER BY round, session_id`,
    [sessionIds]
  );

  const trafficEdges = await pool.query(
    "SELECT * FROM traffic_edges WHERE room_id = $1 ORDER BY id",
    [roomId]
  );

  const exportData = {
    exported_at: new Date().toISOString(),
    room,
    room_endpoints: roomEndpoints.rows,
    agents: agents.rows,
    round_logs: roundLogs.rows,
    final_traffic_edges: trafficEdges.rows,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${roomId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2));

  console.log(`Exported room ${roomId}:`);
  console.log(`  agents: ${agents.rows.length}`);
  console.log(`  round_logs: ${roundLogs.rows.length}`);
  console.log(`  traffic_edges: ${trafficEdges.rows.length}`);
  console.log(`  -> ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
