// Shared system-optimal route-split logic. Used by optimal-vs-actual.mjs
// (post-hoc analysis) and by the Phase B switch-decision flow in
// run-population.mjs (live, mid-round) — both need the same "given these 3
// routes' edges and N travelers, what split minimizes total system travel
// time" computation, so it lives in one place instead of three.

export function bprTime(freeTime, flow, capacity) {
  return freeTime * (1 + 0.15 * Math.pow(flow / capacity, 4));
}

const ROUTE_NAMES = ["Route A", "Route B", "Route C"];

// routeEdgeSets: { "Route A": [{key, from, to, freeTime, capacity, baseFlow}], ... }
export function systemCost(routeEdgeSets, counts) {
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

export function findOptimalSplit(routeEdgeSets, n) {
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

// Builds { "Route A": [...edges], ... } from a get-state-shaped `routes`
// object (routes[name].path) plus the flat `network.edges` list — this is
// the shape run-population.mjs and test-round.mjs both already have on
// hand, so no extra API call is needed to compute the optimal split live.
export function routeEdgeSetsFromState(routes, networkEdges) {
  const routeEdgeSets = {};
  for (const name of ROUTE_NAMES) {
    const path = routes[name].path;
    const edges = [];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const edge =
        networkEdges.find((e) => e.from === from && e.to === to) ??
        networkEdges.find((e) => e.from === to && e.to === from);
      edges.push({ key: `${from}->${to}`, freeTime: edge.free_time, capacity: edge.capacity, baseFlow: edge.base_flow });
    }
    routeEdgeSets[name] = edges;
  }
  return routeEdgeSets;
}
