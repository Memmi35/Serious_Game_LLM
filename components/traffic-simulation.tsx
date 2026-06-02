"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrafficGrid } from "./traffic-grid";
import { RouteSelector } from "./route-selector";
import { GameLogs } from "./game-logs";
import {
  type GameState,
  type Route,
  type RoundLog,
  type EdgeParams,
  type Node,
} from "@/lib/traffic-simulation";
import {
  Play,
  RotateCcw,
  ArrowRight,
  Trophy,
  MapPin,
  Navigation,
  Loader2,
} from "lucide-react";

// Convert API response to frontend format
interface APIRoute {
  path: string[];
  length: number;
  predicted_time: number;
  total_free_time: number;
}

interface APIEdge {
  id: string;
  from: string;
  to: string;
  free_time: number;
  capacity: number;
  base_flow: number;
  flow: number;
  travel_time: number;
}

interface APINode {
  id: string;
  label: string;
  x: number;
  y: number;
  is_origin: boolean;
  is_destination: boolean;
}

function convertAPIEdgeToEdge(apiEdge: APIEdge): EdgeParams {
  return {
    id: apiEdge.id,
    from: apiEdge.from,
    to: apiEdge.to,
    freeTime: apiEdge.free_time,
    capacity: apiEdge.capacity,
    baseFlow: apiEdge.base_flow,
    flow: apiEdge.flow,
    travelTime: apiEdge.travel_time,
  };
}

function convertAPINodeToNode(apiNode: APINode): Node {
  return {
    id: apiNode.id,
    label: apiNode.label,
    x: apiNode.x / 100,
    y: apiNode.y / 100,
  };
}

function convertAPIRouteToRoute(
  name: string,
  apiRoute: APIRoute,
  edges: EdgeParams[]
): Route {
  const pathEdges: EdgeParams[] = [];
  for (let i = 0; i < apiRoute.path.length - 1; i++) {
    const edge = edges.find(
      (e) =>
        (e.from === apiRoute.path[i] && e.to === apiRoute.path[i + 1]) ||
        (e.from === apiRoute.path[i + 1] && e.to === apiRoute.path[i])
    );
    if (edge) pathEdges.push(edge);
  }

  const avgRatio =
    pathEdges.length > 0
      ? pathEdges.reduce((sum, edge) => sum + edge.flow / edge.capacity, 0) /
        pathEdges.length
      : 0;

  return {
    name,
    path: apiRoute.path,
    edges: pathEdges,
    totalTravelTime: apiRoute.predicted_time,
    totalFreeTime: apiRoute.total_free_time,
    totalFlow: pathEdges.reduce((sum, e) => sum + e.flow, 0),
    congestionLevel: avgRatio < 0.5 ? "low" : avgRatio < 0.8 ? "medium" : "high",
  };
}

export function TrafficSimulation({ initialSessionId = null }: { initialSessionId?: string | null }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [hoveredRouteName, setHoveredRouteName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("simulation");
  const [loading, setLoading] = useState(false);
  const roundStartTimeRef = useRef<number>(Date.now());

  const handleStartGame = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/init-simulation", { method: "POST" });
      const data = await response.json();

      if (data.status === "success") {
        const edges = data.network.edges.map(convertAPIEdgeToEdge);
        const nodes = data.network.nodes.map(convertAPINodeToNode);

        const routes: Record<string, Route> = {};
        for (const [name, apiRoute] of Object.entries(data.routes as Record<string, APIRoute>)) {
          routes[name] = convertAPIRouteToRoute(name, apiRoute, edges);
        }

        setSessionId(data.session_id);
        setGameState({
          currentRound: 1,
          totalRounds: data.num_rounds,
          origin: data.origin,
          destination: data.destination,
          nodes,
          edges,
          routes,
          predictedTimes: data.predicted_times,
          selectedRoute: null,
          logs: [],
          gameOver: false,
          phase: "selecting",
          roundEndpoints: [],
          roundStartTime: Date.now(),
        });
        roundStartTimeRef.current = Date.now();
        setActiveTab("simulation");
      }
    } catch (error) {
      console.error("Error starting game:", error);
    }
    setLoading(false);
  }, []);

  const handleSelectRoute = useCallback(async (routeName: string) => {
    if (!gameState || !sessionId) return;

    setLoading(true);
    const decisionLatency = (Date.now() - roundStartTimeRef.current) / 1000;

    try {
      const response = await fetch("/api/make-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          chosen_route: routeName,
          decision_latency: decisionLatency,
        }),
      });
      const data = await response.json();

      if (data.status === "success") {
        const result = data.round_result;

        // Update selected route with realized time
        const selectedRoute = gameState.routes[routeName];
        const updatedSelectedRoute: Route = {
          ...selectedRoute,
          totalTravelTime: result.realized_time,
        };

        // Create log entry with route and grid data for visualization
        const newLog: RoundLog = {
          round: result.round,
          userId: 1,
          origin: gameState.origin,
          destination: gameState.destination,
          chosenRoute: routeName,
          selectedRoute: routeName,
          decisionLatency,
          predictedTime: result.predicted_time,
          realizedTime: result.realized_time,
          routeAFlow: result.route_flows["Route A"],
          routeBFlow: result.route_flows["Route B"],
          routeCFlow: result.route_flows["Route C"],
          gridSize: 5,
          timestamp: new Date(),
          // Store route and grid data for displaying grid copies in passed rounds
          routeData: updatedSelectedRoute,
          nodes: [...gameState.nodes],
          edges: gameState.edges.map(e => ({ ...e })),
        };

        setGameState((prev) =>
          prev
            ? {
                ...prev,
                selectedRoute: updatedSelectedRoute,
                logs: [...prev.logs, newLog],
                phase: "viewing",
                gameOver: data.simulation_complete,
              }
            : null
        );
      }
    } catch (error) {
      console.error("Error selecting route:", error);
    }
    setLoading(false);
    setHoveredRouteName(null);
  }, [gameState, sessionId]);

  const handleNextRound = useCallback(async () => {
    if (!sessionId) return;

    // Fetch current state from server
    setLoading(true);
    try {
      const response = await fetch(`/api/get-state?session_id=${sessionId}`);
      const data = await response.json();

      if (data.status === "waiting") {
        setGameState((prev) => prev ? { ...prev, phase: "transitioning" } : null);
        setLoading(false);
        return;
      }

      if (data.status === "initialized") {
        const edges = data.network.edges.map(convertAPIEdgeToEdge);
        const nodes = data.network.nodes.map(convertAPINodeToNode);

        const routes: Record<string, Route> = {};
        for (const [name, apiRoute] of Object.entries(data.routes as Record<string, APIRoute>)) {
          routes[name] = convertAPIRouteToRoute(name, apiRoute, edges);
        }

        setGameState((prev) => {
          if (!prev) {
            return {
              currentRound: data.current_round,
              totalRounds: data.num_rounds,
              origin: data.origin,
              destination: data.destination,
              nodes,
              edges,
              routes,
              predictedTimes: data.predicted_times,
              selectedRoute: null,
              logs: data.logs || [],
              gameOver: data.game_over,
              phase: "selecting",
              roundEndpoints: [],
              roundStartTime: Date.now()
            };
          }
          
          return {
            ...prev,
            currentRound: data.current_round,
            origin: data.origin,
            destination: data.destination,
            nodes,
            edges,
            routes,
            predictedTimes: data.predicted_times,
            selectedRoute: null,
            phase: "selecting",
            gameOver: data.game_over,
          };
        });
        roundStartTimeRef.current = Date.now();
      }
    } catch (error) {
      console.error("Error fetching next round:", error);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    if (initialSessionId) {
      handleNextRound();
      // Poll game state every 2.5 seconds if waiting for admin
      const interval = setInterval(() => {
        handleNextRound();
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [initialSessionId, handleNextRound]);

  const handleRestart = useCallback(async () => {
    setSessionId(null);
    await handleStartGame();
    setHoveredRouteName(null);
  }, [handleStartGame]);

  if (!gameState) {
    if (initialSessionId) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Card className="max-w-lg w-full">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
              </div>
              <CardTitle className="text-2xl">Waiting for Host</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center">
                The game has not started yet. Waiting for the admin to begin...
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Navigation className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Traffic Simulation Game</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-center">
              Navigate through a 5x5 Manhattan grid over 5 rounds. Choose the
              best routes based on travel time and congestion levels. Your
              decisions affect future traffic conditions!
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                <div className="h-3 w-3 rounded-full bg-gray-400" />
                <span>Default edges (gray)</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <span>Route A (blue)</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                <div className="h-3 w-3 rounded-full bg-violet-500" />
                <span>Route B (purple)</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                <div className="h-3 w-3 rounded-full bg-orange-500" />
                <span>Route C (orange)</span>
              </div>
            </div>
            <Button onClick={handleStartGame} className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start Simulation
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const routesArray = Object.values(gameState.routes);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Navigation className="h-5 w-5 text-primary" />
              <h1 className="font-semibold">Traffic Simulation</h1>
            </div>
            <Badge variant="outline" className="font-mono">
              Round {gameState.currentRound}/{gameState.totalRounds}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRestart} disabled={loading}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Restart
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
            <TabsTrigger value="logs">
              Logs ({gameState.logs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="simulation" className="space-y-6">
            {gameState.gameOver ? (
              <Card className="max-w-2xl mx-auto">
                <CardHeader className="text-center">
                  <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-yellow-500/10 flex items-center justify-center">
                    <Trophy className="h-8 w-8 text-yellow-500" />
                  </div>
                  <CardTitle className="text-2xl">Simulation Complete!</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground text-center">
                    You have completed all 5 rounds. Check the Logs tab to review
                    your journey and download the complete session data.
                  </p>
                  <div className="flex gap-3 justify-center">
                    <Button onClick={() => setActiveTab("logs")}>
                      View Logs
                    </Button>
                    <Button variant="outline" onClick={handleRestart}>
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Play Again
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Current Route Info */}
                <div className="flex items-center justify-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-green-500" />
                    <span className="font-medium">From:</span>
                    <Badge variant="outline" className="bg-green-500/10 text-green-600">
                      {gameState.origin}
                    </Badge>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-red-500" />
                    <span className="font-medium">To:</span>
                    <Badge variant="outline" className="bg-red-500/10 text-red-600">
                      {gameState.destination}
                    </Badge>
                  </div>
                </div>

                {/* Main Grid and Controls */}
                <div className="grid lg:grid-cols-2 gap-6">
                  {/* Interactive Grid */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Traffic Network</CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                      <TrafficGrid
                        nodes={gameState.nodes}
                        edges={gameState.edges}
                        origin={gameState.origin}
                        destination={gameState.destination}
                        availableRoutes={routesArray}
                        hoveredRouteName={hoveredRouteName}
                        onRouteHover={setHoveredRouteName}
                        selectedRoute={
                          gameState.phase === "viewing"
                            ? gameState.selectedRoute
                            : null
                        }
                      />
                    </CardContent>
                  </Card>

                  {/* Route Selection or Result */}
                  <Card>
                    <CardContent className="pt-6">
                      {gameState.phase === "selecting" ? (
                        <RouteSelector
                          routes={routesArray}
                          onSelect={handleSelectRoute}
                          onHover={setHoveredRouteName}
                          hoveredRouteName={hoveredRouteName}
                          disabled={loading}
                        />
                      ) : (
                        <div className="space-y-4">
                          <div className="text-center">
                            <h3 className="text-lg font-semibold text-green-600 mb-2">
                              Route Selected!
                            </h3>
                            <p className="text-muted-foreground">
                              You chose{" "}
                              <span className="font-medium text-foreground">
                                {gameState.selectedRoute?.name}
                              </span>{" "}
                              with a travel time of{" "}
                              <span className="font-medium text-foreground">
                                {gameState.selectedRoute?.totalTravelTime.toFixed(1)}{" "}
                                minutes
                              </span>
                            </p>
                          </div>

                          <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm font-medium mb-2">Path taken:</p>
                            <p className="font-mono text-sm text-muted-foreground">
                              {gameState.selectedRoute?.path.join(" -> ")}
                            </p>
                          </div>

                          <Button
                            onClick={handleNextRound}
                            className="w-full"
                            size="lg"
                            disabled={loading}
                          >
                            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {gameState.currentRound >= gameState.totalRounds
                              ? "Finish Simulation"
                              : "Continue to Next Round"}
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Selected Route Map (shown after selection) */}
                {gameState.phase === "viewing" && gameState.selectedRoute && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Your Selected Route - Round {gameState.currentRound}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col md:flex-row items-center gap-6">
                        <TrafficGrid
                          nodes={gameState.nodes}
                          edges={gameState.edges}
                          origin={gameState.origin}
                          destination={gameState.destination}
                          selectedRoute={gameState.selectedRoute}
                          compact
                          title="Selected Route"
                        />
                        <div className="flex-1 space-y-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-xs text-muted-foreground">
                                Travel Time
                              </p>
                              <p className="text-xl font-bold">
                                {gameState.selectedRoute.totalTravelTime.toFixed(1)}{" "}
                                min
                              </p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-xs text-muted-foreground">
                                Free Flow Time
                              </p>
                              <p className="text-xl font-bold">
                                {gameState.selectedRoute.totalFreeTime.toFixed(1)}{" "}
                                min
                              </p>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-xs text-muted-foreground">
                                Congestion Level
                              </p>
                              <Badge
                                variant="outline"
                                className={
                                  gameState.selectedRoute.congestionLevel === "low"
                                    ? "text-green-600"
                                    : gameState.selectedRoute.congestionLevel ===
                                      "medium"
                                    ? "text-yellow-600"
                                    : "text-red-600"
                                }
                              >
                                {gameState.selectedRoute.congestionLevel}
                              </Badge>
                            </div>
                            <div className="p-3 rounded-lg bg-muted/50">
                              <p className="text-xs text-muted-foreground">
                                Edges Traversed
                              </p>
                              <p className="text-xl font-bold">
                                {gameState.selectedRoute.edges.length}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Passed Rounds History */}
                {gameState.logs.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Passed Rounds</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        {[...gameState.logs].reverse().map((log, index) => (
                          <div
                            key={`${log.round}-${index}`}
                            className="p-4 rounded-lg border bg-card"
                          >
                            <div className="flex items-center justify-between mb-4">
                              <Badge variant="outline" className="text-base px-3 py-1">Round {log.round}</Badge>
                              <Badge
                                variant="outline"
                                className={
                                  log.chosenRoute === "Route A"
                                    ? "bg-blue-500/10 text-blue-600 border-blue-200"
                                    : log.chosenRoute === "Route B"
                                    ? "bg-violet-500/10 text-violet-600 border-violet-200"
                                    : "bg-orange-500/10 text-orange-600 border-orange-200"
                                }
                              >
                                {log.chosenRoute}
                              </Badge>
                            </div>
                            
                            <div className="flex flex-col md:flex-row gap-6">
                              {/* Grid visualization for this round */}
                              {log.nodes && log.edges && log.routeData && (
                                <div className="flex-shrink-0">
                                  <TrafficGrid
                                    nodes={log.nodes}
                                    edges={log.edges}
                                    origin={log.origin}
                                    destination={log.destination}
                                    selectedRoute={log.routeData}
                                    compact
                                    title={`Round ${log.round}`}
                                  />
                                </div>
                              )}
                              
                              {/* Round details */}
                              <div className="flex-1 space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                                    <MapPin className="h-4 w-4 text-green-500" />
                                    <div>
                                      <p className="text-xs text-muted-foreground">From</p>
                                      <p className="font-medium">{log.origin}</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                                    <MapPin className="h-4 w-4 text-red-500" />
                                    <div>
                                      <p className="text-xs text-muted-foreground">To</p>
                                      <p className="font-medium">{log.destination}</p>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="p-2 rounded bg-muted/50">
                                    <p className="text-xs text-muted-foreground">Predicted Time</p>
                                    <p className="font-bold">{log.predictedTime.toFixed(1)} min</p>
                                  </div>
                                  <div className="p-2 rounded bg-muted/50">
                                    <p className="text-xs text-muted-foreground">Realized Time</p>
                                    <p className="font-bold">{log.realizedTime.toFixed(1)} min</p>
                                  </div>
                                </div>
                                
                                {log.routeData && (
                                  <div className="p-2 rounded bg-muted/50">
                                    <p className="text-xs text-muted-foreground mb-1">Path Taken</p>
                                    <p className="font-mono text-xs text-muted-foreground">
                                      {log.routeData.path.join(" -> ")}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="logs">
            {gameState.logs.length > 0 ? (
              <GameLogs logs={gameState.logs} />
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    No logs yet. Complete a round to see your journey history.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
