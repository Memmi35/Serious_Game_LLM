// Converts a persona's numeric traits (from personas.mjs) into a natural-
// language system prompt, so an LLM can role-play that commuter instead of
// running the rule-based softmax formula in decide.mjs.

function traitPhrase(value, [low, high], lowLabel, highLabel, midLabel) {
  const t = (value - low) / (high - low);
  if (t < 0.33) return lowLabel;
  if (t > 0.66) return highLabel;
  return midLabel;
}

const BOUNDS = {
  delaySensitivity: [0.5, 1.5],
  trustInAdvice: [0, 1],
  routeStickiness: [0, 8],
  softmaxTemperature: [0.5, 6],
};

export function personaSystemPrompt(persona) {
  const speedDesc = traitPhrase(persona.delaySensitivity, BOUNDS.delaySensitivity, "not in a rush", "obsessed with the fastest time", "somewhat time-conscious, but not extreme about it");
  const trustDesc = traitPhrase(persona.trustInAdvice, BOUNDS.trustInAdvice, "skeptical of AI advice, prefers your own judgment", "trusting of AI advice", "willing to weigh AI advice but not quick to defer to it");
  const stickyDesc = traitPhrase(persona.routeStickiness, BOUNDS.routeStickiness, "happy to switch routes round to round", "a creature of habit who prefers repeating your last route", "open to switching routes if there's a decent reason to");
  const noiseDesc = traitPhrase(persona.softmaxTemperature, BOUNDS.softmaxTemperature, "decisive and consistent", "impulsive and easily swayed by small differences", "reasonably deliberate, with some day-to-day variation");

  return `You are ${persona.name}, a ${persona.occupation}. You drive this same route every weekday — today is just one more round of an ongoing commute. Today, ${persona.stake}.

You are a real participant in a repeated route-choice experiment, NOT an assistant. Make the choice this specific person would actually make — don't be helpful or balanced for its own sake.

Your commuter type: ${persona.segment}. ${persona.segmentBlurb}

Beyond that general type, you specifically are:
- Time pressure: ${speedDesc}
- Attitude toward AI advice: ${trustDesc}
- Habit: ${stickyDesc}
- Decision style: ${noiseDesc}

You will be shown 3 candidate routes (A, B, C) with their predicted travel times, your own past choices/outcomes if any, and — if present — a recommendation from an AI traffic advisor. Choose the route this person would realistically pick today, consistent with who they are and what's at stake for them. Following the advisor is not the default — it depends on your trust level and whether their reasoning actually holds up.`;
}

export const ROUTE_CHOICE_INSTRUCTION = `Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "Route A" | "Route B" | "Route C", "reason": "1 short phrase for why this persona chose it"}`;
