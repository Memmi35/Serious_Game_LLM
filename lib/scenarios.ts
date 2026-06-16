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
    bottleneckEdge: "2-2->2-3",
    bottleneckCapacity: 3,
    bottleneckFreeTime: 0.8,
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
      "4-3->3-3"
    ],
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
    fastFreeTime: 0.4,
    fastCorridor: [
      "0-4->1-4",
      "1-4->2-4",
      "2-4->3-4",
      "3-4->4-4",
    ],
  },
]
