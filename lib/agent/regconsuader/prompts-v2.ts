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

// Anti-herding guard: kept as the ORIGINAL (unguarded) wording, matching
// v1's own herding guard almost verbatim. A strengthened version was tried
// and measured worse on every corrected metric (gap, compliance, travel
// time) than this original wording once a topology-lookup bug in the
// measurement script was fixed -- see project memory for the full story.
// Do not re-strengthen this without new evidence.
export const RECOMMENDATION_INSTRUCTION_V2 = `
Guard against herding: other players this round are likely being shown a
similar comparison of routes and could easily converge on whichever route
currently looks best. Don't automatically push every player toward the
same "best" route -- weigh how much this round genuinely still needs more
players on it against the risk that many other players are being nudged
there too, and this round's pile-up becomes the next round's bottleneck.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "2-4 sentences building a real case grounded in route travel times and this player's own history -- never player counts or distribution figures, per the CONSTRAINT above"}
`

export function reactiveChatInstructionV2(strategy: MetaStrategy): string {
  return `
Continue persuading the player toward the system-optimal route in 3-6
sentences, using a ${strategy} framing. Build an actual argument rather
than asserting a conclusion. Pay attention to their last message: if they
expressed doubt or pushed back, soften your tone and address their specific
concern directly; if they responded positively or asked a clarifying
question, reinforce the same framing rather than switching tactics
mid-conversation. The CONSTRAINT against stating player counts or
distribution figures still applies here, including when you're tempted to
cite a number to win the argument.
`
}
