#!/usr/bin/env node
// Pulls everything needed to analyze one simulated-population room: route
// distribution per round, decision latency stats, and a data-quality check
// for LLM-engine runs (how many decisions fell back to the rule-based
// engine due to a timeout/error, and how many reasons reference "AI advice"
// despite no advisor being active — a hallucination check for baseline
// rooms specifically).
//
// Usage:
//   node scripts/simulated-population/room-analysis.mjs <room_id> [out_dir]

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
    console.error("Usage: node scripts/simulated-population/room-analysis.mjs <room_id> [out_dir]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: readDatabaseUrl() });

  const room = (await pool.query("SELECT * FROM game_rooms WHERE id = $1", [roomId])).rows[0];
  if (!room) {
    console.error(`Room ${roomId} not found`);
    await pool.end();
    process.exit(1);
  }

  const logs = await pool.query(
    `SELECT rl.round, rl.chosen_route, rl.decision_latency, rl.choice_reason AS reason, rl.realized_time,
            sa.persona_label, sa.commute_habit
     FROM round_logs rl
     JOIN simulation_sessions s ON rl.session_id = s.id
     LEFT JOIN simulation_agents sa ON sa.session_id = s.id
     WHERE s.room_id = $1
     ORDER BY rl.round`,
    [roomId]
  );
  await pool.end();

  const rounds = [...new Set(logs.rows.map((r) => r.round))].sort((a, b) => a - b);

  const distributionByRound = {};
  const latencyByRound = {};
  let fallbackCount = 0;
  let mockCount = 0;
  let aiMentionCount = 0;
  const aiMentionExamples = [];

  for (const round of rounds) {
    const roundRows = logs.rows.filter((r) => r.round === round);
    const dist = { "Route A": 0, "Route B": 0, "Route C": 0 };
    const latencies = [];
    for (const row of roundRows) {
      dist[row.chosen_route] = (dist[row.chosen_route] || 0) + 1;
      latencies.push(parseFloat(row.decision_latency));
      const reason = row.reason || "";
      if (reason.startsWith("[llm fallback]")) fallbackCount++;
      if (reason.startsWith("[mock LLM]")) mockCount++;
      if (/\bAI\b/i.test(reason) && !reason.startsWith("[mock LLM]") && !reason.startsWith("[llm fallback]")) {
        aiMentionCount++;
        if (aiMentionExamples.length < 5) aiMentionExamples.push({ round, reason });
      }
    }
    distributionByRound[round] = dist;
    latencyByRound[round] = {
      mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies),
    };
  }

  const result = {
    room_id: roomId,
    agent_condition: room.agent_condition,
    total_rounds: rounds.length,
    total_decisions: logs.rows.length,
    distribution_by_round: distributionByRound,
    latency_by_round: latencyByRound,
    data_quality: {
      real_llm_decisions: logs.rows.length - fallbackCount - mockCount,
      fallback_decisions: fallbackCount,
      mock_decisions: mockCount,
      ai_mentions_without_advisor: aiMentionCount,
      ai_mention_examples: aiMentionExamples,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${roomId}-room-analysis.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.error(`\nSaved -> ${outPath}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
