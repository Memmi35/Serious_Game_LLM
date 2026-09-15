// Prompt Version 2 for RegConSuader -- see lib/agent/prompts-v2.ts for the
// full rationale (ELM-grounded richer persuasion + White et al. 2023
// prompt-pattern structure). Mirrors prompts.ts's shape exactly, just
// pointing at the v2 base prompt and richer instruction text. STRATEGY_FRAMINGS
// is intentionally reused unchanged from prompts.ts -- the strategy-selector
// mechanism itself isn't part of this prompt-richness experiment, only the
// surrounding advisor text is.
//
// Switch phase deliberately has no v2 here -- already established this
// project runs RegConSuader V3 without the switch phase, so there's nothing
// to version for it.
import { CENTRAL_NO_NUMBERS_SYSTEM_PROMPT_V2 } from '@/lib/agent/prompts-v2'
import { STRATEGY_FRAMINGS, type MetaStrategy } from './prompts'

export const REGCONSUADER_SYSTEM_PROMPT_V2 = CENTRAL_NO_NUMBERS_SYSTEM_PROMPT_V2

// Anti-herding guard, strengthened after the QVOF room (qwq:32b, v2 prompts)
// showed the richer-persuasion tradeoff this guard exists to prevent: first-
// choice compliance jumped from 59.33% (673N, v1) to 88.67%, but Gap-to-
// Optimal got WORSE (1.65% -> 9.39%) and Congested Edges rose (10 -> 16).
// v1's guard phrased the herding risk as a hedge ("other players... could
// easily converge") because compliance was only ~50-60% when it was
// written -- at ~89% compliance, "could" understates it: if the advisor
// pushes everyone toward the same route, that route WILL fill up, close to
// deterministically, precisely because the advice now works. Rephrased to
// state that as the near-certain premise instead of a possibility, and to
// give a concrete behavioral instruction (prefer under-recommended routes)
// instead of just a warning to "weigh the risk."
export const RECOMMENDATION_INSTRUCTION_V2 = `
Guard against herding -- treat this as the near-certain default, not a
possibility: most players this round are being shown a similar comparison
and tend to follow your advice closely, so your recommendation is closer to
a vote than a suggestion. If you push every player toward whichever route
currently looks best, that route will very likely become overcrowded
specifically because your advice worked -- not despite it. Actively
counteract this rather than just weighing the risk: unless this specific
player's own history or stated concerns give you a real reason to do
otherwise, prefer recommending routes that are currently under-filled
relative to what this round still needs, even when a different route looks
like the obviously "best" pick in isolation. Your job is to help balance
the whole room across many players, not to repeatedly point everyone at
the same current "winner."

Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "2-4 sentences building a real case grounded in the numbers above -- not a one-line verdict"}
`

export function reactiveChatInstructionV2(strategy: MetaStrategy): string {
  return `
Continue persuading the player toward the system-optimal route in 3-6
sentences, using a ${strategy} framing. Build an actual argument rather
than asserting a conclusion. Pay attention to their last message: if they
expressed doubt or pushed back, soften your tone and address their specific
concern directly; if they responded positively or asked a clarifying
question, reinforce the same framing rather than switching tactics
mid-conversation. Stay consistent with the route you opened with unless
their pushback gives you a real reason to reconsider -- don't drift toward
a different "obviously best" route just because it would be an easier sell,
since that's exactly the kind of convergence that overcrowds a route.
`
}
