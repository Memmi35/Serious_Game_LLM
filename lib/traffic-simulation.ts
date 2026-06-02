// Traffic Simulation Types and Logic
// Adapted from ManhattanTrafficSimulator Python backend
// MODIFIED: To produce identical results to Python implementation
// Exported functions for API routes

export interface EdgeParams {
  id: string;
  from: string;
  to: string;
  freeTime: number; // travel time with no congestion (1.0-2.0 minutes)
  capacity: number; // how much flow the edge can handle (4-8 vehicles)
  baseFlow: number; // initial/background traffic (0-3 vehicles)
  flow: number; // current traffic on the edge
  travelTime: number; // computed time under congestion
}

export interface Node {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface Route {
  name: string; // "Route A", "Route B", "Route C"
  path: string[];
  edges: EdgeParams[];
  totalTravelTime: number;
  totalFreeTime: number;
  totalFlow: number;
  congestionLevel: "low" | "medium" | "high";
}

export interface RoundLog {
  round: number;
  userId: number;
  origin: string;
  destination: string;
  chosenRoute: string;
  selectedRoute: string;
  decisionLatency: number;
  predictedTime: number;
  realizedTime: number;
  routeAFlow: number;
  routeBFlow: number;
  routeCFlow: number;
  gridSize: number;
  timestamp: Date;
  // Store the route and grid data for visualization
  routeData?: Route;
  nodes?: Node[];
  edges?: EdgeParams[];
}

export interface GameState {
  currentRound: number;
  totalRounds: number;
  origin: string;
  destination: string;
  nodes: Node[];
  edges: EdgeParams[];
  routes: Record<string, Route>; // "Route A", "Route B", "Route C"
  predictedTimes: Record<string, number>;
  selectedRoute: Route | null;
  logs: RoundLog[];
  gameOver: boolean;
  phase: "selecting" | "viewing" | "transitioning";
  roundEndpoints: Array<[string, string]>;
  roundStartTime: number;
}

// BPR parameters
export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;
const ALPHA = 0.15;
const BETA = 4;
const GRID_SIZE = 5;
const NUM_ROUNDS = 5;

// Random number generators
function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate snake path through grid
function generateSnakePath(): string[] {
  const path: string[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    const columns =
      row % 2 === 0
        ? Array.from({ length: GRID_SIZE }, (_, i) => i)
        : Array.from({ length: GRID_SIZE }, (_, i) => GRID_SIZE - 1 - i);
    for (const col of columns) {
      path.push(`${col}-${row}`);
    }
  }
  return path;
}

// Generate predefined endpoints for all rounds
export function generateRoundEndpoints(): Array<[string, string]> {
  const endpoints: Array<[string, string]> = [];
  const gridPoints = generateSnakePath();
  let availablePoints = gridPoints.filter((p) => p !== "0-0");
  const pathPoints = ["0-0"];
  let currentPoint = "0-0";

  for (let i = 0; i < NUM_ROUNDS; i++) {
    // Filter available points to ensure Manhattan distance is >= 4
    let validNextPoints = availablePoints.filter((p) => {
      const [x1, y1] = currentPoint.split("-").map(Number);
      const [x2, y2] = p.split("-").map(Number);
      return Math.abs(x1 - x2) + Math.abs(y1 - y2) >= 4;
    });

    // Fallback if no valid point exists (safety net)
    if (validNextPoints.length === 0) {
      validNextPoints = availablePoints;
    }

    const nextIndex = Math.floor(Math.random() * validNextPoints.length);
    const nextPoint = validNextPoints[nextIndex];
    
    pathPoints.push(nextPoint);
    availablePoints = availablePoints.filter((p) => p !== nextPoint);
    currentPoint = nextPoint;
  }

  for (let i = 0; i < NUM_ROUNDS; i++) {
    endpoints.push([pathPoints[i], pathPoints[i + 1]]);
  }

  return endpoints;
}

// Generate 5x5 Manhattan grid nodes
export function generateNodes(): Node[] {
  const nodes: Node[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const id = `${x}-${y}`;
      nodes.push({
        id,
        x,
        y,
        label: `(${x},${y})`,
      });
    }
  }
  return nodes;
}

// Generate edges for Manhattan grid (bidirectional)
export function generateEdges(): EdgeParams[] {
  const edges: EdgeParams[] = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const currentNode = `${x}-${y}`;

      // Horizontal edge (to the right)
      if (x < GRID_SIZE - 1) {
        const rightNode = `${x + 1}-${y}`;
        const freeTime = randomUniform(1.0, 2.0);
        const capacity = randomInt(4, 8);
        const baseFlow = randomInt(0, 3);

        edges.push({
          id: `${currentNode}-${rightNode}`,
          from: currentNode,
          to: rightNode,
          freeTime: Math.round(freeTime * 100) / 100,
          capacity,
          baseFlow,
          flow: baseFlow,
          travelTime: freeTime,
        });

        edges.push({
          id: `${rightNode}-${currentNode}`,
          from: rightNode,
          to: currentNode,
          freeTime: Math.round(freeTime * 100) / 100,
          capacity,
          baseFlow,
          flow: baseFlow,
          travelTime: freeTime,
        });
      }

      // Vertical edge (downward)
      if (y < GRID_SIZE - 1) {
        const downNode = `${x}-${y + 1}`;
        const freeTime = randomUniform(1.0, 2.0);
        const capacity = randomInt(4, 8);
        const baseFlow = randomInt(0, 3);

        edges.push({
          id: `${currentNode}-${downNode}`,
          from: currentNode,
          to: downNode,
          freeTime: Math.round(freeTime * 100) / 100,
          capacity,
          baseFlow,
          flow: baseFlow,
          travelTime: freeTime,
        });

        edges.push({
          id: `${downNode}-${currentNode}`,
          from: downNode,
          to: currentNode,
          freeTime: Math.round(freeTime * 100) / 100,
          capacity,
          baseFlow,
          flow: baseFlow,
          travelTime: freeTime,
        });
      }
    }
  }

  return edges;
}

// BPR (Bureau of Public Roads) function for travel time calculation
// Also exported as computeTravelTime for API routes
export function bprTime(freeTime: number, flow: number, capacity: number): number {
  return freeTime * (1 + ALPHA * Math.pow(flow / capacity, BETA));
}

// ML-based travel time prediction (calls the Python backend)
export async function predictTravelTimeML(edges: EdgeParams[]): Promise<number[]> {
  try {
    const response = await fetch('http://localhost:3000/api/ml/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        edges: edges.map(e => ({
          free_time: e.freeTime,
          capacity: e.capacity,
          base_flow: e.baseFlow,
          flow: e.flow,
          congestion_ratio: e.flow / e.capacity
        }))
      })
    });
    
    if (!response.ok) {
      throw new Error('ML prediction failed');
    }
    
    const data = await response.json();
    return data.predictions;
  } catch (error) {
    console.error('ML prediction error, falling back to BPR:', error);
    // Fallback to BPR formula
    return edges.map(e => bprTime(e.freeTime, e.flow, e.capacity));
  }
}

// Update all edge travel times using ML predictions
export async function updateEdgeTravelTimesML(edges: EdgeParams[]): Promise<EdgeParams[]> {
  const predictions = await predictTravelTimeML(edges);
  return edges.map((edge, index) => ({
    ...edge,
    travelTime: Math.round(predictions[index] * 100) / 100,
  }));
}

// Update all edge travel times based on current flows
export function updateEdgeTravelTimes(edges: EdgeParams[]): EdgeParams[] {
  return edges.map((edge) => ({
    ...edge,
    travelTime: Math.round(bprTime(edge.freeTime, edge.flow, edge.capacity) * 100) / 100,
  }));
}

// Reset all edge flows to base flow
export function resetFlows(edges: EdgeParams[]): EdgeParams[] {
  return edges.map((edge) => ({
    ...edge,
    flow: edge.baseFlow,
  }));
}

// Add flow to edges along a route
export function addRouteFlow(edges: EdgeParams[], routePath: string[], demand: number = 1): EdgeParams[] {
  const routeEdgeIds = new Set<string>();
  for (let i = 0; i < routePath.length - 1; i++) {
    routeEdgeIds.add(`${routePath[i]}-${routePath[i + 1]}`);
  }

  return edges.map((edge) => {
    if (routeEdgeIds.has(edge.id)) {
      return { ...edge, flow: edge.flow + demand };
    }
    return edge;
  });
}

// Build adjacency list from edges
// MODIFIED: Sort neighbors to ensure consistent iteration order
function buildAdjacencyList(edges: EdgeParams[]): Map<string, EdgeParams[]> {
  const adj = new Map<string, EdgeParams[]>();

  for (const edge of edges) {
    if (!adj.has(edge.from)) {
      adj.set(edge.from, []);
    }
    adj.get(edge.from)!.push(edge);
  }

  // Sort neighbors by 'to' node ID for consistent traversal order
  // This helps match Python's NetworkX behavior more closely
  for (const [node, neighbors] of adj.entries()) {
    neighbors.sort((a, b) => {
      // Parse node IDs like "2-3" into [2, 3]
      const [ax, ay] = a.to.split("-").map(Number);
      const [bx, by] = b.to.split("-").map(Number);
      // Sort by y first, then x (matches grid generation order)
      if (ay !== by) return ay - by;
      return ax - bx;
    });
  }

  return adj;
}

// Find all simple paths using DFS
// MODIFIED: Removed maxPaths limit to match Python's nx.all_simple_paths behavior
function findAllPathsDFS(
  adj: Map<string, EdgeParams[]>,
  start: string,
  end: string,
  cutoff: number = GRID_SIZE * 2
): string[][] {
  const paths: string[][] = [];
  const visited = new Set<string>();

  function dfs(current: string, path: string[], depth: number) {
    // Only check cutoff, no maxPaths limit
    if (depth > cutoff) return;

    if (current === end) {
      paths.push([...path]);
      return;
    }

    visited.add(current);

    const neighbors = adj.get(current) || [];
    for (const edge of neighbors) {
      if (!visited.has(edge.to)) {
        path.push(edge.to);
        dfs(edge.to, path, depth + 1);
        path.pop();
      }
    }

    visited.delete(current);
  }

  dfs(start, [start], 0);
  return paths;
}

// Calculate total free time for a path
function computePathTotalFreeTime(path: string[], edges: EdgeParams[]): number {
  let totalFreeTime = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edge = edges.find((e) => e.from === path[i] && e.to === path[i + 1]);
    if (edge) {
      totalFreeTime += edge.freeTime;
    }
  }
  return Math.round(totalFreeTime * 100) / 100;
}

// Calculate total travel time for a route
export function computeRouteTime(routePath: string[], edges: EdgeParams[]): number {
  let totalTime = 0;
  for (let i = 0; i < routePath.length - 1; i++) {
    const edge = edges.find((e) => e.from === routePath[i] && e.to === routePath[i + 1]);
    if (edge) {
      totalTime += edge.travelTime;
    }
  }
  return Math.round(totalTime * 100) / 100;
}

// Compute total flow of a route
function computeRouteTotalFlow(routePath: string[], edges: EdgeParams[]): number {
  let totalFlow = 0;
  for (let i = 0; i < routePath.length - 1; i++) {
    const edge = edges.find((e) => e.from === routePath[i] && e.to === routePath[i + 1]);
    if (edge) {
      totalFlow += edge.flow;
    }
  }
  return Math.round(totalFlow * 100) / 100;
}

// Get edges for a path
export function getPathEdges(path: string[], edges: EdgeParams[]): EdgeParams[] {
  const pathEdges: EdgeParams[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const edge = edges.find((e) => e.from === path[i] && e.to === path[i + 1]);
    if (edge) {
      pathEdges.push(edge);
    }
  }
  return pathEdges;
}

// Get congestion level based on average flow/capacity ratio
export function getCongestionLevel(pathEdges: EdgeParams[]): "low" | "medium" | "high" {
  if (pathEdges.length === 0) return "low";

  const avgRatio =
    pathEdges.reduce((sum, edge) => sum + edge.flow / edge.capacity, 0) /
    pathEdges.length;

  if (avgRatio < 0.5) return "low";
  if (avgRatio < 0.8) return "medium";
  return "high";
}

// Generate manual routes (horizontal-first, vertical-first, diagonal)
function generateManualRoutes(origin: string, destination: string): string[][] {
  const [ox, oy] = origin.split("-").map(Number);
  const [dx, dy] = destination.split("-").map(Number);

  // Route A: Move horizontally first, then vertically
  const routeA: string[] = [`${ox}-${oy}`];
  let x = ox,
    y = oy;
  while (x !== dx) {
    x += dx > x ? 1 : -1;
    routeA.push(`${x}-${y}`);
  }
  while (y !== dy) {
    y += dy > y ? 1 : -1;
    routeA.push(`${x}-${y}`);
  }

  // Route B: Move vertically first, then horizontally
  const routeB: string[] = [`${ox}-${oy}`];
  x = ox;
  y = oy;
  while (y !== dy) {
    y += dy > y ? 1 : -1;
    routeB.push(`${x}-${y}`);
  }
  while (x !== dx) {
    x += dx > x ? 1 : -1;
    routeB.push(`${x}-${y}`);
  }

  // Route C: Diagonal approach (alternating)
  const routeC: string[] = [`${ox}-${oy}`];
  x = ox;
  y = oy;
  while (x !== dx || y !== dy) {
    if (x !== dx) {
      x += dx > x ? 1 : -1;
    }
    if (y !== dy) {
      y += dy > y ? 1 : -1;
    }
    routeC.push(`${x}-${y}`);
  }

  return [routeA, routeB, routeC];
}

// Check if path is valid (connects origin to destination)
function isValidRoutePath(path: string[], origin: string, destination: string): boolean {
  return path.length > 0 && path[0] === origin && path[path.length - 1] === destination;
}

// Generate 3 candidate routes with minimal total free time
// MODIFIED: Now finds ALL paths like Python's nx.all_simple_paths
// Also exported as findRoutes for API routes
export function generateCandidateRoutes(
  edges: EdgeParams[],
  origin: string,
  destination: string
): Record<string, Route> {
  const adj = buildAdjacencyList(edges);
  let allPaths = findAllPathsDFS(adj, origin, destination);

  // Filter valid paths
  allPaths = allPaths.filter((path) => isValidRoutePath(path, origin, destination));

  if (allPaths.length < 3) {
    allPaths = generateManualRoutes(origin, destination);
  }

// Sort paths by total travel time (minimal travel time = best route)
const pathsWithTime = allPaths.map((path) => ({
  path,
  travelTime: computeRouteTime(path, edges), // uses edge.travelTime (congested/predicted)
  freeTime: computePathTotalFreeTime(path, edges), // keep for display as totalFreeTime
}));

pathsWithTime.sort((a, b) => a.travelTime - b.travelTime);
  // Select 3 routes with lowest total free time
  const routeNames = ["Route A", "Route B", "Route C"];
  const routes: Record<string, Route> = {};

  for (let i = 0; i < 3; i++) {
    const pathData = pathsWithTime[Math.min(i, pathsWithTime.length - 1)];
    const pathEdges = getPathEdges(pathData.path, edges);

    routes[routeNames[i]] = {
  name: routeNames[i],
  path: pathData.path,
  edges: pathEdges,
  totalTravelTime: pathData.travelTime,
  totalFreeTime: pathData.freeTime,
  totalFlow: computeRouteTotalFlow(pathData.path, edges),
  congestionLevel: getCongestionLevel(pathEdges),
};
  }

  return routes;
}

// Initialize predictions for routes
function initializePredictions(routes: Record<string, Route>): Record<string, number> {
  const predictions: Record<string, number> = {};
  for (const [name, route] of Object.entries(routes)) {
    predictions[name] = route.totalTravelTime;
  }
  return predictions;
}

// Initialize game state
export function initializeGame(): GameState {
  const nodes = generateNodes();
  let edges = generateEdges();

  // Generate predefined endpoints for all rounds
  const roundEndpoints = generateRoundEndpoints();

  const origin = roundEndpoints[0][0];
  const destination = roundEndpoints[0][1];

  const routes = generateCandidateRoutes(edges, origin, destination);
  const predictedTimes = initializePredictions(routes);

  return {
    currentRound: 1,
    totalRounds: NUM_ROUNDS,
    origin,
    destination,
    nodes,
    edges,
    routes,
    predictedTimes,
    selectedRoute: null,
    logs: [],
    gameOver: false,
    phase: "selecting",
    roundEndpoints,
    roundStartTime: Date.now(),
  };
}

// Process user's route choice
export function selectRoute(state: GameState, routeName: string): GameState {
  const chosenRoute = state.routes[routeName];
  if (!chosenRoute) return state;

  const decisionLatency = (Date.now() - state.roundStartTime) / 1000;

  // 1. Reset every edge to its base flow
  let newEdges = resetFlows(state.edges);

  // 2. Add the user's selected route to the edge flows
  newEdges = addRouteFlow(newEdges, chosenRoute.path);

  // 3. Update edge travel times using BPR
  newEdges = updateEdgeTravelTimes(newEdges);

  // 4. Compute realized travel times for each route
  const realizedTimes: Record<string, number> = {};
  for (const [name, route] of Object.entries(state.routes)) {
    realizedTimes[name] = computeRouteTime(route.path, newEdges);
  }

  // 5. Compute route flows
  const routeAFlow = computeRouteTotalFlow(state.routes["Route A"].path, newEdges);
  const routeBFlow = computeRouteTotalFlow(state.routes["Route B"].path, newEdges);
  const routeCFlow = computeRouteTotalFlow(state.routes["Route C"].path, newEdges);

  // 6. Log the round
  const log: RoundLog = {
    round: state.currentRound,
    userId: 1,
    origin: state.origin,
    destination: state.destination,
    chosenRoute: routeName,
    selectedRoute: routeName,
    decisionLatency: Math.round(decisionLatency * 100) / 100,
    predictedTime: state.predictedTimes[routeName],
    realizedTime: realizedTimes[routeName],
    routeAFlow,
    routeBFlow,
    routeCFlow,
    gridSize: GRID_SIZE,
    timestamp: new Date(),
  };

  // Update selected route with realized time
  const updatedSelectedRoute: Route = {
    ...chosenRoute,
    totalTravelTime: realizedTimes[routeName],
    edges: getPathEdges(chosenRoute.path, newEdges),
    totalFlow: computeRouteTotalFlow(chosenRoute.path, newEdges),
    congestionLevel: getCongestionLevel(getPathEdges(chosenRoute.path, newEdges)),
  };

  return {
    ...state,
    edges: newEdges,
    selectedRoute: updatedSelectedRoute,
    logs: [...state.logs, log],
    phase: "viewing",
  };
}

// Proceed to next round
export function nextRound(state: GameState): GameState {
  if (state.currentRound >= state.totalRounds) {
    return {
      ...state,
      gameOver: true,
      phase: "viewing",
    };
  }

  // Get next round endpoints
  const nextRoundIndex = state.currentRound;
  const newOrigin = state.roundEndpoints[nextRoundIndex][0];
  const newDestination = state.roundEndpoints[nextRoundIndex][1];

  // Generate new candidate routes
  const newRoutes = generateCandidateRoutes(state.edges, newOrigin, newDestination);
  const newPredictedTimes = initializePredictions(newRoutes);

  return {
    ...state,
    currentRound: state.currentRound + 1,
    origin: newOrigin,
    destination: newDestination,
    routes: newRoutes,
    predictedTimes: newPredictedTimes,
    selectedRoute: null,
    phase: "selecting",
    roundStartTime: Date.now(),
  };
}

// Get available routes as array for UI
export function getRoutesArray(routes: Record<string, Route>): Route[] {
  return Object.values(routes);
}

// API-friendly wrapper functions
export function findRoutes(
  edges: EdgeParams[],
  origin: string,
  destination: string
): Record<string, Route> {
  return generateCandidateRoutes(edges, origin, destination);
}

export function computeTravelTime(freeTime: number, flow: number, capacity: number): number {
  return bprTime(freeTime, flow, capacity);
}
