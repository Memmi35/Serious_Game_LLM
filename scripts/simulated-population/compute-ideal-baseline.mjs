#!/usr/bin/env node
// Computes the "Ideal Baseline" row (what if every player always took the
// system-optimal route, every round) for a given room's own topology and
// population size -- i.e. optimal.totalCost/delay/congestedEdges instead of
// the actual-choice ones compute-first-choice-metrics.mjs reports. Reuses
// that same topology-reading logic (route_edges keyed off chosen_route)
// since the buildRouteEdgeSets bug fix there applies equally here.
//
// Usage:
//   node scripts/simulated-population/compute-ideal-baseline.mjs <room.json>

import fs from "node:fs";
import { findOptimalSplit, computeEdgeFlows } from "./optimal-split.mjs";

const ROUTE_NAMES = ["Route A", "Route B", "Route C"];

function normalizeRoute(r) {
  if (!r) return null;
  return r.startsWith("Route") ? r : `Route ${r}`;
}

function buildRouteEdgeSets(roundRows) {
  const byRoute = {};
  for (const name of ROUTE_NAMES) {
    const row = roundRows.find((r) => normalizeRoute(r.chosen_route) === name && r.route_edges);
    if (!row) continue;
    byRoute[name] = row.route_edges.map((e) => ({
      key: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      freeTime: e.freeTime,
      capacity: e.capacity,
      baseFlow: e.baseFlow,
    }));
  }
  return byRoute;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/simulated-population/compute-ideal-baseline.mjs <room.json>");
    process.exit(1);
  }
  const { round_logs: roundLogs } = JSON.parse(fs.readFileSync(file, "utf8"));
  const byRound = new Map();
  for (const row of roundLogs) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }

  let pooledOptimalCost = 0;
  let pooledOptimalDelay = 0;
  let pooledCongestedEdges = 0;
  const n = [...byRound.values()][0].length;

  for (const [round, rows] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
    const routeEdgeSets = buildRouteEdgeSets(rows);
    const missing = ROUTE_NAMES.filter((n) => !routeEdgeSets[n]);
    if (missing.length) {
      console.error(`Round ${round}: missing topology for ${missing.join(", ")}, skipping`);
      continue;
    }
    const optimal = findOptimalSplit(routeEdgeSets, n);
    const freeFlowTotal = ROUTE_NAMES.reduce(
      (s, name) => s + optimal.counts[name] * routeEdgeSets[name].reduce((a, e) => a + e.freeTime, 0),
      0
    );
    const delay = optimal.cost - freeFlowTotal;
    const edgeFlows = computeEdgeFlows(routeEdgeSets, optimal.counts);
    let congested = 0;
    for (const [, e] of edgeFlows) if (e.flow / e.capacity > 2) congested++;

    console.log(`Round ${round}: optimal counts=${JSON.stringify(optimal.counts)} cost=${round2(optimal.cost)} delay=${round2(delay)} congestedEdges=${congested}`);

    pooledOptimalCost += optimal.cost;
    pooledOptimalDelay += delay;
    pooledCongestedEdges += congested;
  }

  console.log(`\nIdeal Baseline (n=${n}): Total Travel Time ${round2(pooledOptimalCost)}s, Total Delay ${round2(pooledOptimalDelay)}s, Congested Edges ${pooledCongestedEdges}, Gap 0.00%, Compliance 100%`);
}

main();
