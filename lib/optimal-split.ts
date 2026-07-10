// System-optimal route-split computation for the Next.js app side (PersuLLM
// advisor). Mirrors scripts/simulated-population/optimal-split.mjs — kept as
// a separate .ts file since the scripts/ side runs as standalone Node ESM
// and can't import .ts directly (see that file's header comment). Keep the
// two in sync if the underlying math changes.

import { bprTime, type Route } from "./traffic-simulation";

const ROUTE_NAMES = ["Route A", "Route B", "Route C"] as const;

type EdgeKey = { key: string; freeTime: number; capacity: number; baseFlow: number };
type RouteEdgeSets = Record<string, EdgeKey[]>;
type Counts = Record<string, number>;

export function routeEdgeSetsFromRoutes(routes: Record<string, Route>): RouteEdgeSets {
  const result: RouteEdgeSets = {};
  for (const name of ROUTE_NAMES) {
    result[name] = routes[name].edges.map((e) => ({
      key: `${e.from}->${e.to}`,
      freeTime: e.freeTime,
      capacity: e.capacity,
      baseFlow: e.baseFlow,
    }));
  }
  return result;
}

export function systemCost(routeEdgeSets: RouteEdgeSets, counts: Counts): number {
  const edgeFlow = new Map<string, { freeTime: number; capacity: number; flow: number }>();
  for (const name of ROUTE_NAMES) {
    for (const e of routeEdgeSets[name]) {
      const entry = edgeFlow.get(e.key) || { freeTime: e.freeTime, capacity: e.capacity, flow: e.baseFlow };
      entry.flow += counts[name] ?? 0;
      edgeFlow.set(e.key, entry);
    }
  }
  const timeByKey = new Map<string, number>();
  for (const [key, e] of edgeFlow) timeByKey.set(key, bprTime(e.freeTime, e.flow, e.capacity));

  let total = 0;
  for (const name of ROUTE_NAMES) {
    total += (counts[name] ?? 0) * routeEdgeSets[name].reduce((s, e) => s + (timeByKey.get(e.key) ?? 0), 0);
  }
  return total;
}

export function findOptimalSplit(routeEdgeSets: RouteEdgeSets, n: number): { counts: Counts; cost: number } {
  let best: { counts: Counts; cost: number } | null = null;
  for (let a = 0; a <= n; a++) {
    for (let b = 0; b <= n - a; b++) {
      const c = n - a - b;
      const counts: Counts = { "Route A": a, "Route B": b, "Route C": c };
      const cost = systemCost(routeEdgeSets, counts);
      if (!best || cost < best.cost) best = { counts, cost };
    }
  }
  return best!;
}
