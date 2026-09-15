#!/usr/bin/env node
// Computes the "base table" metrics -- Total Travel Time, Total Delay,
// Congested Edges (tau>2), Gap-to-Optimal, Compliance -- using ONLY the
// opening-pitch / first-choice decision (row.initial_choice), never
// row.chosen_route. This is the standing convention established after the
// switch-phase deep-dive: switch-phase noise (including the advisor's own
// recommendation sometimes changing between phases) was confounding every
// metric, so "compliance"/"gap"/etc. now always mean first-choice unless
// explicitly stated otherwise. See project roadmap memory.
//
// Gap-to-Optimal uses the corrected, bounded, POOLED formula (not the old
// per-round-average-of-ratios method compute-metrics.mjs still uses, which
// can produce contradictions and isn't bounded at 100%):
//   Gap% = (SUM(T_actual) - SUM(T_optimal)) / SUM(T_actual) * 100
// summed across all rounds' totals, then computed once -- not averaged
// per-round. Denominator is T_actual (not T_optimal), so this cannot
// mathematically exceed 100%.
//
// Topology cache: if a round has no first-choice on some route (so its
// route_edges can't be read from this room's own rows), pass
// --topology-ref=<room.json> to borrow that round's edge template from a
// reference room with full coverage every round (topology is identical
// across rooms for a given round in this project -- same technique used
// for 673N round 5 and the 27WB no-advisor reference row).
//
// Usage:
//   node scripts/simulated-population/compute-first-choice-metrics.mjs <room.json> [more.json ...] [--out=<dir>] [--topology-ref=<room.json>]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOptimalSplit, computeEdgeFlows, systemCost } from "./optimal-split.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROUTE_NAMES = ["Route A", "Route B", "Route C"];

function parseArgs(argv) {
  const files = [];
  let outDir = path.join(REPO_ROOT, "results", "_metrics");
  let topologyRefPath = null;
  for (const arg of argv) {
    if (arg.startsWith("--out=")) outDir = arg.slice("--out=".length);
    else if (arg.startsWith("--topology-ref=")) topologyRefPath = arg.slice("--topology-ref=".length);
    else files.push(arg);
  }
  if (!files.length) {
    console.error(
      "Usage: node scripts/simulated-population/compute-first-choice-metrics.mjs <room.json> [more.json ...] [--out=<dir>] [--topology-ref=<room.json>]"
    );
    process.exit(1);
  }
  return { files, outDir, topologyRefPath };
}

function normalizeRoute(r) {
  if (!r) return null;
  return r.startsWith("Route") ? r : `Route ${r}`;
}

function round2(x) {
  return x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100;
}

function buildRouteEdgeSets(roundRows, field) {
  const byRoute = {};
  for (const name of ROUTE_NAMES) {
    const row = roundRows.find((r) => normalizeRoute(r[field]) === name && r.route_edges);
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

// Builds { round -> { "Route A": edges, ... } } from a reference room's own
// exported data, regardless of which field that room's rows happen to
// cover each route on -- used only to backfill a missing route's topology,
// never its choices.
function buildTopologyCache(exportData) {
  const { round_logs: roundLogs } = exportData;
  const byRound = new Map();
  for (const row of roundLogs) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }
  const cache = {};
  for (const [round, rows] of byRound) {
    const initial = buildRouteEdgeSets(rows, "initial_choice");
    const final = buildRouteEdgeSets(rows, "chosen_route");
    cache[round] = { ...final, ...initial }; // prefer initial_choice coverage when both exist
  }
  return cache;
}

// Congested edges: count of (round, edge) pairs whose actual first-choice
// flow/capacity ratio exceeds 2, summed across all rounds this room has --
// matches the tau>2 column definition used in the base table.
function computeTrafficMetrics(roundLogs, topologyCache) {
  const byRound = new Map();
  for (const row of roundLogs) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }

  const perRound = [];
  let pooledActual = 0;
  let pooledOptimal = 0;
  let pooledDelay = 0;
  let congestedEdgeCount = 0;
  let roundsWithOptimal = 0;

  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const rows = byRound.get(round);
    const n = rows.length;
    const actualCounts = { "Route A": 0, "Route B": 0, "Route C": 0 };
    for (const row of rows) {
      const choice = normalizeRoute(row.initial_choice);
      if (choice) actualCounts[choice] = (actualCounts[choice] || 0) + 1;
    }

    let routeEdgeSets = buildRouteEdgeSets(rows, "initial_choice");
    const missingRoutes = ROUTE_NAMES.filter((name) => !routeEdgeSets[name]);
    if (missingRoutes.length > 0 && topologyCache && topologyCache[round]) {
      routeEdgeSets = { ...topologyCache[round], ...routeEdgeSets };
    }
    const stillMissing = ROUTE_NAMES.filter((name) => !routeEdgeSets[name]);

    if (stillMissing.length > 0) {
      perRound.push({
        round,
        n,
        actual: { counts: actualCounts },
        optimal: null,
        congestedEdges: null,
        note: `optimal unavailable: no first-choice on ${stillMissing.join(", ")} and no topology-ref given`,
      });
      continue;
    }

    // System cost of THIS round's actual first-choice distribution (not a
    // per-row predicted/realized field, which reflect individually-computed
    // pre-crowding or post-switch-crowding times respectively, neither of
    // which is the "if everyone froze at their first choice" system cost
    // this table needs) -- same systemCost() function findOptimalSplit
    // itself calls internally, just fed the actual counts instead of the
    // argmin ones, so this can't drift from the optimal figure's own logic.
    const actualTotalCost = systemCost(routeEdgeSets, actualCounts);
    const freeFlowTotal = ROUTE_NAMES.reduce(
      (s, name) => s + actualCounts[name] * routeEdgeSets[name].reduce((a, e) => a + e.freeTime, 0),
      0
    );
    const totalDelay = actualTotalCost - freeFlowTotal;

    const optimal = findOptimalSplit(routeEdgeSets, n);
    const edgeFlows = computeEdgeFlows(routeEdgeSets, actualCounts);
    let roundCongested = 0;
    const congestionRatios = {};
    for (const [key, e] of edgeFlows) {
      const ratio = e.flow / e.capacity;
      congestionRatios[key] = round2(ratio);
      if (ratio > 2) roundCongested++;
    }
    congestedEdgeCount += roundCongested;

    perRound.push({
      round,
      n,
      actual: { counts: actualCounts, totalCost: round2(actualTotalCost), avgCost: round2(actualTotalCost / n) },
      totalDelay: round2(totalDelay),
      optimal: { counts: optimal.counts, totalCost: round2(optimal.cost), avgCost: round2(optimal.cost / n) },
      congestedEdges: roundCongested,
      congestionRatios,
    });

    pooledActual += actualTotalCost;
    pooledOptimal += optimal.cost;
    pooledDelay += totalDelay;
    roundsWithOptimal++;
  }

  const gapPct = pooledActual > 0 ? round2(((pooledActual - pooledOptimal) / pooledActual) * 100) : null;

  return {
    perRound,
    pooledTotalTravelTime: round2(pooledActual),
    pooledTotalDelay: round2(pooledDelay),
    pooledOptimalTravelTime: round2(pooledOptimal),
    congestedEdges: congestedEdgeCount,
    roundsWithOptimal,
    gapToOptimalPct: gapPct,
  };
}

function computeComplianceMetrics(roundLogs) {
  let total = 0, complied = 0, missingRecommendation = 0;
  const byRound = {};
  for (const row of roundLogs) {
    const recommended = normalizeRoute(row.ai_recommended_route);
    if (!recommended) { missingRecommendation++; continue; }
    total++;
    const isCompliant = normalizeRoute(row.initial_choice) === recommended;
    if (isCompliant) complied++;
    byRound[row.round] = byRound[row.round] || { total: 0, complied: 0 };
    byRound[row.round].total++;
    if (isCompliant) byRound[row.round].complied++;
  }
  const byRoundPct = {};
  for (const [round, stats] of Object.entries(byRound)) {
    byRoundPct[round] = round2((stats.complied / stats.total) * 100);
  }
  return {
    successRatePct: total ? round2((complied / total) * 100) : null,
    decisionsWithRecommendation: total,
    decisionsMissingRecommendation: missingRecommendation,
    byRound: byRoundPct,
  };
}

function computeRoomMetrics(exportData, topologyCache) {
  const { room, round_logs: roundLogs } = exportData;
  return {
    room_id: room.id,
    agent_condition: room.agent_condition,
    persuader_model: room.persuader_model || null,
    total_rounds: room.total_rounds,
    agent_count: new Set(roundLogs.map((r) => r.session_id)).size,
    traffic: computeTrafficMetrics(roundLogs, topologyCache),
    compliance: computeComplianceMetrics(roundLogs),
  };
}

function main() {
  const { files, outDir, topologyRefPath } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(outDir, { recursive: true });

  const topologyCache = topologyRefPath
    ? buildTopologyCache(JSON.parse(fs.readFileSync(topologyRefPath, "utf8")))
    : null;

  const allMetrics = [];
  for (const file of files) {
    const exportData = JSON.parse(fs.readFileSync(file, "utf8"));
    const metrics = computeRoomMetrics(exportData, topologyCache);
    allMetrics.push(metrics);

    const outPath = path.join(outDir, `${metrics.room_id}-first-choice-metrics.json`);
    fs.writeFileSync(outPath, JSON.stringify(metrics, null, 2));
    console.log(
      `${metrics.room_id} (${metrics.persuader_model || metrics.agent_condition}): ` +
        `Total Travel Time ${metrics.traffic.pooledTotalTravelTime}s, Total Delay ${metrics.traffic.pooledTotalDelay}s, ` +
        `Congested Edges ${metrics.traffic.congestedEdges}, Gap-to-Optimal ${metrics.traffic.gapToOptimalPct}%, ` +
        `Compliance ${metrics.compliance.successRatePct}% -> ${outPath}`
    );
  }
}

main();
