#!/usr/bin/env node
// Archives one completed room's full data + analysis + charts into its own
// dated folder under results/, separate from data/simulated-population/
// (which stays a scratch/working directory for ad-hoc pulls). Use this only
// for rooms you actually want to keep as a named experiment result — not
// every test/tuning run.
//
// Usage:
//   node scripts/simulated-population/archive-room.mjs <room_id> [label]
//
// label defaults to the room's agent_condition (baseline/central/personal),
// Title-Cased. Folder name: results/<Label>_Room_data_<room_id>_<YYYY-MM-DD>/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
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

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function todayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  const roomId = process.argv[2];
  let label = process.argv[3];

  if (!roomId) {
    console.error("Usage: node scripts/simulated-population/archive-room.mjs <room_id> [label]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: readDatabaseUrl() });
  const room = (await pool.query("SELECT agent_condition FROM game_rooms WHERE id = $1", [roomId])).rows[0];
  await pool.end();

  if (!room) {
    console.error(`Room ${roomId} not found`);
    process.exit(1);
  }

  if (!label) label = titleCase(room.agent_condition);

  const folderName = `${label}_Room_data_${roomId}_${todayDate()}`;
  const outDir = path.join(REPO_ROOT, "results", folderName);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Archiving room ${roomId} (condition: ${room.agent_condition}) -> ${path.relative(REPO_ROOT, outDir)}\n`);

  const scriptsDir = path.join(REPO_ROOT, "scripts", "simulated-population");
  const steps = [
    { cmd: "node", args: [path.join(scriptsDir, "export-room.mjs"), roomId, outDir] },
    { cmd: "node", args: [path.join(scriptsDir, "optimal-vs-actual.mjs"), roomId, outDir] },
    { cmd: "node", args: [path.join(scriptsDir, "room-analysis.mjs"), roomId, outDir] },
    { cmd: "python3", args: [path.join(scriptsDir, "generate-charts.py"), roomId, outDir] },
  ];

  for (const step of steps) {
    try {
      const output = execFileSync(step.cmd, step.args, { cwd: REPO_ROOT, encoding: "utf8" });
      console.log(output.trim());
    } catch (err) {
      console.error(`Step failed: ${step.cmd} ${step.args.join(" ")}`);
      console.error(err.stdout || err.message);
    }
  }

  console.log(`\nDone. Everything for room ${roomId} is in: ${path.relative(REPO_ROOT, outDir)}`);
  const files = fs.readdirSync(outDir);
  for (const f of files) console.log(`  - ${f}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
