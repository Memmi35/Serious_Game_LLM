"use client"

import { useCallback, useMemo } from "react"
import type { Node, EdgeParams, Route } from "@/lib/traffic-simulation"

interface TrafficGridProps {
  nodes: Node[]
  edges: EdgeParams[]
  origin: string
  destination: string
  selectedRoute?: Route | null
  availableRoutes?: Route[]
  hoveredRouteName?: string | null
  title?: string
  compact?: boolean
}

const ROUTE_COLORS: Record<string, string> = {
  "Route A": "var(--route-a)",
  "Route B": "var(--route-b)",
  "Route C": "var(--route-c)",
}

function getEdgeCongestionColor(edge: EdgeParams): string {
  const ratio = edge.flow / edge.capacity
  if (ratio < 0.5) return "var(--congestion-low)"
  if (ratio < 0.8) return "var(--congestion-med)"
  return "var(--congestion-high)"
}

// ─── Winding Organic Street Curves ───────────────────────────────────────────

function seededRand(seed: string) {
  let h = 5381
  for (let i = 0; i < seed.length; i++) h = (Math.imul(33, h) ^ seed.charCodeAt(i)) >>> 0
  return () => {
    h ^= h << 13
    h ^= h >> 17
    h ^= h << 5
    h = h >>> 0
    return h / 4294967296
  }
}

// Builds a smooth, winding street segment with a cubic Bézier. A lateral
// laneOffset lets several routes run parallel along the same street.
function buildOrganicCurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: string,
  laneOffset = 0,
) {
  const rand = seededRand(seed)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = -dy / len
  const ny = dx / len // perpendicular unit vector

  // Real streets rarely run dead straight: give each segment a gentle S-bend by
  // bowing its two control points to OPPOSITE sides. Curvature scales with the
  // segment length so short blocks stay subtle and long arterials sweep more.
  const sign = rand() > 0.5 ? 1 : -1
  const sBend = rand() > 0.4 ? -1 : 1 // sometimes both bows share a side (simple arc)
  const amp = 0.18 + rand() * 0.24
  const bow1 = sign * amp * len
  const bow2 = sign * sBend * (0.1 + rand() * 0.22) * len
  // Stagger the control points unevenly so curves aren't symmetric.
  const t1 = 0.14 + rand() * 0.18
  const t2 = 0.55 + rand() * 0.2

  const ox = nx * laneOffset
  const oy = ny * laneOffset
  const sx1 = x1 + ox
  const sy1 = y1 + oy
  const sx2 = x2 + ox
  const sy2 = y2 + oy

  const cp1x = sx1 + dx * t1 + nx * (bow1 + laneOffset)
  const cp1y = sy1 + dy * t1 + ny * (bow1 + laneOffset)
  const cp2x = sx1 + dx * t2 + nx * (bow2 + laneOffset)
  const cp2y = sy1 + dy * t2 + ny * (bow2 + laneOffset)

  const u = 0.5
  const mid = {
    x: u * u * u * sx1 + 3 * u * u * 0.5 * cp1x + 3 * u * 0.25 * cp2x + 0.125 * sx2,
    y: u * u * u * sy1 + 3 * u * u * 0.5 * cp1y + 3 * u * 0.25 * cp2y + 0.125 * sy2,
  }

  return {
    d: `M ${sx1.toFixed(1)} ${sy1.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${sx2.toFixed(1)} ${sy2.toFixed(1)}`,
    mid,
  }
}

export function TrafficGrid({
  nodes,
  edges,
  origin,
  destination,
  selectedRoute,
  availableRoutes = [],
  hoveredRouteName,
  title,
  compact = false,
}: TrafficGridProps) {
  const svgSize = compact ? 300 : 520
  const padding = compact ? 22 : 36
  const nodeRadius = compact ? 6 : 9

  const posMap = useMemo(() => {
    const inner = svgSize - padding * 2
    const m: Record<string, { x: number; y: number }> = {}
    for (const n of nodes) {
      m[n.id] = { x: padding + n.x * inner, y: padding + n.y * inner }
    }
    return m
  }, [nodes, svgSize, padding])

  const getPos = useCallback((id: string) => posMap[id] ?? { x: 0, y: 0 }, [posMap])

  const isEdgeInRoute = useCallback((edge: EdgeParams, route: Route | null | undefined) => {
    if (!route) return false
    return route.edges.some(
      (e) =>
        e.id === edge.id ||
        (e.from === edge.from && e.to === edge.to) ||
        (e.from === edge.to && e.to === edge.from),
    )
  }, [])

  const edgeRouteMap = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const edge of edges) {
      const key = [edge.from, edge.to].sort().join("|")
      m[key] = []
      for (const route of availableRoutes) {
        if (isEdgeInRoute(edge, route)) m[key].push(route.name)
      }
    }
    return m
  }, [edges, availableRoutes, isEdgeInRoute])

  const LANE_GAP = compact ? 4 : 6

  return (
    <div className="flex w-full flex-col items-center">
      {title && <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>}
      <svg
        width="100%"
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        className="aspect-square w-full rounded-xl border border-border bg-card shadow-sm"
        role="img"
        aria-label="Organic city street map showing traffic routes"
      >
        <defs>
          <pattern id={`grid-${compact ? "c" : "f"}`} width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M 26 0 L 0 0 0 26" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.25" />
          </pattern>
        </defs>
        <rect width={svgSize} height={svgSize} fill={`url(#grid-${compact ? "c" : "f"})`} rx="12" />

        {/* ── Base Roads (asphalt casing + congestion color) ── */}
        {edges.map((edge) => {
          const from = getPos(edge.from)
          const to = getPos(edge.to)

          const isSelected = isEdgeInRoute(edge, selectedRoute)
          const isHoveredEdge = hoveredRouteName
            ? isEdgeInRoute(edge, availableRoutes.find((r) => r.name === hoveredRouteName) ?? null)
            : false

          let opacity = 0.7
          if (selectedRoute && !isSelected) opacity = 0.16
          if (hoveredRouteName && !isHoveredEdge) opacity = 0.16

          const { d: curvePath, mid } = buildOrganicCurve(from.x, from.y, to.x, to.y, edge.id, 0)

          return (
            <g key={`base-${edge.id}`}>
              {/* asphalt casing */}
              <path
                d={curvePath}
                fill="none"
                stroke="var(--road-casing)"
                strokeWidth={compact ? 5 : 7}
                strokeLinecap="round"
                opacity={opacity * 0.9}
              />
              {/* congestion-colored lane */}
              <path
                d={curvePath}
                fill="none"
                stroke={getEdgeCongestionColor(edge)}
                strokeWidth={compact ? 2.5 : 3.5}
                strokeLinecap="round"
                opacity={opacity}
                style={{ transition: "opacity 0.15s" }}
              />
              {!compact && !selectedRoute && !hoveredRouteName && (
                <text
                  x={mid.x}
                  y={mid.y - 5}
                  textAnchor="middle"
                  fill="var(--muted-foreground)"
                  style={{ fontSize: 7.5, fontFamily: "var(--font-mono)", fontWeight: 600 }}
                >
                  {edge.travelTime.toFixed(1)}m
                </text>
              )}
            </g>
          )
        })}

        {/* ── Route Overlays (curved multi-lane channels) ── */}
        {availableRoutes.map((route) => {
          const isThisSelected = selectedRoute?.name === route.name
          const isThisHovered = hoveredRouteName === route.name
          if (!isThisSelected && !isThisHovered) return null

          const color = ROUTE_COLORS[route.name] || "var(--route-a)"
          const sw = compact ? 4.5 : 6

          return route.edges.map((routeEdge) => {
            const canonical = edges.find(
              (e) =>
                (e.from === routeEdge.from && e.to === routeEdge.to) ||
                (e.from === routeEdge.to && e.to === routeEdge.from),
            )
            if (!canonical) return null

            const from = getPos(canonical.from)
            const to = getPos(canonical.to)
            const edgeKey = [canonical.from, canonical.to].sort().join("|")

            const sharingRoutes = edgeRouteMap[edgeKey] ?? [route.name]
            const laneCount = sharingRoutes.length
            const laneIdx = sharingRoutes.indexOf(route.name)
            const laneOffset = laneCount > 1 ? (laneIdx - (laneCount - 1) / 2) * LANE_GAP : 0

            const { d } = buildOrganicCurve(from.x, from.y, to.x, to.y, canonical.id, laneOffset)

            return (
              <g key={`${route.name}-${canonical.id}`}>
                <path d={d} fill="none" stroke="var(--card)" strokeWidth={sw + 3} strokeLinecap="round" opacity={0.75} />
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={sw}
                  strokeLinecap="round"
                  opacity={1}
                  style={{ transition: "stroke-width 0.15s" }}
                />
              </g>
            )
          })
        })}

        {/* ── Intersections (Nodes) ── */}
        {nodes.map((node) => {
          const pos = getPos(node.id)
          const isO = node.id === origin
          const isD = node.id === destination
          const inRoute = selectedRoute?.path.includes(node.id) ?? false

          let fill = "var(--muted)"
          let stroke = "var(--border)"
          let tColor = "var(--muted-foreground)"
          let sw = 1.5

          if (isO) {
            fill = "var(--origin)"
            stroke = "var(--origin)"
            tColor = "var(--origin-foreground)"
            sw = 2.5
          } else if (isD) {
            fill = "var(--destination)"
            stroke = "var(--destination)"
            tColor = "var(--destination-foreground)"
            sw = 2.5
          } else if (inRoute) {
            fill = ROUTE_COLORS[selectedRoute?.name || "Route A"] || "var(--route-a)"
            stroke = "var(--card)"
            tColor = "var(--origin-foreground)"
            sw = 2
          }

          const r = isO || isD ? nodeRadius + (compact ? 2 : 3) : nodeRadius

          return (
            <g key={node.id}>
              {(isO || isD) && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r + (compact ? 5 : 8)}
                  fill={isO ? "var(--origin)" : "var(--destination)"}
                  opacity={0.16}
                />
              )}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r}
                fill={fill}
                stroke={stroke}
                strokeWidth={sw}
                style={{ transition: "fill 0.15s" }}
              />
              {!compact && (
                <text
                  x={pos.x}
                  y={pos.y + 3}
                  textAnchor="middle"
                  fill={tColor}
                  style={{ fontSize: 7.5, fontWeight: 700 }}
                  className="pointer-events-none select-none"
                >
                  {node.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
