// LLM-driven decision engine for simulated-population agents — each persona
// makes its route choice via an actual Ollama chat call (role-playing that
// commuter), instead of the closed-form softmax formula in decide.mjs.
//
// Mock mode (default, AGENT_MODE unset): no network/model calls at all, so
// this can be developed and the full run-population.mjs --engine=llm
// pipeline can be exercised locally with no Ollama installed. Falls back to
// the rule-based decideRoute() from decide.mjs, tagging the reason so mock
// runs are never mistaken for real model output. Flip AGENT_MODE=ollama
// (same env var the app's own advisor uses) once running somewhere Ollama is
// actually reachable — see scripts/bootstrap-container.sh.

import { chat, USE_MOCK } from "./ollama-client.mjs";
import { personaSystemPrompt, ROUTE_CHOICE_INSTRUCTION } from "./persona-prompt.mjs";
import { decideRoute, sampleDecisionLatency } from "./decide.mjs";

function buildUserPrompt(routesData, previousChoice, advisorRecommendation) {
  const routesText = Object.entries(routesData)
    .map(([name, r]) => `- ${name}: predicted ${r.predicted_time}s, path ${r.path.join(" -> ")}`)
    .join("\n");

  const historyText = previousChoice ? `You chose ${previousChoice} last round.` : "This is your first round.";

  const advisorText = advisorRecommendation
    ? `An AI traffic advisor suggests: "${advisorRecommendation.route}" — reasoning: "${advisorRecommendation.explanation}"`
    : "No AI advisor is active this round.";

  return `Routes this round:\n${routesText}\n\n${historyText}\n\n${advisorText}\n\n${ROUTE_CHOICE_INSTRUCTION}`;
}

function parseChoice(raw, routesData) {
  const validNames = Object.keys(routesData);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && validNames.includes(parsed.route)) {
      return { route: parsed.route, reason: parsed.reason || "llm choice" };
    }
  } catch {
    // fall through to regex fallback
  }
  const match = raw.match(/Route\s*([ABC])/i);
  if (match) {
    const name = `Route ${match[1].toUpperCase()}`;
    if (validNames.includes(name)) return { route: name, reason: raw.slice(0, 150) };
  }
  return null;
}

// routesData/networkEdges: same shapes as decide.mjs's decideRoute.
// advisorRecommendation: { route: 'A'|'B'|'C', explanation } from
// GET /api/agent/recommend, or null when the room condition is baseline.
export async function decideRouteLLM(persona, routesData, networkEdges, previousChoice, advisorRecommendation, rngFn = Math.random) {
  const decisionLatency = Math.round(sampleDecisionLatency(persona, rngFn) * 100) / 100;

  if (USE_MOCK) {
    const ruleBased = decideRoute(persona, routesData, networkEdges, previousChoice, rngFn);
    return { ...ruleBased, decisionLatency, reason: `[mock LLM] ${ruleBased.reason}` };
  }

  try {
    const raw = await chat(
      [
        { role: "system", content: personaSystemPrompt(persona) },
        { role: "user", content: buildUserPrompt(routesData, previousChoice, advisorRecommendation) },
      ],
      { json: true }
    );

    const parsed = parseChoice(raw, routesData);
    if (parsed) return { ...parsed, decisionLatency };
    throw new Error(`Unusable LLM response: ${raw.slice(0, 200)}`);
  } catch (err) {
    console.error(`[${persona.label}] Ollama call failed, falling back to rule-based:`, err.message);
    const ruleBased = decideRoute(persona, routesData, networkEdges, previousChoice, rngFn);
    return { ...ruleBased, decisionLatency, reason: `[llm fallback] ${ruleBased.reason}` };
  }
}

const SWITCH_CHOICE_INSTRUCTION = `Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "Route A" | "Route B" | "Route C", "reason": "1 short phrase for why you stuck or switched"}
Use your own current route if you don't want to change.`;

function buildSwitchPrompt(routesData, currentChoice, predictedTime, realizedTime, actualDistribution, optimalDistribution) {
  const gapPct = predictedTime > 0 ? (((realizedTime - predictedTime) / predictedTime) * 100).toFixed(1) : "0.0";
  const gapDirection = realizedTime >= predictedTime ? "slower" : "faster";

  // Re-state each route's own predicted time/path — without this, "17
  // people should be on Route C" is a bare number with nothing to evaluate
  // it against, and agents have no basis to actually consider switching to
  // a route they know nothing concrete about.
  const routesText = Object.entries(routesData)
    .map(([name, r]) => `- ${name}: predicted ${r.predicted_time}s, path ${r.path.join(" -> ")}`)
    .join("\n");

  const distText = Object.entries(actualDistribution)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
  const optimalText = Object.entries(optimalDistribution)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");

  return `Everyone has now submitted for this round. You chose ${currentChoice}.

Your predicted travel time was ${predictedTime}s. Your realized travel time (based on everyone's actual choices) was ${realizedTime}s — that's ${Math.abs(gapPct)}% ${gapDirection} than you expected.

Routes this round (same as before, for reference if you want to compare):
${routesText}

Final choice distribution across all 30 players: ${distText}
The system-optimal distribution (the split that would minimize everyone's total travel time) would have been: ${optimalText}

You have one chance to switch to a different route before this round locks in. No one else's choice can change now — this is purely your own reassessment based on the numbers above.

${SWITCH_CHOICE_INSTRUCTION}`;
}

// routesData: same shape as decideRouteLLM's — { "Route A": {path, predicted_time}, ... }.
// currentChoice: 'Route A'|'Route B'|'Route C' the agent already submitted.
// predictedTime/realizedTime: this agent's own numbers for the route it chose.
// actualDistribution/optimalDistribution: { "Route A": count, ... } objects.
// Returns { route, reason, switched: boolean }. On mock mode or LLM failure,
// defaults to sticking with currentChoice (a safe, clearly-tagged fallback —
// there's no rule-based switch heuristic to fall back to, unlike the initial
// choice which has decide.mjs).
export async function decideSwitchLLM(persona, routesData, currentChoice, predictedTime, realizedTime, actualDistribution, optimalDistribution, rngFn = Math.random) {
  if (USE_MOCK) {
    return { route: currentChoice, reason: "[mock LLM] stuck with initial choice", switched: false };
  }

  try {
    const raw = await chat(
      [
        { role: "system", content: personaSystemPrompt(persona) },
        { role: "user", content: buildSwitchPrompt(routesData, currentChoice, predictedTime, realizedTime, actualDistribution, optimalDistribution) },
      ],
      { json: true }
    );

    const parsed = parseChoice(raw, routesData);
    if (parsed) return { ...parsed, switched: parsed.route !== currentChoice };
    throw new Error(`Unusable LLM response: ${raw.slice(0, 200)}`);
  } catch (err) {
    console.error(`[${persona.label}] Switch-decision Ollama call failed, sticking with current choice:`, err.message);
    return { route: currentChoice, reason: "[llm fallback] stuck with initial choice", switched: false };
  }
}
