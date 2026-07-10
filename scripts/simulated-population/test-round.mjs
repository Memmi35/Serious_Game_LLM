#!/usr/bin/env node
// Fast iteration harness for retuning a single scenario round. Fast-forwards
// a fresh room straight to the target round (empty next_round calls — safe
// since room-action just skips the flow-mutation step when there are no
// round_logs yet), joins the 30 personas, plays that round only, then
// reports which edges are shared across all 3 candidate routes and the
// actual-vs-optimal gap. Supports --repeat=K to sample the gap multiple
// times, since a single run is noisy (softmax-sampled personas).
//
// Usage:
//   node scripts/simulated-population/test-round.mjs --round=3 [--base-url=http://localhost:3000] [--repeat=3]

import { PERSONAS } from "./personas.mjs";
import { decideRoute } from "./decide.mjs";

function parseArgs(argv) {
  const args = { baseUrl: "http://localhost:3000", round: null, repeat: 1 };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "base-url" && value) args.baseUrl = value.replace(/\/$/, "");
    if (key === "round" && value) args.round = parseInt(value, 10);
    if (key === "repeat" && value) args.repeat = parseInt(value, 10);
  }
  if (!args.round || args.round < 1 || args.round > 5) {
    throw new Error("Usage: --round=N (1-5) is required");
  }
  return args;
}

async function callApi(baseUrl, method, endpoint, body) {
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${endpoint} -> ${res.status} ${text}`);
  }
  return res.json();
}

function bprTime(freeTime, flow, capacity) {
  return freeTime * (1 + 0.15 * Math.pow(flow / capacity, 4));
}

const ROUTE_NAMES = ["Route A", "Route B", "Route C"];

function systemCost(routeEdgeSets, counts) {
  const edgeFlow = new Map();
  for (const name of ROUTE_NAMES) {
    for (const e of routeEdgeSets[name]) {
      const entry = edgeFlow.get(e.key) || { freeTime: e.freeTime, capacity: e.capacity, flow: e.baseFlow };
      entry.flow += counts[name];
      edgeFlow.set(e.key, entry);
    }
  }
  const timeByKey = new Map();
  for (const [key, e] of edgeFlow) timeByKey.set(key, bprTime(e.freeTime, e.flow, e.capacity));
  let total = 0;
  for (const name of ROUTE_NAMES) {
    total += counts[name] * routeEdgeSets[name].reduce((s, e) => s + timeByKey.get(e.key), 0);
  }
  return total;
}

function findOptimal(routeEdgeSets, n) {
  let best = null;
  for (let a = 0; a <= n; a++) {
    for (let b = 0; b <= n - a; b++) {
      const c = n - a - b;
      const counts = { "Route A": a, "Route B": b, "Route C": c };
      const cost = systemCost(routeEdgeSets, counts);
      if (!best || cost < best.cost) best = { counts, cost };
    }
  }
  return best;
}

async function playRound(baseUrl, round) {
  const createResult = await callApi(baseUrl, "POST", "/api/admin/create-room", { agent_condition: "baseline" });
  const roomId = createResult.room_id;

  await callApi(baseUrl, "POST", "/api/admin/room-action", { room_id: roomId, action: "start" });
  for (let i = 1; i < round; i++) {
    await callApi(baseUrl, "POST", "/api/admin/room-action", { room_id: roomId, action: "next_round" });
  }

  const sessions = [];
  for (const persona of PERSONAS) {
    const joinResult = await callApi(baseUrl, "POST", "/api/join-room", {
      room_id: roomId,
      user_name: `${persona.label} [${persona.id}]`,
    });
    sessions.push({ sessionId: joinResult.session_id, persona });
  }

  const routeCounts = {};
  for (const session of sessions) {
    const state = await callApi(baseUrl, "GET", `/api/get-state?session_id=${session.sessionId}`);
    if (state.current_round !== round) throw new Error(`Expected round ${round}, got ${state.current_round}`);

    const decision = decideRoute(session.persona, state.routes, state.network.edges, null, Math.random);

    await callApi(baseUrl, "POST", "/api/make-choice", {
      session_id: session.sessionId,
      chosen_route: decision.route,
      decision_latency: decision.decisionLatency,
    });

    routeCounts[decision.route] = (routeCounts[decision.route] || 0) + 1;
  }

  const finalState = await callApi(baseUrl, "GET", `/api/get-state?session_id=${sessions[0].sessionId}`);

  const routeEdgeSets = {};
  for (const name of ROUTE_NAMES) {
    const path = finalState.routes[name].path;
    const edges = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const edge =
        finalState.network.edges.find((e) => e.from === from && e.to === to) ??
        finalState.network.edges.find((e) => e.from === to && e.to === from);
      edges.push({ key: `${from}->${to}`, freeTime: edge.free_time, capacity: edge.capacity, baseFlow: edge.base_flow });
    }
    routeEdgeSets[name] = edges;
  }

  const keySets = ROUTE_NAMES.map((name) => new Set(routeEdgeSets[name].map((e) => e.key)));
  const shared = [...keySets[0]].filter((k) => keySets[1].has(k) && keySets[2].has(k));

  const n = sessions.length;
  const counts = { "Route A": routeCounts["Route A"] || 0, "Route B": routeCounts["Route B"] || 0, "Route C": routeCounts["Route C"] || 0 };
  const actualCost = systemCost(routeEdgeSets, counts);
  const optimal = findOptimal(routeEdgeSets, n);
  const gapPct = ((actualCost - optimal.cost) / optimal.cost) * 100;

  return { roomId, counts, optimal, actualCost, n, shared };
}

async function main() {
  const { baseUrl, round, repeat } = parseArgs(process.argv.slice(2));

  const gaps = [];
  for (let i = 0; i < repeat; i++) {
    const r = await playRound(baseUrl, round);
    const gapPct = ((r.actualCost - r.optimal.cost) / r.optimal.cost) * 100;
    gaps.push(gapPct);
    console.log(
      `[${r.roomId}] round ${round}: actual=${JSON.stringify(r.counts)} (avg=${(r.actualCost / r.n).toFixed(2)})` +
        `  optimal=${JSON.stringify(r.optimal.counts)} (avg=${(r.optimal.cost / r.n).toFixed(2)})` +
        `  gap=${gapPct.toFixed(2)}%  shared=${JSON.stringify(r.shared)}`
    );
  }

  if (repeat > 1) {
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    console.log(`\nround ${round}: gap over ${repeat} runs = [${gaps.map((g) => g.toFixed(2)).join(", ")}]  avg=${avg.toFixed(2)}%`);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
