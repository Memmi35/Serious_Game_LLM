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
    icon: "🟢",
    description: "A low-congestion network with free-flowing traffic. Users explore the system under normal conditions where shortest paths are generally optimal.",
    origin: "0-0",
    destination: "4-4",
    defaultFlow: 4,
    defaultCapacity: 14,
    defaultFreeTime: 1.2,
    // Every edge randomized in [1.1, 1.3].
    edgeFreeTimes: generateRangedFreeTimes(1.1, 1.3),
  },
  {
    round: 2,
    name: "Spatial Congestion",
    title: "Urban Center Congestion",
    icon: "🟡",
    description: "The central area becomes highly congested while peripheral routes remain relatively free. Users must balance distance against avoiding the crowded center.",
    origin: "4-4",
    destination: "1-1",
    defaultFlow: 3,
    defaultCapacity: 12,
    defaultFreeTime: 1.2,
    centerNodes: CENTER_NODES,
    centerFlow: 9,
    // Peripheral edges [1.1, 1.3]; edges touching the center 3x3 block [1.4, 1.5].
    edgeFreeTimes: generateTieredFreeTimes(CENTER_NODES, [1.1, 1.3], [1.4, 1.5]),
  },
  {
    round: 3,
    name: "Bottleneck Effect",
    title: "Critical Bottleneck Formation",
    icon: "🟠",
    description: "A key link becomes a severe bottleneck, creating hidden congestion on an otherwise attractive route. Users must learn to avoid overloaded shortcuts.",
    origin: "1-1",
    destination: "3-3",
    defaultFlow: 4,
    defaultCapacity: 11,
    defaultFreeTime: 1.2,
    // Edges touching the destination node are the bottleneck: [1.9, 2.0].
    // All other (peripheral) edges are [1.1, 1.3].
    edgeFreeTimes: generateTieredFreeTimes(["3-3"], [1.1, 1.3], [1.9, 2.0]),
  },
  {
    round: 4,
    name: "Network Disruption",
    title: "Partial Network Closure",
    icon: "🔴",
    description: "Several important links are closed, forcing rerouting across the network. Users must adapt quickly to structural disruptions and find alternative paths.",
    origin: "3-3",
    destination: "0-0",
    defaultFlow: 5,
    defaultCapacity: 10,
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
    icon: "🔵",
    description: "A fast express corridor competes with regular congested routes. Users must decide between a high-capacity shortcut and potentially shorter but slower alternatives.",
    origin: "0-0",
    destination: "4-4",
    defaultFlow: 6,
    defaultCapacity: 9,
    defaultFreeTime: 1.2,
    fastCapacity: 18,
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