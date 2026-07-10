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
