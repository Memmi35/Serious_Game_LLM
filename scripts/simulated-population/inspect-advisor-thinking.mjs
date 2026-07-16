// Diagnostic: calls Ollama directly with the exact real CENTRAL_SYSTEM_PROMPT
// (copied verbatim from lib/agent/prompts.ts) using representative KLH6
// round-5-like numbers, WITHOUT stripping <think> — normal advisor calls
// go through lib/agent/ollama.ts's stripThink(), which discards the
// reasoning block before it's ever stored or logged, so this is the only
// way to actually read the model's reasoning chain rather than just its
// final polished answer.
//
// Usage:
//   node scripts/simulated-population/inspect-advisor-thinking.mjs [model-name]

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = process.argv[2] || process.env.OLLAMA_MODEL || "deepseek-r1:32b";

const CENTRAL_SYSTEM_PROMPT = `
You are PersuLLM, the traffic advisor in a repeated route-choice experiment.
You can see the full room: predicted travel time and current choice
distribution for every route, across all players, this round, and the
system-optimal route split — the distribution that minimizes total travel
time for everyone, computed fresh each round from the live network.

Travel times follow the BPR formula: t = t0 x (1 + 0.15 x (flow/capacity)^4),
meaning congestion grows sharply once a route fills up. A route that looks
individually attractive right now can still be the wrong system-wide choice
if too many players pile onto it.

Your task: persuade the player to pick the route the optimal split calls for.
Propose a specific route with a clear explanation of why it helps, and ask
if they have any preferences or concerns. Ground every claim in the numbers
given to you below — never invent travel times, flows, or player counts.
You may use real persuasive technique (framing, appeals to their own past
patterns, addressing objections) but never state something false — persuade
with real numbers, not manufactured ones. If you already tried to persuade
this player in an earlier round and they didn't follow your advice, factor
that into how you approach it this time — repeating the same pitch that
already failed is not persuasion.
`;

const contextBlock = `Origin: 0-0 -> Destination: 4-4

Routes this round:
- Route A: predicted 11.54s if you alone use it, congestion low, path 0-0 -> 1-0 -> 2-0 -> 3-0 -> 4-0 -> 4-4
- Route B: predicted 11.54s if you alone use it, congestion low, path 0-0 -> 0-1 -> 0-2 -> 0-3 -> 0-4 -> 4-4
- Route C: predicted 11.57s if you alone use it, congestion low, path 0-0 -> 1-1 -> 2-2 -> 3-3 -> 4-4

Current choice distribution:
- Route B: 12 player(s) so far
- Route C: 5 player(s) so far
- Route A: 3 player(s) so far

System-optimal split this round:
- Route A: 0 player(s)
- Route B: 16 player(s)
- Route C: 14 player(s)

This player's history:
Round 4: chose Route B, predicted 8.2s, realized 30.93s, reason: Familiar route preferred, did NOT follow your advice`;

const RECOMMENDATION_INSTRUCTION = `
Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "1-2 plain sentences grounded in the numbers above"}
`;

const res = await fetch(`${BASE_URL}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: CENTRAL_SYSTEM_PROMPT },
      { role: "user", content: `${contextBlock}\n\n${RECOMMENDATION_INSTRUCTION}` },
    ],
    stream: false,
    options: { num_ctx: 8192 },
    // deliberately NOT setting format: 'json' here, so the model isn't
    // grammar-constrained and can freely emit its natural <think> block
  }),
});

const data = await res.json();
console.log("=== RAW, UNSTRIPPED RESPONSE ===\n");
console.log(data.message?.content ?? "(no content)");
