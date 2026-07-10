// Rule-based decision engine for simulated-population agents. No LLM call —
// each persona picks a route via a utility function + softmax sampling over
// the same routes/predicted-times a human player would see in get-state.

function findEdge(networkEdges, from, to) {
  return (
    networkEdges.find((e) => e.from === from && e.to === to) ??
    networkEdges.find((e) => e.from === to && e.to === from)
  );
}

// Average flow/capacity ratio along the route's edges.
function congestionPenalty(path, networkEdges) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edge = findEdge(networkEdges, path[i], path[i + 1]);
    if (edge) {
      sum += edge.flow / edge.capacity;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function utilityFor(persona, routeName, routeData, congestion, previousChoice) {
  const timeTerm = -persona.delaySensitivity * routeData.predicted_time;
  const congestionTerm = -persona.riskAversion * congestion;
  const stickinessTerm = routeName === previousChoice ? persona.routeStickiness : 0;
  return {
    total: timeTerm + congestionTerm + stickinessTerm,
    timeTerm,
    congestionTerm,
    stickinessTerm,
  };
}

function softmaxSample(entries, temperature, rngFn) {
  const scaled = entries.map((e) => e.utility.total / Math.max(temperature, 1e-6));
  const maxScaled = Math.max(...scaled);
  const weights = scaled.map((s) => Math.exp(s - maxScaled));
  const total = weights.reduce((a, b) => a + b, 0);
  const probs = weights.map((w) => w / total);

  const r = rngFn();
  let cumulative = 0;
  for (let i = 0; i < entries.length; i++) {
    cumulative += probs[i];
    if (r <= cumulative) return { chosen: entries[i], probs };
  }
  return { chosen: entries[entries.length - 1], probs };
}

function reasonFor(chosenName, entries, previousChoice) {
  const sortedByTime = [...entries].sort((a, b) => a.routeData.predicted_time - b.routeData.predicted_time);
  const sortedByCongestion = [...entries].sort((a, b) => a.congestion - b.congestion);
  const chosen = entries.find((e) => e.name === chosenName);

  if (chosenName === previousChoice && chosen.utility.stickinessTerm > 0) {
    return "stuck with previous choice";
  }
  if (sortedByTime[0].name === chosenName) {
    return "fastest predicted time";
  }
  if (sortedByCongestion[0].name === chosenName) {
    return "avoided congested route";
  }
  return "best overall tradeoff";
}

// Box-Muller transform for a standard normal sample.
function sampleStandardNormal(rngFn) {
  const u1 = Math.max(rngFn(), 1e-9);
  const u2 = rngFn();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sampleDecisionLatency(persona, rngFn = Math.random) {
  const mu = Math.log(persona.decisionLatencyMean);
  const z = sampleStandardNormal(rngFn);
  const latency = Math.exp(mu + persona.decisionLatencySigma * z);
  return Math.min(60, Math.max(1, latency));
}

// routesData: { "Route A": { path, predicted_time, ... }, ... } from GET /api/get-state
// networkEdges: state.network.edges from the same response
export function decideRoute(persona, routesData, networkEdges, previousChoice, rngFn = Math.random) {
  const entries = Object.entries(routesData).map(([name, routeData]) => {
    const congestion = congestionPenalty(routeData.path, networkEdges);
    const utility = utilityFor(persona, name, routeData, congestion, previousChoice);
    return { name, routeData, congestion, utility };
  });

  const { chosen } = softmaxSample(entries, persona.softmaxTemperature, rngFn);
  const reason = reasonFor(chosen.name, entries, previousChoice);
  const decisionLatency = sampleDecisionLatency(persona, rngFn);

  return {
    route: chosen.name,
    reason,
    decisionLatency: Math.round(decisionLatency * 100) / 100,
  };
}
