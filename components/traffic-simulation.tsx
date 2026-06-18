"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrafficGrid } from "./traffic-grid";
import { RouteSelector } from "./route-selector";
import { GameLogs } from "./game-logs";
import { SCENARIOS } from "@/lib/scenarios";
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
  Users,
  RefreshCw,
  Clock,
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
const [changingChoice, setChangingChoice] = useState(false);
  const [changeChoiceError, setChangeChoiceError] = useState<string | null>(null);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [revealedFinal, setRevealedFinal] = useState(false);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const roundStartTimeRef = useRef<number>(Date.now());
  const gameStateRef = useRef<GameState | null>(null);

useEffect(() => {
  gameStateRef.current = gameState;
}, [gameState]);

useEffect(() => {
  if (gameState?.phase === "selecting") {
   // roundStartTimeRef.current = Date.now();
  }
}, [gameState?.phase]);

  // State for submitted waiting view
const [submittedState, setSubmittedState] = useState<{
    playerChoice: string | null;
    playerPredictedTime: number | null;
    playerRealizedTime: number | null;
    allSubmitted: boolean;
    choiceDistribution: Record<string, number>;
    totalSubmitted: number;
    routes: Record<string, Route>;
    predictedTimes: Record<string, number>;
  } | null>(null);
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
       // roundStartTimeRef.current = Date.now();
        setActiveTab("simulation");
      }
    } catch (error) {
      console.error("Error starting game:", error);
    }
    setLoading(false);
  }, []);
const [choiceReason, setChoiceReason] = useState<string | null>(null);
  const [choiceReasonText, setChoiceReasonText] = useState("");
  const [reasonSaved, setReasonSaved] = useState(false);

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
          totalTravelTime: result.predicted_time,
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
          realizedTime: result.predicted_time, // placeholder, updated after admin advances
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

const handleChangeChoice = useCallback(async (newRouteName: string) => {
    if (!sessionId || !submittedState) return;
    if (newRouteName === submittedState.playerChoice) return;
    if (changingChoice) return; // prevent concurrent calls

    setChangingChoice(true);
    try {
      const response = await fetch("/api/change-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          new_route: newRouteName,
        }),
      });
const data = await response.json();
      if (data.status === "success") {
        setSubmittedState(prev => prev ? {
          ...prev,
          playerChoice: newRouteName,
        } : null);

        // Update last log entry so history and logs tab reflect the final choice
        setGameState(prev => {
          if (!prev || prev.logs.length === 0) return prev;
          const updatedLogs = [...prev.logs];
          const lastIndex = updatedLogs.length - 1;
          const newRouteData = prev.routes[newRouteName];
          updatedLogs[lastIndex] = {
            ...updatedLogs[lastIndex],
            chosenRoute: newRouteName,
            selectedRoute: newRouteName,
            routeData: newRouteData
              ? { ...newRouteData, totalTravelTime: updatedLogs[lastIndex].predictedTime }
              : updatedLogs[lastIndex].routeData,
          };
          return {
            ...prev,
            selectedRoute: newRouteData
              ? { ...newRouteData, totalTravelTime: updatedLogs[lastIndex].predictedTime }
              : prev.selectedRoute,
            logs: updatedLogs,
          };
        });
      } else if (data.status !== "success") {
        setChangeChoiceError(data.message || "Failed to change route. Please try again.");
      }
    } catch (error) {
      console.error("Error changing choice:", error);
    }
    setChangingChoice(false);
 }, [sessionId, submittedState, changingChoice]);

const handleNextRound = useCallback(async () => {
    if (!sessionId) return;

   const prevRoutes = gameStateRef.current?.routes ?? {};

    // Fetch current state from server
    setLoading(true);
    try {
      const response = await fetch(`/api/get-state?session_id=${sessionId}`);
      const data = await response.json();

      if (data.status === "waiting") {
        setGameState((prev) => prev ? { ...prev, phase: "transitioning" } : null);
        setSubmittedState(null);
        setCountdown(null);
        setRevealedFinal(false);
        setChoiceReason(null);
        setChoiceReasonText("");
        setReasonSaved(false);
        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
        setLoading(false);
        return;
      }

      // Handle submitted_waiting status - show distribution and allow changing choice
      if (data.status === "submitted_waiting") {
        const edges = data.network.edges.map(convertAPIEdgeToEdge);
        const nodes = data.network.nodes.map(convertAPINodeToNode);

        const routes: Record<string, Route> = {};
        for (const [name, apiRoute] of Object.entries(data.routes as Record<string, APIRoute>)) {
          routes[name] = convertAPIRouteToRoute(name, apiRoute, edges);
        }
setSubmittedState(prev => {
          // First time — set everything including distribution
if (!prev) {
            if (data.all_submitted) {
              setRevealedFinal(false);
              setCountdown(30);
              if (countdownRef.current) clearInterval(countdownRef.current);
              countdownRef.current = setInterval(() => {
                setCountdown(c => {
                  if (c === null || c <= 1) {
                    clearInterval(countdownRef.current!);
                    countdownRef.current = null;
                    setRevealedFinal(true);
                    return null;
                  }
                  return c - 1;
                });
              }, 1000);
            }
            return {
              playerChoice: data.player_choice,
              // Show times immediately if already all submitted (user B case)
              playerPredictedTime: data.all_submitted ? (data.player_predicted_time || null) : null,
              playerRealizedTime: data.all_submitted ? (data.player_realized_time ?? null) : null,
              allSubmitted: data.all_submitted || false,
              choiceDistribution: data.choice_distribution || {},
              totalSubmitted: data.total_submitted || 0,
              routes,
              predictedTimes: data.predicted_times,
            };
          }

          // Once allSubmitted was true — completely frozen, no more updates
          if (prev.allSubmitted) return prev;

          // Not yet all submitted — update distribution and check if just became all submitted
const justAllSubmitted = data.all_submitted && !prev.allSubmitted;

          if (justAllSubmitted) {
            // Start 10s countdown immediately when all players submit
            setRevealedFinal(false);
            setCountdown(30);
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = setInterval(() => {
              setCountdown(c => {
                if (c === null || c <= 1) {
                  clearInterval(countdownRef.current!);
                  countdownRef.current = null;
                  setRevealedFinal(true);
                  return null;
                }
                return c - 1;
              });
            }, 1000);
          }

          return {
            ...prev,
            allSubmitted: data.all_submitted || false,
            choiceDistribution: data.choice_distribution || prev.choiceDistribution,
            totalSubmitted: data.total_submitted || prev.totalSubmitted,
            playerPredictedTime: justAllSubmitted ? (data.player_predicted_time || null) : null,
            playerRealizedTime: justAllSubmitted ? (data.player_realized_time ?? null) : null,
          };
        });
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
              selectedRoute: routes[data.player_choice] || null,
              logs: [],
              gameOver: false,
              phase: "submitted_waiting",
              roundEndpoints: [],
              roundStartTime: Date.now()
            };
          }
          // Already in submitted_waiting — only update what actually changes
          // Don't replace nodes/edges/routes to avoid re-render flash
          if (prev.phase === "submitted_waiting") {
            return {
              ...prev,
              selectedRoute: routes[data.player_choice] || prev.selectedRoute,
              phase: "submitted_waiting",
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
            selectedRoute: routes[data.player_choice] || null,
            phase: "submitted_waiting",
          };
        });
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
            logs: prev.logs, // preserve existing rich log entries
            phase: "selecting",
            gameOver: data.game_over,
          };
        });
setSubmittedState(null);
        setCountdown(null);
        setRevealedFinal(false);
        setChoiceReason(null);
        setChoiceReasonText("");
        setReasonSaved(false);
        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
        // Update the last log entry with realized time from server, keeping nodes/edges/routeData
        // Update the last log entry with realized time from server, keeping nodes/edges/routeData
if (data.logs && data.logs.length > 0) {
          const serverLastLog = data.logs[data.logs.length - 1];
          setGameState(prev => {
            if (!prev || prev.logs.length === 0) return prev;
            const updatedLogs = [...prev.logs];
            const lastIndex = updatedLogs.length - 1;
            
            // Only update the travel time in the existing routeData to prevent 
            // overwriting it with the routes of the newly advanced round
            const existingRouteData = updatedLogs[lastIndex].routeData;
            
            updatedLogs[lastIndex] = {
              ...updatedLogs[lastIndex],
              chosenRoute: serverLastLog.chosen_route ?? updatedLogs[lastIndex].chosenRoute,
              selectedRoute: serverLastLog.chosen_route ?? updatedLogs[lastIndex].selectedRoute,
              realizedTime: serverLastLog.realized_time ?? updatedLogs[lastIndex].realizedTime,
              predictedTime: serverLastLog.predicted_time ?? updatedLogs[lastIndex].predictedTime,
              routeData: existingRouteData
                ? { ...existingRouteData, totalTravelTime: serverLastLog.predicted_time ?? updatedLogs[lastIndex].predictedTime }
                : updatedLogs[lastIndex].routeData,
              // nodes and edges are already preserved by the spread operator
            };
            return { ...prev, logs: updatedLogs };
          });
        }
        // roundStartTimeRef.current = Date.now();
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
useEffect(() => {
    if (revealedFinal && sessionId) {
      fetch(`/api/get-state?session_id=${sessionId}`)
        .then(r => r.json())
        .then(data => {
          if (data.status === "submitted_waiting") {
            setSubmittedState(prev => prev ? {
              ...prev,
              playerPredictedTime: data.player_predicted_time || prev.playerPredictedTime,
              playerRealizedTime: data.player_realized_time ?? prev.playerRealizedTime,
              choiceDistribution: data.choice_distribution || prev.choiceDistribution,
              totalSubmitted: data.total_submitted || prev.totalSubmitted,
            } : null);
          }
        })
        .catch(console.error);
    }
  }, [revealedFinal, sessionId]);
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
        {/* Scenario Info */}
        <div className="mb-6">
          <Card className="bg-secondary/30">
            <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-center">
              <div className="flex-1">
                <div className="flex flex-col">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    {SCENARIOS[gameState.currentRound - 1]?.icon} Round {gameState.currentRound} — {SCENARIOS[gameState.currentRound - 1]?.name}
                  </h2>
                  <h3 className="font-medium text-md text-foreground/90 mt-1">
                    {SCENARIOS[gameState.currentRound - 1]?.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {SCENARIOS[gameState.currentRound - 1]?.description}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
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
                        currentRound={gameState.currentRound}
                        nodes={gameState.nodes}
                        edges={gameState.edges}
                        origin={gameState.origin}
                        destination={gameState.destination}
                        availableRoutes={routesArray}
                        hoveredRouteName={hoveredRouteName}
                        onRouteHover={setHoveredRouteName}
                        selectedRoute={
                          gameState.phase === "viewing" || gameState.phase === "submitted_waiting"
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
                      ) : gameState.phase === "submitted_waiting" && submittedState ? (
                        <div className="space-y-4">
                          {/* Your Choice Section */}
                          <div className="text-center">
                            <h3 className="text-lg font-semibold text-green-600 mb-2">
                              Choice Submitted!
                            </h3>
<p className="text-muted-foreground">
                              You chose{" "}
                              <span className="font-medium text-foreground">
                                {submittedState.playerChoice}
                              </span>
                            </p>
                          </div>

{/* Times display */}
                          {submittedState.allSubmitted ? (
                            <div className="grid grid-cols-2 gap-3">
                            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-200">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-600">Predicted Time</span>
                </div>
                <p className="text-2xl font-bold text-blue-700">
                  {submittedState.playerPredictedTime?.toFixed(1) ?? '—'} min
                </p>
                <p className="text-xs text-blue-500 mt-1">
                  Estimated travel time if only you use this route, based on background traffic.
                </p>
              </div>
  <div className="p-4 rounded-lg bg-green-500/10 border border-green-200">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">Realized Time</span>
                </div>
                <p className="text-2xl font-bold text-green-700">
                  {submittedState.playerRealizedTime?.toFixed(1) ?? '—'} min
                </p>
                {submittedState.playerRealizedTime != null && submittedState.playerPredictedTime != null && (
                  <p className={`text-xs font-medium mt-1 ${
                    submittedState.playerRealizedTime > submittedState.playerPredictedTime
                      ? 'text-red-500'
                      : submittedState.playerRealizedTime < submittedState.playerPredictedTime
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }`}>
                    {(() => {
                      const diff = submittedState.playerRealizedTime - submittedState.playerPredictedTime;
                      const min = Math.min(submittedState.playerRealizedTime, submittedState.playerPredictedTime);
                      const pct = min > 0 ? Math.abs(diff / min) * 100 : 0;
                      if (diff === 0) return 'Exactly as predicted';
                      return `${diff > 0 ? '+' : ''}${pct.toFixed(1)}% vs predicted (${diff > 0 ? 'more' : 'less'} congestion than expected)`;
                    })()}
                  </p>
                )}
                <p className="text-xs text-green-500 mt-1">
                  Actual travel time accounting for all players' route choices this round.
                </p>
              </div>
                            </div>
                          ) : (
                            <div className="p-4 rounded-lg bg-muted/50 border border-dashed">
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Waiting for all players to submit before showing times...</span>
                              </div>
                            </div>
                          )}
                          

                         {/* Choice Reason */}
                          {submittedState.allSubmitted && (
                            !reasonSaved ? (
                              <div className="p-4 rounded-lg border border-dashed border-primary/40 bg-primary/5">
                                <p className="text-sm font-medium mb-3">Why did you choose {submittedState.playerChoice}?</p>
                                <div className="flex flex-wrap gap-2 mb-3">
                                  {[
                                  "Shortest path",
                                  "Less congestion",
                                  "Habit / familiar route",
                                  "Random choice",
                                  "Following others",
                                  "Other",
                                ].map(option => (
                                    <button
                                      key={option}
                                      onClick={() => setChoiceReason(prev => prev === option ? null : option)}
                                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                        choiceReason === option
                                          ? 'bg-primary text-primary-foreground border-primary'
                                          : 'border-border hover:border-primary/50 hover:bg-primary/5'
                                      }`}
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </div>
                                <textarea
                                  value={choiceReasonText}
                                  onChange={e => setChoiceReasonText(e.target.value)}
                                  placeholder={choiceReason === "Other" ? "Please describe your reason..." : "Add more detail (optional)..."}
                                  className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                                  rows={2}
                                />
                                <Button
                                  size="sm"
                                  className="w-full mt-2"
                                  disabled={
                                    !choiceReason && !choiceReasonText.trim() ||
                                    choiceReason === "Other" && !choiceReasonText.trim()
                                  }
                                  onClick={async () => {
                                    try {
                                      await fetch("/api/save-reason", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          session_id: sessionId,
                                          round: gameState?.currentRound,
                                          reason: choiceReason,
                                          reason_text: choiceReasonText || null,
                                        }),
                                      });
                                      setReasonSaved(true);
                                    } catch (e) {
                                      console.error("Failed to save reason", e);
                                    }
                                  }}
                                >
                                  Save Reason
                                </Button>
                              </div>
                            ) : (
                              <div className="p-3 rounded-lg bg-muted/50 border border-border flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">Reason saved:</span>
                                <span className="text-sm font-medium">{choiceReason}</span>
                                {choiceReasonText && <span className="text-xs text-muted-foreground">— {choiceReasonText}</span>}
                              </div>
                            )
                          )}

                          {/* Choice Distribution */}
                          <div className="p-4 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2 mb-3">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">Choice Distribution</span>
                              <Badge variant="outline" className="ml-auto">
                                {submittedState.totalSubmitted} players
                              </Badge>
                            </div>
                            <div className="space-y-2">
                              {Object.entries(submittedState.routes).map(([name, route]) => {
                                const count = submittedState.choiceDistribution[name] || 0;
                                const percentage = submittedState.totalSubmitted > 0 
                                  ? Math.round((count / submittedState.totalSubmitted) * 100) 
                                  : 0;
                                const isSelected = name === submittedState.playerChoice;
                                
                                return (
                                  <div 
                                    key={name} 
                                    className={`p-3 rounded-lg border ${
                                      isSelected ? 'border-primary bg-primary/5' : 'border-border'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between mb-1">
                                      <span className={`font-medium ${isSelected ? 'text-primary' : ''}`}>
                                        {name} {isSelected && '(Your choice)'}
                                      </span>
                                      <span className="text-sm text-muted-foreground">
                                        {count} player{count !== 1 ? 's' : ''} ({percentage}%)
                                      </span>
                                    </div>
                                    <div className="w-full bg-muted rounded-full h-2">
                                      <div 
                                        className={`h-2 rounded-full ${
                                          name === 'Route A' ? 'bg-blue-500' :
                                          name === 'Route B' ? 'bg-violet-500' : 'bg-orange-500'
                                        }`}
                                        style={{ width: `${percentage}%` }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                         {/* Change Choice Section */}
                          <div className={`p-4 rounded-lg border border-dashed ${revealedFinal ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <RefreshCw className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">Change Your Choice</span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-3">
                              Select a different route then confirm your change.
                            </p>
                            {changeChoiceError && (
                              <p className="text-sm text-red-500 mb-3">{changeChoiceError}</p>
                            )}
                            <div className="flex flex-col gap-2 mb-3">
                              {Object.entries(submittedState.routes).map(([name]) => {
                                const isCurrent = name === submittedState.playerChoice;
                                const isPending = name === pendingRoute;
                                const predictedTime = submittedState.predictedTimes?.[name];
                                return (
                                  <button
                                    key={name}
                                    disabled={changingChoice || isCurrent}
                                    onClick={() => setPendingRoute(isCurrent ? null : name)}
                                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm font-medium transition-colors
                                      ${isCurrent
                                        ? name === 'Route A' ? 'bg-blue-500/20 border-blue-500 text-blue-700 cursor-default' :
                                          name === 'Route B' ? 'bg-violet-500/20 border-violet-500 text-violet-700 cursor-default' :
                                          'bg-orange-500/20 border-orange-500 text-orange-700 cursor-default'
                                        : isPending
                                        ? name === 'Route A' ? 'bg-blue-500 border-blue-500 text-white' :
                                          name === 'Route B' ? 'bg-violet-500 border-violet-500 text-white' :
                                          'bg-orange-500 border-orange-500 text-white'
                                        : name === 'Route A' ? 'border-blue-300 hover:bg-blue-500/10 text-blue-700' :
                                          name === 'Route B' ? 'border-violet-300 hover:bg-violet-500/10 text-violet-700' :
                                          'border-orange-300 hover:bg-orange-500/10 text-orange-700'
                                      }`}
                                  >
                                    <span>
                                      {name}
                                      {isCurrent && <span className="ml-2 text-xs font-normal opacity-75">your current choice</span>}
                                      {isPending && <span className="ml-2 text-xs font-normal opacity-75">(selected)</span>}
                                    </span>
                                    {predictedTime != null && (
                                      <span className="text-xs font-normal opacity-80">
                                        ~{predictedTime.toFixed(1)} min predicted
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {pendingRoute && (
                              <Button
                                size="sm"
                                className="w-full"
                                disabled={changingChoice}
                                onClick={async () => {
                                  await handleChangeChoice(pendingRoute);
                                  setPendingRoute(null);
                                }}
                              >
                                {changingChoice
                                  ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Confirming...</>
                                  : `Confirm Change to ${pendingRoute}`}
                              </Button>
                            )}
                          </div>
                          
{/* Optimal Distribution */}
                          <div className={`p-4 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/30 ${!countdown && !revealedFinal ? 'opacity-40 pointer-events-none' : ''}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="flex items-center gap-2 flex-1">
                                <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                </svg>
                                <span className="font-medium text-muted-foreground">Wardrop Equilibrium</span>
                              </div>
                            </div>

                            <p className="text-xs text-muted-foreground mb-3 italic">
                              Optimal split computed via SLSQP — the distribution where no player can reduce their travel time by switching routes.
                            </p>
                            
                            {(!countdown && !revealedFinal) ? (
                              <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-xs">Available once all players submit...</span>
              </div>
                            ) : (() => {
                              const N = submittedState.totalSubmitted;
                              const routeNames = Object.keys(submittedState.routes);
                              const R = routeNames.length;

                              // Collect all unique edges across all routes
                              const allEdgeIds: string[] = [];
                              const edgeMap: Record<string, { freeTime: number; capacity: number; baseFlow: number }> = {};

                              for (const name of routeNames) {
                                for (const e of submittedState.routes[name].edges) {
                                  if (!edgeMap[e.id]) {
                                    allEdgeIds.push(e.id);
                                    edgeMap[e.id] = { freeTime: e.freeTime, capacity: e.capacity, baseFlow: e.baseFlow };
                                  }
                                }
                              }

                              const M = allEdgeIds.length;

                              // Build incidence matrix A[m][r] = 1 if edge m belongs to route r
                              const A: number[][] = allEdgeIds.map(eid =>
                                routeNames.map(name =>
                                  submittedState.routes[name].edges.some(e => e.id === eid) ? 1 : 0
                                )
                              );

                              // BPR per edge
                              const bpr = (freeTime: number, flow: number, capacity: number) =>
                                freeTime * (1 + 0.15 * Math.pow(flow / capacity, 4));

                              // BPR derivative T'(F)
                              const bprPrime = (freeTime: number, flow: number, capacity: number) =>
                                freeTime * 0.15 * 4 * Math.pow(flow, 3) / Math.pow(capacity, 4);

                              // Edge flows: F = b + A*x
                              const edgeFlows = (x: number[]): number[] =>
                                allEdgeIds.map((eid, m) => {
                                  const e = edgeMap[eid];
                                  return e.baseFlow + A[m].reduce((s, a, r) => s + a * x[r], 0);
                                });

                              // Objective: J(x) = sum_e F_e * T_e(F_e)
                              const objective = (x: number[]): number => {
                                const F = edgeFlows(x);
                                return allEdgeIds.reduce((sum, eid, m) => {
                                  const e = edgeMap[eid];
                                  return sum + F[m] * bpr(e.freeTime, F[m], e.capacity);
                                }, 0);
                              };

                              // Gradient: dJ/dx_r = sum_{e in r} MSC_e(F_e)
                              // MSC_e = T_e(F_e) + F_e * T'_e(F_e) = t0[1 + alpha*(1+beta)*(F/C)^beta]
                              const gradient = (x: number[]): number[] => {
                                const F = edgeFlows(x);
                                return routeNames.map((_, r) =>
                                  allEdgeIds.reduce((sum, eid, m) => {
                                    if (A[m][r] === 0) return sum;
                                    const e = edgeMap[eid];
                                    const msc = e.freeTime * (1 + 0.15 * 5 * Math.pow(F[m] / e.capacity, 4));
                                    return sum + msc;
                                  }, 0)
                                );
                              };

                              // Project onto simplex: sum(x) = N, x >= 0
                              const projectSimplex = (v: number[]): number[] => {
                                const sorted = [...v].sort((a, b) => b - a);
                                let rho = 0;
                                let cumSum = 0;
                                for (let i = 0; i < sorted.length; i++) {
                                  cumSum += sorted[i];
                                  if (sorted[i] - (cumSum - N) / (i + 1) > 0) rho = i;
                                }
                                const theta = (sorted.slice(0, rho + 1).reduce((s, v) => s + v, 0) - N) / (rho + 1);
                                return v.map(vi => Math.max(0, vi - theta));
                              };

                              // SLSQP via projected gradient with Armijo line search
                              let x = routeNames.map(() => N / R);
                              let lr = 1.0;

                              for (let iter = 0; iter < 1000; iter++) {
                                const grad = gradient(x);
                                // Armijo line search
                                let step = lr;
                                const J0 = objective(x);
                                const gradNormSq = grad.reduce((s, g) => s + g * g, 0);
                                for (let ls = 0; ls < 20; ls++) {
                                  const xNew = projectSimplex(x.map((xi, r) => xi - step * grad[r]));
                                  if (objective(xNew) <= J0 - 0.5 * step * gradNormSq) break;
                                  step *= 0.5;
                                }
                                const xNew = projectSimplex(x.map((xi, r) => xi - step * grad[r]));
                                const maxChange = x.reduce((m, xi, r) => Math.max(m, Math.abs(xNew[r] - xi)), 0);
                                x = xNew;
                                if (maxChange < 1e-7) break;
                              }

                              // Integer rounding: floor then distribute remainder
                              const floored = x.map(xi => Math.floor(xi));
                              let remainder = N - floored.reduce((s, v) => s + v, 0);
                              const fracs = x.map((xi, r) => ({ r, frac: xi - floored[r] }))
                                .sort((a, b) => b.frac - a.frac);
                              for (let i = 0; i < remainder; i++) floored[fracs[i].r]++;

                              // Final travel times at optimal integer distribution
                              const optFlows = edgeFlows(floored);
                              const routeTimes = routeNames.map((_, r) =>
                                allEdgeIds.reduce((sum, eid, m) => {
                                  if (A[m][r] === 0) return sum;
                                  const e = edgeMap[eid];
                                  return sum + bpr(e.freeTime, optFlows[m], e.capacity);
                                }, 0)
                              );

                              return (
                                <div className="space-y-2">
                                  {routeNames.map((name, r) => {
                                    const optCount = floored[r];
                                    const pct = N > 0 ? Math.round((optCount / N) * 100) : 0;
                                    const actualCount = submittedState.choiceDistribution[name] || 0;
                                    const diff = optCount - actualCount;

                                    return (
                                      <div key={name} className="p-3 rounded-lg border border-border bg-background">
                                        <div className="flex items-center justify-between mb-1">
                                          <span className="font-medium text-sm">{name}</span>
                                          <div className="flex items-center gap-2">
                                            {diff !== 0 && (
                                              <span className={`text-xs font-medium ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                {diff > 0 ? `+${diff} under` : `${Math.abs(diff)} over`}
                                              </span>
                                            )}
                                            <span className="text-xs text-muted-foreground">
                                              {pct}% · ~{routeTimes[r].toFixed(1)} min
                                            </span>
                                          </div>
                                        </div>
                                        <div className="w-full bg-muted rounded-full h-2">
                                          <div
                                            className={`h-2 rounded-full ${
                                              name === 'Route A' ? 'bg-blue-500' :
                                              name === 'Route B' ? 'bg-violet-500' : 'bg-orange-500'
                                            }`}
                                            style={{ width: `${pct}%` }}
                                          />
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Optimal: {optCount} players · Actual: {actualCount} players
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}

                          </div>

{/* Countdown - fixed top-left */}
                          {countdown !== null && (
                            <div className="fixed top-4 left-4 z-50 flex flex-col items-center gap-2">
                              {/* Circle timer */}
                              <div className="relative w-28 h-28">
                                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                                  <circle
                                    cx="56" cy="56" r="48"
                                    fill="none"
                                    stroke="#fca5a5"
                                    strokeWidth="7"
                                  />
                                  <circle
                                    cx="56" cy="56" r="48"
                                    fill="none"
                                    stroke="#dc2626"
                                    strokeWidth="7"
                                    strokeLinecap="round"
                                    strokeDasharray={`${2 * Math.PI * 48}`}
                                    strokeDashoffset={`${2 * Math.PI * 48 * (1 - countdown / 15)}`}
                                    className="transition-all duration-1000"
                                  />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-600 rounded-full shadow-xl">
                                  <span className="text-white text-3xl font-black leading-none">{countdown}</span>
                                  <span className="text-white text-xs font-medium opacity-90">seconds</span>
                                </div>
                              </div>
                              {/* Info card below circle */}
                              <div className="bg-red-600 text-white rounded-xl shadow-xl px-3 py-2 text-center max-w-[120px]">
                                <p className="text-xs font-bold leading-tight">Change window</p>
                                <p className="text-xs opacity-80 leading-tight mt-0.5">You Can Switch your route before time runs out</p>
                                {submittedState?.playerChoice && (
                                  <div className="mt-1.5 bg-red-700 rounded-lg px-2 py-1">
                                    <p className="text-xs opacity-70">Current</p>
                                    <p className="text-xs font-bold truncate">{submittedState.playerChoice}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Waiting Message */}
                          {submittedState.allSubmitted ? (
                            <div className="flex items-center justify-center gap-2 text-green-600">
                              <Users className="h-4 w-4" />
                              <span className="text-sm font-medium">
                                {revealedFinal
                                  ? "Final results shown — waiting for admin to advance the round."
                                  : "All players have submitted — results updating soon..."}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-2 text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">Waiting for other players to make their choices...</span>
                            </div>
                          )}
                        </div>
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
                                {gameState.selectedRoute?.totalTravelTime?.toFixed(1) ?? '—'}{" "}
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
                        currentRound={gameState.currentRound}
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
                                    <p className="font-bold">{log.realizedTime != null ? log.realizedTime.toFixed(1) + ' min' : '—'}</p>
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
