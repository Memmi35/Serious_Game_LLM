import re

with open("components/traffic-simulation.tsx", "r") as f:
    text = f.read()

# Make initialSessionId work and add useEffect for polling
# Replace handleNextRound to support initializing state from null
# We also want it to poll when status is waiting or when phase is "viewing" (waiting for next round)

replacement = """  const fetchState = useCallback(async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/get-state?session_id=${sessionId}`);
      const data = await response.json();

      if (data.status === "waiting") {
        setGameState(null); // Explicitly state we are waiting
        return "waiting";
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
                logs: [],
                gameOver: data.game_over,
                phase: "selecting",
                roundEndpoints: [],
                roundStartTime: Date.now()
             };
          }

          // If the round advanced, we move to selecting
          const phase = data.current_round > prev.currentRound ? "selecting" : prev.phase;
          
          return {
            ...prev,
            currentRound: data.current_round,
            origin: data.origin,
            destination: data.destination,
            nodes,
            edges,
            routes,
            predictedTimes: data.predicted_times,
            phase,
            gameOver: data.game_over,
          };
        });
        roundStartTimeRef.current = Date.now();
        return "initialized";
      }
    } catch (error) {
      console.error("Error fetching state:", error);
    }
    return null;
  }, [sessionId]);

  const handleNextRound = fetchState;

  // Poll state if initialSessionId handles wait
  import_react_useEffect = true;
"""

# We'll just carefully replace the handleNextRound function
