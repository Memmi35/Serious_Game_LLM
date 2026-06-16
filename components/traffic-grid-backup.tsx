"use client";

import { useCallback, useMemo } from "react";
import type { Node, EdgeParams, Route } from "@/lib/traffic-simulation";

interface TrafficGridProps {
  nodes: Node[];
  edges: EdgeParams[];
  origin: string;
  destination: string;
  selectedRoute?: Route | null;
  availableRoutes?: Route[];
  hoveredRouteName?: string | null;
  onRouteHover?: (routeName: string | null) => void;
  showControls?: boolean;
  title?: string;
  compact?: boolean;
}

// Route colors matching the route selector
const ROUTE_COLORS: Record<string, string> = {
  "Route A": "#3b82f6", // blue
  "Route B": "#8b5cf6", // purple
  "Route C": "#f97316", // orange
};

// Congestion colors
const CONGESTION_COLORS = {
  low: "#7dd3fc", // sky-300 (light blue / bleu ciel)
  medium: "#fb923c", // orange-400
  high: "#ef4444", // red-500
};

// Get congestion level based on flow/capacity ratio
function getEdgeCongestionColor(edge: EdgeParams): string {
  const ratio = edge.flow / edge.capacity;
  if (ratio < 0.5) return CONGESTION_COLORS.low;
  if (ratio < 0.8) return CONGESTION_COLORS.medium;
  return CONGESTION_COLORS.high;
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
  const gridSize = compact ? 280 : 400;
  const padding = compact ? 30 : 50;
  const nodeRadius = compact ? 12 : 18;
  const cellSize = (gridSize - 2 * padding) / 4;

  const getNodePosition = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return { x: 0, y: 0 };
      return {
        x: padding + node.x * cellSize,
        y: padding + node.y * cellSize,
      };
    },
    [nodes, cellSize, padding]
  );

  // Check if an edge is part of a specific route (checks both directions)
  const isEdgeInRoute = useCallback(
    (edge: EdgeParams, route: Route | null | undefined) => {
      if (!route) return false;
      // Check if the edge matches by id OR by from-to nodes (in either direction)
      return route.edges.some((e) => {
        // Direct match by id
        if (e.id === edge.id) return true;
        // Match by nodes (same direction)
        if (e.from === edge.from && e.to === edge.to) return true;
        // Match by nodes (reverse direction - bidirectional edges)
        if (e.from === edge.to && e.to === edge.from) return true;
        return false;
      });
    },
    []
  );

  // Get which route (if any) an edge belongs to when hovering
  const getEdgeRouteWhenHovered = useCallback(
    (edge: EdgeParams): string | null => {
      if (!hoveredRouteName) return null;
      const hoveredRoute = availableRoutes.find((r) => r.name === hoveredRouteName);
      if (hoveredRoute && isEdgeInRoute(edge, hoveredRoute)) {
        return hoveredRouteName;
      }
      return null;
    },
    [hoveredRouteName, availableRoutes, isEdgeInRoute]
  );

  // Group edges by their connection (to avoid drawing both directions)
  const uniqueEdges = useMemo(() => {
    const seen = new Set<string>();
    return edges.filter((edge) => {
      const key = [edge.from, edge.to].sort().join("-");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [edges]);

  return (
    <div className="flex flex-col items-center">
      {title && (
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          {title}
        </h3>
      )}
      <svg
        width={gridSize}
        height={gridSize}
        className="bg-card rounded-xl border border-border shadow-sm"
      >
        {/* Grid background pattern */}
        <defs>
          <pattern
            id={`grid-${compact}`}
            width={cellSize}
            height={cellSize}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              opacity="0.3"
            />
          </pattern>
        </defs>
        <rect
          x={padding}
          y={padding}
          width={gridSize - 2 * padding}
          height={gridSize - 2 * padding}
          fill={`url(#grid-${compact})`}
        />

        {/* Edges - Default gray, colored only when part of selected/hovered route */}
        {uniqueEdges.map((edge) => {
          const fromPos = getNodePosition(edge.from);
          const toPos = getNodePosition(edge.to);
          
          // Check if edge is part of selected route (viewing mode)
          const isSelected = isEdgeInRoute(edge, selectedRoute);
          
          // Check if edge is part of hovered route
          const hoveredEdgeRoute = getEdgeRouteWhenHovered(edge);
          
          // Determine styling
          let strokeColor = getEdgeCongestionColor(edge); // Default: congestion-based color
          let strokeWidth = compact ? 3 : 4;
          let opacity = 0.7;

          if (selectedRoute) {
            // In viewing mode - show selected route highlighted
            if (isSelected) {
              strokeColor = ROUTE_COLORS[selectedRoute.name] || "#3b82f6";
              strokeWidth = compact ? 6 : 8;
              opacity = 1;
            } else {
              // Other edges show congestion but faded
              strokeColor = getEdgeCongestionColor(edge);
              opacity = 0.4;
            }
          } else if (hoveredEdgeRoute) {
            // In selecting mode with hover - highlight hovered route edges
            strokeColor = ROUTE_COLORS[hoveredEdgeRoute] || "#3b82f6";
            strokeWidth = compact ? 5 : 7;
            opacity = 1;
          }

          return (
            <g key={edge.id}>
              <line
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                opacity={opacity}
                className="transition-all duration-200"
              />
              {/* Show travel time labels only when not compact and no route selected */}
              {!compact && !selectedRoute && !hoveredRouteName && (
                <text
                  x={(fromPos.x + toPos.x) / 2}
                  y={(fromPos.y + toPos.y) / 2 - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[9px] font-mono"
                >
                  {edge.travelTime.toFixed(1)}m
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const pos = getNodePosition(node.id);
          const isOrigin = node.id === origin;
          const isDestination = node.id === destination;
          const isInSelectedRoute = selectedRoute?.path.includes(node.id) ?? false;

          let fillColor = "hsl(var(--muted))";
          let strokeColor = "hsl(var(--border))";
          let textColor = "hsl(var(--muted-foreground))";

          if (isOrigin) {
            fillColor = "#22c55e";
            strokeColor = "#16a34a";
            textColor = "white";
          } else if (isDestination) {
            fillColor = "#ef4444";
            strokeColor = "#dc2626";
            textColor = "white";
          } else if (isInSelectedRoute) {
            fillColor = ROUTE_COLORS[selectedRoute?.name || "Route A"] || "#3b82f6";
            strokeColor = "#1d4ed8";
            textColor = "white";
          }

          return (
            <g key={node.id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={nodeRadius}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="2"
                className="transition-all duration-200"
              />
              {!compact && (
                <text
                  x={pos.x}
                  y={pos.y + 4}
                  textAnchor="middle"
                  className="text-[10px] font-medium pointer-events-none"
                  fill={textColor}
                >
                  {node.label}
                </text>
              )}
              {compact && (isOrigin || isDestination) && (
                <text
                  x={pos.x}
                  y={pos.y + 3}
                  textAnchor="middle"
                  className="text-[8px] font-bold pointer-events-none"
                  fill={textColor}
                >
                  {isOrigin ? "O" : "D"}
                </text>
              )}
            </g>
          );
        })}

        {/* Legend */}
        {!compact && (
          <g transform={`translate(${padding}, ${gridSize - 20})`}>
            <circle cx="0" cy="0" r="6" fill="#22c55e" />
            <text x="10" y="4" className="text-[9px] fill-muted-foreground">
              Origin
            </text>
            <circle cx="60" cy="0" r="6" fill="#ef4444" />
            <text x="70" y="4" className="text-[9px] fill-muted-foreground">
              Dest
            </text>
            {/* Congestion legend */}
            <line x1="110" y1="0" x2="125" y2="0" stroke={CONGESTION_COLORS.low} strokeWidth="4" />
            <text x="130" y="4" className="text-[9px] fill-muted-foreground">
              Low
            </text>
            <line x1="155" y1="0" x2="170" y2="0" stroke={CONGESTION_COLORS.medium} strokeWidth="4" />
            <text x="175" y="4" className="text-[9px] fill-muted-foreground">
              Med
            </text>
            <line x1="200" y1="0" x2="215" y2="0" stroke={CONGESTION_COLORS.high} strokeWidth="4" />
            <text x="220" y="4" className="text-[9px] fill-muted-foreground">
              High
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
