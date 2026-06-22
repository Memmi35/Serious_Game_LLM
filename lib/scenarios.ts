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
    defaultFlow: 15,
    defaultCapacity: 32,
    defaultFreeTime: 1.2,
    // Every edge randomized in [1.1, 1.3].
    edgeFreeTimes: generateRangedFreeTimes(1.1, 1.3),
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
    defaultCapacity: 38,
    defaultFreeTime: 1.2,
    centerNodes: CENTER_NODES,
    centerFlow: 25,
    // Peripheral edges [1.1, 1.3]; edges touching the center 3x3 block [1.4, 1.5].
    edgeFreeTimes: generateTieredFreeTimes(CENTER_NODES, [1.1, 1.3], [1.4, 1.5]),
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
    defaultCapacity: 33,
    defaultFreeTime: 1.2,

    bottleneckEdge: "2-3->3-3",
    bottleneckCapacity: 27,   // restored from 10 -> 20: at cap=10, worst-case
                              // 40-player load on this edge hit ratio 5.5
                              // (BPR x138), which reads as broken rather than
                              // "severe bottleneck". cap=20 keeps it the
                              // clearly-worst option (split-case BPR x1.6,
                              // ~60% slower than free flow) without blowing up
                              // if players herd onto it.
    bottleneckFreeTime: 1.9,

    // You can keep or adjust the randomized times around the destination
    edgeFreeTimes: generateTieredFreeTimes(["3-3"], [1.1, 1.3], [1.9, 2.0]),
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
    defaultCapacity: 22,     // was 25
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
    defaultCapacity: 24,      // was 20
    defaultFreeTime: 1.2,
    fastCapacity: 50,
    fastFreeTime: 0.7,
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