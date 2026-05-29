"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RoundLog } from "@/lib/traffic-simulation";
import { Clock, MapPin, Route, TrendingUp, Timer, Activity } from "lucide-react";

interface GameLogsProps {
  logs: RoundLog[];
}

export function GameLogs({ logs }: GameLogsProps) {
  const totalTravelTime = logs.reduce((sum, log) => sum + log.realizedTime, 0);
  const avgTravelTime = logs.length > 0 ? totalTravelTime / logs.length : 0;
  const totalDecisionTime = logs.reduce((sum, log) => sum + log.decisionLatency, 0);

  // Count routes chosen
  const routeCounts = {
    "Route A": logs.filter((l) => l.chosenRoute === "Route A").length,
    "Route B": logs.filter((l) => l.chosenRoute === "Route B").length,
    "Route C": logs.filter((l) => l.chosenRoute === "Route C").length,
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Route className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{logs.length}</p>
                <p className="text-xs text-muted-foreground">Rounds Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{totalTravelTime.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Total Travel (min)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{avgTravelTime.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Avg Travel (min)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{totalDecisionTime.toFixed(1)}s</p>
                <p className="text-xs text-muted-foreground">Decision Time</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Route Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Route Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-sm">Route A: {routeCounts["Route A"]}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-violet-500" />
              <span className="text-sm">Route B: {routeCounts["Route B"]}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-sm">Route C: {routeCounts["Route C"]}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Round Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">Round</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Predicted</TableHead>
                  <TableHead>Realized</TableHead>
                  <TableHead>Decision (s)</TableHead>
                  <TableHead>Flow (A/B/C)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.round}>
                    <TableCell className="font-medium">{log.round}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-green-500/10 text-green-600">
                        {log.origin}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-red-500/10 text-red-600">
                        {log.destination}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          log.chosenRoute === "Route A"
                            ? "bg-blue-500/10 text-blue-600"
                            : log.chosenRoute === "Route B"
                            ? "bg-violet-500/10 text-violet-600"
                            : "bg-orange-500/10 text-orange-600"
                        }
                      >
                        {log.chosenRoute}
                      </Badge>
                    </TableCell>
                    <TableCell>{log.predictedTime.toFixed(1)} min</TableCell>
                    <TableCell className="font-medium">{log.realizedTime.toFixed(1)} min</TableCell>
                    <TableCell>{log.decisionLatency.toFixed(1)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.routeAFlow}/{log.routeBFlow}/{log.routeCFlow}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Export Button */}
      <div className="flex justify-end gap-4">
        <button
          onClick={async () => {
            // Try to download from API first
            try {
              const response = await fetch("/api/download-logs");
              if (response.ok) {
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `simulation_logs_${new Date().toISOString()}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                return;
              }
            } catch {
              // Fallback to client-side export
            }
            
            // Fallback: Export as CSV format matching the Flask backend
            const headers = [
              "round",
              "user_id",
              "chosen_route",
              "decision_latency",
              "predicted_time",
              "realized_time",
              "route_A_flow",
              "route_B_flow",
              "route_C_flow",
              "grid_size",
              "origin",
              "destination",
            ];
            const csvRows = [headers.join(",")];
            for (const log of logs) {
              csvRows.push(
                [
                  log.round,
                  log.userId,
                  log.chosenRoute,
                  log.decisionLatency,
                  log.predictedTime,
                  log.realizedTime,
                  log.routeAFlow,
                  log.routeBFlow,
                  log.routeCFlow,
                  log.gridSize,
                  log.origin,
                  log.destination,
                ].join(",")
              );
            }
            const csv = csvRows.join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `simulation_logs_${new Date().toISOString()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          Download as CSV
        </button>
        <button
          onClick={() => {
            const data = JSON.stringify(logs, null, 2);
            const blob = new Blob([data], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `simulation_logs_${new Date().toISOString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          Download as JSON
        </button>
      </div>
    </div>
  );
}
