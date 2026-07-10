#!/usr/bin/env node
// Diagnostic: for a completed room, checks how much headroom each round's
// edge capacities leave before BPR congestion actually bites for a
// population of N agents. Reconstructs route edge-sets from round_logs
// (same method as optimal-vs-actual.mjs) and reports, per round:
//   - the actual flow/capacity ratio the run produced
//   - the worst-case ratio if all N agents had picked the single fastest
//     (lowest free-time) route, i.e. a naive "everyone herds" failure mode
//   - the resulting BPR travel-time multiplier in both cases
//
// Usage:
//   node scripts/simulated-population/capacity-sensitivity.mjs <room_id>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROUTE_NAMES = ["Route A", "Route B", "Route C"];

function readDatabaseUrl() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^DATABASE_URL=(.+)$/);
    if (match) return match[1].trim();
  }
  throw new Error("DATABASE_URL not found in .env.local");
}

function bprMultiplier(flow, capacity) {
  return 1 + 0.15 * Math.pow(flow / capacity, 4);
}

function buildRouteEdgeSets(roundRows) {
  const byRoute = {};
  for (const name of ROUTE_NAMES) {
    const row = roundRows.find((r) => r.chosen_route === name);
    if (!row) continue;
    byRoute[name] = row.route_edges.map((e) => ({
      key: `${e.from}->${e.to}`,
      freeTime: e.freeTime,
      capacity: e.capacity,
      baseFlow: e.baseFlow,
    }));
  }
  return byRoute;
}

async function main() {
  const roomId = process.argv[2];
  if (!roomId) {
    console.error("Usage: node scripts/simulated-population/capacity-sensitivity.mjs <room_id>");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: readDatabaseUrl() });
  const logsResult = await pool.query(
    `SELECT rl.round, rl.chosen_route, rl.route_edges
     FROM round_logs rl
     JOIN simulation_sessions s ON rl.session_id = s.id
     WHERE s.room_id = $1
     ORDER BY rl.round`,
    [roomId]
  );
  await pool.end();

  const byRound = new Map();
  for (const row of logsResult.rows) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }

  console.log(`\nRoom ${roomId} — capacity headroom check\n`);

  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const rows = byRound.get(round);
    const n = rows.length;
    const actualCounts = { "Route A": 0, "Route B": 0, "Route C": 0 };
    for (const row of rows) actualCounts[row.chosen_route] += 1;

    const routeEdgeSets = buildRouteEdgeSets(rows);
    const missing = ROUTE_NAMES.filter((r) => !routeEdgeSets[r]);
    if (missing.length > 0) {
      console.log(`Round ${round}: skipped (no data for ${missing.join(", ")})\n`);
      continue;
    }

    // Actual worst-hit edge (union across all 3 routes, flow = baseFlow +
    // sum of actual counts for every route touching that edge).
    const edgeFlow = new Map();
    for (const name of ROUTE_NAMES) {
      for (const e of routeEdgeSets[name]) {
        const entry = edgeFlow.get(e.key) || { ...e, flow: e.baseFlow };
        entry.flow += actualCounts[name];
        edgeFlow.set(e.key, entry);
      }
    }
    let worstActual = null;
    for (const e of edgeFlow.values()) {
      const ratio = e.flow / e.capacity;
      if (!worstActual || ratio > worstActual.ratio) worstActual = { ...e, ratio };
    }

    // Worst-case herd: all N agents pile onto whichever single route has
    // the lowest total free-time (the "obviously fastest" naive choice).
    const routeFreeTime = {};
    for (const name of ROUTE_NAMES) {
      routeFreeTime[name] = routeEdgeSets[name].reduce((s, e) => s + e.freeTime, 0);
    }
    const fastestRoute = ROUTE_NAMES.reduce((a, b) => (routeFreeTime[a] < routeFreeTime[b] ? a : b));
    let worstHerd = null;
    for (const e of routeEdgeSets[fastestRoute]) {
      const flow = e.baseFlow + n;
      const ratio = flow / e.capacity;
      if (!worstHerd || ratio > worstHerd.ratio) worstHerd = { ...e, flow, ratio };
    }

    console.log(`Round ${round} (n=${n}), fastest route = ${fastestRoute}`);
    console.log(
      `  actual worst edge (any route):  flow=${worstActual.flow}/cap=${worstActual.capacity}` +
        `  ratio=${worstActual.ratio.toFixed(2)}  BPR x${bprMultiplier(worstActual.flow, worstActual.capacity).toFixed(2)}`
    );
    console.log(
      `  full-herd on ${fastestRoute}:            flow=${worstHerd.flow}/cap=${worstHerd.capacity}` +
        `  ratio=${worstHerd.ratio.toFixed(2)}  BPR x${bprMultiplier(worstHerd.flow, worstHerd.capacity).toFixed(2)}`
    );

    // Edges that belong to exactly one route (not shared) — these are the
    // only edges where redistributing the population actually changes
    // anything. Shared edges (common to all 3) saturate no matter what.
    const routeCountForKey = new Map();
    for (const name of ROUTE_NAMES) {
      for (const e of routeEdgeSets[name]) {
        const s = routeCountForKey.get(e.key) || new Set();
        s.add(name);
        routeCountForKey.set(e.key, s);
      }
    }
    for (const name of ROUTE_NAMES) {
      const exclusive = routeEdgeSets[name].filter((e) => routeCountForKey.get(e.key).size === 1);
      if (exclusive.length === 0) {
        console.log(`  ${name}: no exclusive edges (fully overlaps other routes)`);
        continue;
      }
      let worstExclusive = null;
      for (const e of exclusive) {
        const actualFlow = e.baseFlow + actualCounts[name];
        const ratio = actualFlow / e.capacity;
        if (!worstExclusive || ratio > worstExclusive.ratio) worstExclusive = { ...e, flow: actualFlow, ratio };
      }
      const herdFlow = worstExclusive.baseFlow + n;
      const herdRatio = herdFlow / worstExclusive.capacity;
      console.log(
        `  ${name} exclusive worst edge: actual flow=${worstExclusive.flow}/cap=${worstExclusive.capacity}` +
          ` ratio=${worstExclusive.ratio.toFixed(2)} BPR x${bprMultiplier(worstExclusive.flow, worstExclusive.capacity).toFixed(2)}` +
          `  |  if all ${n} used it: ratio=${herdRatio.toFixed(2)} BPR x${bprMultiplier(herdFlow, worstExclusive.capacity).toFixed(2)}`
      );
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
