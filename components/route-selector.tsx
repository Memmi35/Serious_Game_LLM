"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Route } from "@/lib/traffic-simulation";
import { Clock, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";

interface RouteSelectorProps {
  routes: Route[];
  onSelect: (routeName: string) => void;
  onHover: (routeName: string | null) => void;
  hoveredRouteName: string | null;
  disabled?: boolean;
}

const routeColors: Record<string, { bg: string; border: string; text: string; hover: string }> = {
  "Route A": { bg: "bg-blue-500/10", border: "border-blue-500", text: "text-blue-600", hover: "hover:bg-blue-500/20" },
  "Route B": { bg: "bg-violet-500/10", border: "border-violet-500", text: "text-violet-600", hover: "hover:bg-violet-500/20" },
  "Route C": { bg: "bg-orange-500/10", border: "border-orange-500", text: "text-orange-600", hover: "hover:bg-orange-500/20" },
};

export function RouteSelector({
  routes,
  onSelect,
  onHover,
  hoveredRouteName,
  disabled = false,
}: RouteSelectorProps) {
  const [selectedForSubmit, setSelectedForSubmit] = useState<string | null>(null);

  const getCongestionIcon = (level: "low" | "medium" | "high") => {
    switch (level) {
      case "low":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "medium":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "high":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
  };

  const getCongestionBadge = (level: "low" | "medium" | "high") => {
    const variants = {
      low: "bg-green-500/10 text-green-600 border-green-500/30",
      medium: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
      high: "bg-red-500/10 text-red-600 border-red-500/30",
    };
    return (
      <Badge variant="outline" className={variants[level]}>
        {level} congestion
      </Badge>
    );
  };

  const handleSelect = (routeName: string) => {
    if (disabled) return;
    setSelectedForSubmit(routeName);
  };

  const handleSubmit = () => {
    if (selectedForSubmit !== null) {
      onSelect(selectedForSubmit);
      setSelectedForSubmit(null);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-foreground">
        Choose Your Route
      </h3>
      <p className="text-sm text-muted-foreground">
        Hover over routes to preview them on the map. Select one and submit your choice.
      </p>

      <div className="grid gap-3">
        {routes.map((route) => {
          const colors = routeColors[route.name] || routeColors["Route A"];
          const isHovered = hoveredRouteName === route.name;
          const isSelected = selectedForSubmit === route.name;

          return (
            <Card
              key={route.name}
              className={`cursor-pointer transition-all duration-200 ${colors.bg} ${colors.hover} border-2 ${
                isSelected
                  ? `${colors.border} ring-2 ring-offset-2 ring-offset-background`
                  : isHovered
                  ? colors.border
                  : "border-transparent"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              onMouseEnter={() => !disabled && onHover(route.name)}
              onMouseLeave={() => !disabled && onHover(null)}
              onClick={() => handleSelect(route.name)}
            >
              <CardHeader className="py-3 px-4">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className={colors.text}>{route.name}</span>
                  {getCongestionBadge(route.congestionLevel)}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2 px-4 pt-0">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {route.totalTravelTime.toFixed(1)} min
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      Free: {route.totalFreeTime.toFixed(1)} min
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {getCongestionIcon(route.congestionLevel)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground font-mono">
                  Path: {route.path.join(" → ")}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedForSubmit !== null && (
        <Button
          onClick={handleSubmit}
          disabled={disabled}
          className="w-full mt-4"
          size="lg"
        >
          Confirm {selectedForSubmit}
        </Button>
      )}
    </div>
  );
}
