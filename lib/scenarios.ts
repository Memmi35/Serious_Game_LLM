// lib/scenarios.ts

export interface Scenario {
  round: number
  name: string
  title: string
  icon: string
  description: string

  origin: string
  destination: string

  defaultFlow: number
  defaultCapacity: number
  defaultFreeTime: number

  centerFlow?: number
  centerNodes?: string[]

  bottleneckEdge?: string
  bottleneckCapacity?: number
  bottleneckFreeTime?: number

  blockedEdges?: string[]

  fastCorridor?: string[]
  fastCapacity?: number
  fastFreeTime?: number

  // Optional per-edge free-time overrides, keyed the same way as
  // bottleneckEdge / blockedEdges (e.g. "1-1->2-1"). generateEdges() in
  // traffic.ts checks this map first and falls back to defaultFreeTime
  // when an edge isn't present here.
  edgeFreeTimes?: Record<string, number>
}

export const CENTER_NODES = [
  "1-1",
  "1-2",
  "1-3",
  "2-1",
  "2-2",
  "2-3",
  "3-1",
  "3-2",
  "3-3",
]

// --- helpers for generating deterministic per-edge variation ---

/**
 * Deterministic pseudo-random number in [0, 1) derived from a string seed.
 * Using a hash instead of Math.random() means the same edge key always
 * produces the same value across reloads/sessions, so a scenario stays
 * reproducible while still varying edge-to-edge.
 */
function seededRandom(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  }
  return ((h >>> 0) % 10000) / 10000
}

/** Deterministic random value in [min, max], rounded to 2 decimals. */
function randomInRange(edgeKey: string, min: number, max: number): number {
  const r = seededRandom(edgeKey) // [0, 1)
  return Math.round((min + r * (max - min)) * 100) / 100
}

/**
 * Generates all directed edges for an NxN grid of nodes named "x-y"
 * (0-indexed), connecting only orthogonal neighbors (no diagonals).
 * Matches generateNodes()/generateEdges() in traffic.ts.
 */
function generateGridEdges(size = 5): string[] {
  const edges: string[] = []
  for (let a = 0; a < size; a++) {
    for (let b = 0; b < size; b++) {
      const node = `${a}-${b}`
      if (a + 1 < size) {
        edges.push(`${node}->${a + 1}-${b}`)
        edges.push(`${a + 1}-${b}->${node}`)
      }
      if (b + 1 < size) {
        edges.push(`${node}->${a}-${b + 1}`)
        edges.push(`${a}-${b + 1}->${node}`)
      }
    }
  }
  return edges
}

/** Every edge gets a deterministic random free time in [min, max]. */
function generateRangedFreeTimes(min: number, max: number, size = 5): Record<string, number> {
  const edges = generateGridEdges(size)
  const result: Record<string, number> = {}
  for (const e of edges) {
    result[e] = randomInRange(e, min, max)
  }
  return result
}

/**
 * Every edge gets a random free time in `normalRange`, EXCEPT edges that
 * touch any node in `specialNodes` (one endpoint is in that list), which
 * instead get a random free time in `specialRange`.
 */
function generateTieredFreeTimes(
  specialNodes: string[],
  normalRange: [number, number],
  specialRange: [number, number],
  size = 5
): Record<string, number> {
  const edges = generateGridEdges(size)
  const result: Record<string, number> = {}
  for (const e of edges) {
    const [from, to] = e.split("->")
    const isSpecial = specialNodes.includes(from) || specialNodes.includes(to)
    const [min, max] = isSpecial ? specialRange : normalRange
    result[e] = randomInRange(e, min, max)
  }
  return result
}

export const SCENARIOS: Scenario[] = [
  {
    round: 1,
    name: "Baseline Clean Network",
    title: "Baseline Exploration",
    icon: "🧭",
    description:     "Welcome! Traffic is light and the network is running smoothly. Explore different routes and discover which paths get you to your destination the fastest.",
    origin: "0-0",
    destination: "4-4",
    defaultFlow: 19, // was 15 — closer to defaultCapacity so the 30 agents' own load pushes ratios past 1 more readily
    defaultCapacity: 22, // was 32 (tried 18: combined with the wider range this backfired like round 3's broad tightening did — reverted)
    defaultFreeTime: 1.2,
    // Every edge randomized in [0.9, 1.6] (was [1.1, 1.3]) — round 1 has no
    // bottleneck/center/corridor override to create asymmetry between routes,
    // so widening the per-edge spread is the only way to make some routes
    // meaningfully better than others by chance. (Tried [0.7,1.9]: wider
    // than this overshot and the gap dropped back down — reverted to [0.9,1.6].)
    edgeFreeTimes: generateRangedFreeTimes(0.9, 1.6),
  },
  {
    round: 2,
    name: "Spatial Congestion",
    title: "Urban Center Congestion",
    icon: "🚦",
    description: "The city center is packed with vehicles. Will you risk the busy shortcut through downtown, or take a longer route around the congestion?",
    origin: "4-4",
    destination: "1-1",
    defaultFlow:  10,
    defaultCapacity: 26, // was 38 — tightened for a 30-agent population
    defaultFreeTime: 1.2,
    centerNodes: CENTER_NODES,
    centerFlow: 22, // was 25, then 32, then 38, then 27, then 23, then 20 — heavier downtown background load
    // Peripheral edges [1.1, 1.3]; edges touching the center 3x3 block [1.6, 1.9] (was [1.4, 1.5]).
    edgeFreeTimes: generateTieredFreeTimes(CENTER_NODES, [1.1, 1.3], [1.6, 1.9]),
  },
  {
    round: 3,
    name: "Bottleneck Effect",
    title: "Critical Bottleneck Formation",
    icon: "🚦",
    description: "One critical road has become a major bottleneck. It looks attractive on the map, but heavy delays may be waiting. Can you spot the trap before everyone else does?" ,
    origin: "1-1",
    destination: "3-3",
    defaultFlow: 15,
    defaultCapacity: 23, // was 33 — tightened for a 30-agent population. (Tried 19: uniformly
                          // tightening capacity squeezes actual AND optimal together and lowers
                          // the % gap rather than raising it — reverted.)
    defaultFreeTime: 1.2,

    bottleneckEdge: "2-3->3-3",
    bottleneckCapacity: 16,   // was 27, then 20. Kept tight — this is the trap. (Tried 10: pushed it
                              // below defaultFlow=15's own background traffic, so the edge is already
                              // over its own capacity before any of the 30 agents pick it — that made
                              // it look bad enough to lose its temptation and lowered the gap. Reverted.)
    bottleneckFreeTime: 1.3, // was 1.9, then 2.0, then 0.9, then 1.25, then 1.45, then 1.35, then 1.28. Previously the "bottleneck"
                              // was slower than every other approach into the
                              // destination, so it was never actually
                              // attractive and every top-3-shortest route
                              // converged onto it anyway (it just happened to
                              // be the least-bad of several equally-slow
                              // options). Now it's faster than default
                              // (matches the scenario's "looks attractive on
                              // the map" framing) but low-capacity, so it's a
                              // genuine temptation instead of a forced funnel.

    // Other approaches into the destination are now near-normal speed (not
    // uniformly slow like the old [1.9,2.2] tier), so a route through, say,
    // 3-2->3-3 or 4-3->3-3 is a real "safe but not fastest" alternative
    // instead of being just as bad as the trap.
    edgeFreeTimes: generateTieredFreeTimes(["3-3"], [1.1, 1.3], [1.3, 1.5]),
  },
  {
    round: 4,
    name: "Network Disruption",
    title: "Partial Network Closure",
    icon: "🚧",
    description: "Several roads are unexpectedly closed. Your usual routes may no longer work, so you'll need to adapt and find a new way through the network.",
    origin: "3-3",
    destination: "0-0",
    defaultFlow: 14,         // was 10: at flow=10/cap=25 the predicted-vs-free
                              // gap was ~0.56% (imperceptible). 14/22 below
                              // brings it to a felt ~3.2% gap in the split
                              // case while keeping worst-case load (40
                              // players on one edge) at a sane BPR x6.4.
    defaultCapacity: 16,     // was 22 (originally 25) — tightened further for a 30-agent population
    defaultFreeTime: 1.2,
    blockedEdges: [
      "1-1->2-1",
      "2-1->1-1",
      "2-2->2-3",
      "2-3->2-2",
      "3-3->4-3",
      "4-3->3-3",
      // Added to widen the disruption -- swap these for whatever you want.
      "1-2->1-3",
      "1-3->1-2",
      "3-1->3-2",
      "3-2->3-1",
    ],
    // Remaining (non-blocked) edges randomized in [1.0, 1.4].
    edgeFreeTimes: generateRangedFreeTimes(1.0, 1.4),
  },
  {
    round: 5,
    name: "Express Corridor Competition",
    title: "High-Speed Corridor vs Congestion",
    icon: "⚡",
    description: "A brand-new express corridor promises lightning-fast travel times. But if too many players rush toward it, will it still be the best choice?",
    origin: "0-0",
    destination: "4-4",
    defaultFlow: 14,          // was 10
    defaultCapacity: 18,      // was 24 (originally 20) — tightened for a 30-agent population
    defaultFreeTime: 1.2,
    fastCapacity: 26,         // was 50 — at 50 the corridor never actually got
                              // congested (max ratio ~0.9 with all 30 agents),
                              // so the scenario's "risk of overcrowding it"
                              // premise never landed. 26 makes overuse real.
    fastFreeTime: 1.45,       // was 0.7 — at 0.7 (vs ~1.3-1.5 elsewhere) the
                              // corridor was such a dominant shortcut that
                              // every one of the top-3 shortest routes rode
                              // its final 3 hops regardless of chosen route,
                              // so "risk overcrowding it or not" wasn't a real
                              // choice. 1.35 keeps it competitive without
                              // forcing every candidate route onto its tail.
    fastCorridor: [
      "0-4->1-4",
      "1-4->2-4",
      "2-4->3-4",
      "3-4->4-4",
    ],
    // Non-corridor edges randomized in [1.3, 1.5]; corridor edges still get
    // overridden to fastFreeTime (0.7) by the existing fastCorridor check.
    edgeFreeTimes: generateRangedFreeTimes(1.3, 1.5),
  },
]