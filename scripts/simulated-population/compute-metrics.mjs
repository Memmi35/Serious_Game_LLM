#!/usr/bin/env node
// Computes every metric for one or more simulated-population rooms purely
// from their exported JSON files (export-room.mjs's SELECT * output) — no
// live database connection needed. Point it at the already-archived
// results/<label>/<ROOM>.json files and it recomputes everything offline:
//
//   - Traffic: per-round actual-vs-system-optimal gap (same logic as
//     optimal-vs-actual.mjs, reusing optimal-split.mjs, but sourced from
//     the exported rows instead of a live query)
//   - Advisor compliance: fraction of decisions matching the advisor's
//     recommended route
//   - Switch behavior: per-round switch rate (herding indicator)
//   - Speed: wall-clock span and avg ms/decision, from round_logs.created_at
//   - Data quality: population-side fallback/mock counts (choice_reason
//     prefix), plus advisor-side fallback/code-fence signatures inside
//     persuasion_transcript/switch_transcript — the blind spot that
//     room-analysis.mjs's data_quality block doesn't catch, since a failed
//     advisor call degrades gracefully into believable-looking text
//     instead of a tagged fallback string.
//
// Usage:
//   node scripts/simulated-population/compute-metrics.mjs <room.json> [more.json ...] [--out=<dir>]
//
// Example:
//   node scripts/simulated-population/compute-metrics.mjs results/*/*.json --out=results/_metrics
//
// Writes one <room_id>-metrics.json per input file, plus a single
// comparison-summary.json/.md across all inputs given in one invocation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOptimalSplit, computeEdgeFlows } from "./optimal-split.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROUTE_NAMES = ["Route A", "Route B", "Route C"];

function parseArgs(argv) {
  const files = [];
  let outDir = path.join(REPO_ROOT, "results", "_metrics");
  for (const arg of argv) {
    if (arg.startsWith("--out=")) outDir = arg.slice("--out=".length);
    else files.push(arg);
  }
  if (!files.length) {
    console.error("Usage: node scripts/simulated-population/compute-metrics.mjs <room.json> [more.json ...] [--out=<dir>]");
    process.exit(1);
  }
  return { files, outDir };
}

// Advisor stores route as bare letter ("A"); population stores full name
// ("Route A") — normalize both to the full-name form for comparison.
function normalizeRoute(r) {
  if (!r) return null;
  return r.startsWith("Route") ? r : `Route ${r}`;
}

function buildRouteEdgeSets(roundRows) {
  const byRoute = {};
  for (const name of ROUTE_NAMES) {
    const row = roundRows.find((r) => r.chosen_route === name);
    if (!row || !row.route_edges) continue;
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

// Free-flow time for one decision's chosen route = sum of each edge's
// freeTime (BPR at flow=0 reduces to exactly freeTime — see bprTime in
// optimal-split.mjs). Delay for that traveler is realized_time minus this.
function freeFlowTime(row) {
  if (!row.route_edges) return null;
  return row.route_edges.reduce((s, e) => s + (e.freeTime ?? 0), 0);
}

function computeTrafficMetrics(roundLogs) {
  const byRound = new Map();
  for (const row of roundLogs) {
    if (!byRound.has(row.round)) byRound.set(row.round, []);
    byRound.get(row.round).push(row);
  }

  const perRound = [];
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const rows = byRound.get(round);
    const n = rows.length;
    const actualCounts = { "Route A": 0, "Route B": 0, "Route C": 0 };
    let actualTotalCost = 0;
    let totalDelay = 0;
    for (const row of rows) {
      actualCounts[row.chosen_route] = (actualCounts[row.chosen_route] || 0) + 1;
      const realized = parseFloat(row.realized_time) || 0;
      actualTotalCost += realized;
      const freeFlow = freeFlowTime(row);
      if (freeFlow != null) totalDelay += realized - freeFlow;
    }

    const routeEdgeSets = buildRouteEdgeSets(rows);
    const missingRoutes = ROUTE_NAMES.filter((name) => !routeEdgeSets[name]);
    if (missingRoutes.length > 0) {
      perRound.push({
        round,
        n,
        actual: { counts: actualCounts, totalCost: round2(actualTotalCost), avgCost: round2(actualTotalCost / n) },
        totalDelay: round2(totalDelay),
        optimal: null,
        congestionRatios: null,
        note: `optimal unavailable: no agent chose ${missingRoutes.join(", ")}`,
      });
      continue;
    }

    const optimal = findOptimalSplit(routeEdgeSets, n);

    // Congestion ratio (flow/capacity) per edge actually used this round,
    // under the population's real distribution — same edge-flow assignment
    // systemCost uses internally, so this can't drift from the gap figure.
    const edgeFlows = computeEdgeFlows(routeEdgeSets, actualCounts);
    const congestionRatios = {};
    for (const [key, e] of edgeFlows) congestionRatios[key] = round2(e.flow / e.capacity);

    perRound.push({
      round,
      n,
      actual: { counts: actualCounts, totalCost: round2(actualTotalCost), avgCost: round2(actualTotalCost / n) },
      totalDelay: round2(totalDelay),
      optimal: { counts: optimal.counts, totalCost: round2(optimal.cost), avgCost: round2(optimal.cost / n) },
      gapPct: round2(((actualTotalCost - optimal.cost) / optimal.cost) * 100),
      congestionRatios,
    });
  }

  const validGaps = perRound.filter((r) => r.gapPct != null).map((r) => r.gapPct);
  const avgGapPct = validGaps.length ? round2(validGaps.reduce((a, b) => a + b, 0) / validGaps.length) : null;
  const avgTotalDelay = round2(perRound.reduce((s, r) => s + (r.totalDelay || 0), 0) / perRound.length);
  return { perRound, avgGapPct, avgTotalDelay };
}

function computeComplianceMetrics(roundLogs) {
  let total = 0, complied = 0, missingRecommendation = 0;
  const byRound = {};
  for (const row of roundLogs) {
    const recommended = normalizeRoute(row.ai_recommended_route);
    if (!recommended) { missingRecommendation++; continue; }
    total++;
    const isCompliant = row.chosen_route === recommended;
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

function computeSwitchMetrics(roundLogs) {
  const byRound = {};
  for (const row of roundLogs) {
    byRound[row.round] = byRound[row.round] || { total: 0, switched: 0 };
    byRound[row.round].total++;
    if (row.initial_choice && row.final_choice && row.initial_choice !== row.final_choice) {
      byRound[row.round].switched++;
    }
  }
  const byRoundPct = {};
  let totalSwitched = 0, totalDecisions = 0;
  for (const [round, stats] of Object.entries(byRound)) {
    byRoundPct[round] = { switched: stats.switched, total: stats.total, pct: round2((stats.switched / stats.total) * 100) };
    totalSwitched += stats.switched;
    totalDecisions += stats.total;
  }
  return { byRound: byRoundPct, avgSwitchRatePct: totalDecisions ? round2((totalSwitched / totalDecisions) * 100) : null };
}

function computeSpeedMetrics(roundLogs) {
  const timestamps = roundLogs.map((r) => new Date(r.created_at).getTime()).filter((t) => !Number.isNaN(t));
  if (!timestamps.length) return { wallClockMinutes: null, avgMsPerDecision: null };
  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const totalMs = last - first;
  return {
    wallClockMinutes: round2(totalMs / 60000),
    avgMsPerDecision: Math.round(totalMs / roundLogs.length),
  };
}

function computeDataQuality(roundLogs) {
  let fallbackDecisions = 0, mockDecisions = 0, advisorFallbackSignatures = 0, codeFenceSignatures = 0;
  for (const row of roundLogs) {
    const reason = row.choice_reason || "";
    if (reason.startsWith("[llm fallback]")) fallbackDecisions++;
    if (reason.startsWith("[mock LLM]")) mockDecisions++;
    for (const transcript of [row.persuasion_transcript, row.switch_transcript]) {
      for (const turn of transcript || []) {
        if (turn.text.includes("mock mode") || turn.text.includes("offline fallback")) advisorFallbackSignatures++;
        if (turn.text.includes("```")) codeFenceSignatures++;
      }
    }
  }
  return {
    totalDecisions: roundLogs.length,
    realLlmDecisions: roundLogs.length - fallbackDecisions - mockDecisions,
    fallbackDecisions,
    mockDecisions,
    advisorFallbackSignatures,
    codeFenceSignatures,
  };
}

function round2(x) {
  return x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100;
}

function computeRoomMetrics(exportData) {
  const { room, round_logs: roundLogs } = exportData;
  return {
    room_id: room.id,
    agent_condition: room.agent_condition,
    persuader_model: room.persuader_model || null,
    total_rounds: room.total_rounds,
    agent_count: new Set(roundLogs.map((r) => r.session_id)).size,
    traffic: computeTrafficMetrics(roundLogs),
    compliance: computeComplianceMetrics(roundLogs),
    switching: computeSwitchMetrics(roundLogs),
    speed: computeSpeedMetrics(roundLogs),
    dataQuality: computeDataQuality(roundLogs),
  };
}

function main() {
  const { files, outDir } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(outDir, { recursive: true });

  const allMetrics = [];
  for (const file of files) {
    const exportData = JSON.parse(fs.readFileSync(file, "utf8"));
    const metrics = computeRoomMetrics(exportData);
    allMetrics.push(metrics);

    const outPath = path.join(outDir, `${metrics.room_id}-metrics.json`);
    fs.writeFileSync(outPath, JSON.stringify(metrics, null, 2));
    console.log(`${metrics.room_id} (${metrics.persuader_model || metrics.agent_condition}): avg gap ${metrics.traffic.avgGapPct}%, avg delay ${metrics.traffic.avgTotalDelay}s, compliance ${metrics.compliance.successRatePct}%, switch rate ${metrics.switching.avgSwitchRatePct}%, ${metrics.speed.avgMsPerDecision}ms/decision -> ${outPath}`);
  }

  if (allMetrics.length > 1) {
    const summaryPath = path.join(outDir, "comparison-summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(allMetrics, null, 2));

    const rows = allMetrics.map((m) => ({
      room: m.room_id,
      model: m.persuader_model || m.agent_condition,
      avg_gap_pct: m.traffic.avgGapPct,
      avg_delay_s: m.traffic.avgTotalDelay,
      compliance_pct: m.compliance.successRatePct,
      switch_rate_pct: m.switching.avgSwitchRatePct,
      ms_per_decision: m.speed.avgMsPerDecision,
      fallback_signatures: m.dataQuality.advisorFallbackSignatures,
    }));
    const mdPath = path.join(outDir, "comparison-summary.md");
    const header = "| Room | Model | Avg gap % | Avg delay (s) | Compliance % | Switch rate % | ms/decision | Fallback signatures |\n|---|---|---|---|---|---|---|---|\n";
    const body = rows.map((r) => `| ${r.room} | ${r.model} | ${r.avg_gap_pct} | ${r.avg_delay_s} | ${r.compliance_pct} | ${r.switch_rate_pct} | ${r.ms_per_decision} | ${r.fallback_signatures} |`).join("\n");
    fs.writeFileSync(mdPath, header + body + "\n");

    console.log(`\nComparison summary -> ${summaryPath}`);
    console.log(`Comparison table -> ${mdPath}`);
  }
}

main();
