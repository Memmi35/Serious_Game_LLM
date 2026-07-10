#!/usr/bin/env node
// Compares the actual round-by-round route distribution (what the 30
// simulated agents chose) against the system-optimal distribution (the
// 3-way split of the same population that minimizes total travel time),
// for a completed room.
//
// The round's true network (which edges each route uses, and each edge's
// freeTime/capacity/baseFlow) is reconstructed from the route_edges already
// recorded on round_logs — NOT by re-deriving it from lib/scenarios.ts —
// so this can't drift from what the agents actually experienced. This only
// works for rounds where all 3 routes were chosen by at least one agent
// (true for every round in the simulated-population runs so far); rounds
// missing a route are reported as "unavailable" rather than guessed at.
//
// Usage:
//   node scripts/simulated-population/optimal-vs-actual.mjs <room_id> [out_dir]

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

function bprTime(freeTime, flow, capacity) {
  return freeTime * (1 + 0.15 * Math.pow(flow / capacity, 4));
}

// Rebuild {routeName -> {edges: [{key, from, to, freeTime, capacity, baseFlow}]}}
// from one representative round_logs row per route name.
function buildRouteEdgeSets(roundRows) {
  const byRoute = {};
  for (const name of ROUTE_NAMES) {
    const row = roundRows.find((r) => r.chosen_route === name);
    if (!row) continue;
    const edges = row.route_edges.map((e) => ({
      key: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      freeTime: e.freeTime,
      capacity: e.capacity,
      baseFlow: e.baseFlow,
    }));
    byRoute[name] = edges;
  }
  return byRoute;
}

// Total system travel time for a given (a, b, c) split, using the union of
// edges across all 3 routes (shared edges accumulate flow from every route
// that uses them, matching how the real game computes it in room-action).
function systemCost(routeEdgeSets, counts) {
  const edgeFlow = new Map(); // key -> { freeTime, capacity, flow }
  for (const name of ROUTE_NAMES) {
    const edges = routeEdgeSets[name];
    const n = counts[name];
    for (const e of edges) {
      const entry = edgeFlow.get(e.key) || { freeTime: e.freeTime, capacity: e.capacity, flow: e.baseFlow };
      entry.flow += n;
      edgeFlow.set(e.key, entry);
    }
  }
  const travelTimeByKey = new Map();
  for (const [key, e] of edgeFlow) {
    travelTimeByKey.set(key, bprTime(e.freeTime, e.flow, e.capacity));
  }

  let total = 0;
  for (const name of ROUTE_NAMES) {
    const routeTime = routeEdgeSets[name].reduce((sum, e) => sum + travelTimeByKey.get(e.key), 0);
    total += routeTime * counts[name];
  }
  return total;
}

function findOptimalSplit(routeEdgeSets, n) {
  let best = null;
  for (let a = 0; a <= n; a++) {
    for (let b = 0; b <= n - a; b++) {
      const c = n - a - b;
      const counts = { "Route A": a, "Route B": b, "Route C": c };
      const cost = systemCost(routeEdgeSets, counts);
      if (!best || cost < best.cost) {
        best = { counts, cost };
      }
    }
  }
  return best;
}

async function main() {
  const roomId = process.argv[2];
  const outDir = process.argv[3] || path.join(REPO_ROOT, "data", "simulated-population");
  if (!roomId) {
    console.error("Usage: node scripts/simulated-population/optimal-vs-actual.mjs <room_id> [out_dir]");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: readDatabaseUrl() });

  const logsResult = await pool.query(
    `SELECT rl.round, rl.chosen_route, rl.route_edges, rl.realized_time
     FROM round_logs rl
     JOIN simulation_sessions s ON rl.session_id = s.id
     WHERE s.room_id = $1
     ORDER BY rl.round`,
    [roomId]
  );
  await pool.end();

  if (logsResult.rows.length === 0) {
    console.error(`No round_logs found for room ${roomId}`);
    process.exit(1);
  }

  const byRound = new Map();
  for (const row of logsResult.rows) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }

  const results = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const rows = byRound.get(round);
    const n = rows.length;

    const actualCounts = { "Route A": 0, "Route B": 0, "Route C": 0 };
    let actualTotalCost = 0;
    for (const row of rows) {
      actualCounts[row.chosen_route] += 1;
      actualTotalCost += parseFloat(row.realized_time);
    }

    const routeEdgeSets = buildRouteEdgeSets(rows);
    const missingRoutes = ROUTE_NAMES.filter((name) => !routeEdgeSets[name]);

    if (missingRoutes.length > 0) {
      results.push({
        round,
        n,
        actual: { counts: actualCounts, totalCost: actualTotalCost, avgCost: actualTotalCost / n },
        optimal: null,
        note: `optimal unavailable: no agent chose ${missingRoutes.join(", ")} this round`,
      });
      continue;
    }

    const optimal = findOptimalSplit(routeEdgeSets, n);

    results.push({
      round,
      n,
      actual: {
        counts: actualCounts,
        totalCost: Math.round(actualTotalCost * 100) / 100,
        avgCost: Math.round((actualTotalCost / n) * 100) / 100,
      },
      optimal: {
        counts: optimal.counts,
        totalCost: Math.round(optimal.cost * 100) / 100,
        avgCost: Math.round((optimal.cost / n) * 100) / 100,
      },
      gap: {
        totalCost: Math.round((actualTotalCost - optimal.cost) * 100) / 100,
        pct: Math.round(((actualTotalCost - optimal.cost) / optimal.cost) * 10000) / 100,
      },
    });
  }

  console.log(`\nRoom ${roomId} — actual vs system-optimal distribution\n`);
  for (const r of results) {
    console.log(`Round ${r.round} (n=${r.n})`);
    console.log(
      `  actual:  A=${r.actual.counts["Route A"]} B=${r.actual.counts["Route B"]} C=${r.actual.counts["Route C"]}` +
        `  total=${r.actual.totalCost}  avg=${r.actual.avgCost}`
    );
    if (r.optimal) {
      console.log(
        `  optimal: A=${r.optimal.counts["Route A"]} B=${r.optimal.counts["Route B"]} C=${r.optimal.counts["Route C"]}` +
          `  total=${r.optimal.totalCost}  avg=${r.optimal.avgCost}`
      );
      console.log(`  gap:     +${r.gap.totalCost} total time (${r.gap.pct}% above optimal)`);
    } else {
      console.log(`  optimal: ${r.note}`);
    }
    console.log("");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${roomId}-optimal-vs-actual.json`);
  fs.writeFileSync(outPath, JSON.stringify({ room_id: roomId, generated_at: new Date().toISOString(), rounds: results }, null, 2));
  console.log(`Saved -> ${outPath}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
