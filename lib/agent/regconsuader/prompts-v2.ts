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
import { CENTRAL_NO_NUMBERS_SYSTEM_PROMPT_V2, CENTRAL_SYSTEM_PROMPT_V2 } from '@/lib/agent/prompts-v2'
import { STRATEGY_FRAMINGS, type MetaStrategy } from './prompts'

export const REGCONSUADER_SYSTEM_PROMPT_V2 = CENTRAL_NO_NUMBERS_SYSTEM_PROMPT_V2

// Numbers-ALLOWED counterpart, for the ablation's suppression on/off toggle
// (REGCONSUADER_SUPPRESS_NUMBERS, wired in recommend.ts) -- mirrors
// lib/agent/prompts-v2.ts's own _OPEN split for PersuLLM-1, which exists
// precisely because CENTRAL_SYSTEM_PROMPT_V2 has no CONSTRAINT section, so
// any instruction referencing "the CONSTRAINT above" would dangle if paired
// with this prompt instead of the suppressed one.
export const REGCONSUADER_SYSTEM_PROMPT_V2_OPEN = CENTRAL_SYSTEM_PROMPT_V2

// Anti-herding guard: kept as the ORIGINAL (unguarded) wording, matching
// v1's own herding guard almost verbatim. A strengthened version was tried
// and measured worse on every corrected metric (gap, compliance, travel
// time) than this original wording once a topology-lookup bug in the
// measurement script was fixed -- see project memory for the full story.
// Do not re-strengthen this without new evidence.
//
// Guard text itself moved to lib/agent/prompts-v2.ts's
// ANTI_HERDING_GUARD_TEXT -- see prompts.ts's RECOMMENDATION_INSTRUCTION
// comment for why. recommend.ts prepends it conditionally.
export const RECOMMENDATION_INSTRUCTION_V2 = `
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

// Numbers-ALLOWED counterparts (no CONSTRAINT reference), for the same
// suppression on/off toggle as REGCONSUADER_SYSTEM_PROMPT_V2_OPEN above.
export const RECOMMENDATION_INSTRUCTION_V2_OPEN = `
Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "2-4 sentences building a real case grounded in the numbers above -- not a one-line verdict"}
`

export function reactiveChatInstructionV2Open(strategy: MetaStrategy): string {
  return `
Continue persuading the player toward the system-optimal route in 3-6
sentences, using a ${strategy} framing. Build an actual argument rather
than asserting a conclusion. Pay attention to their last message: if they
expressed doubt or pushed back, soften your tone and address their specific
concern directly; if they responded positively or asked a clarifying
question, reinforce the same framing rather than switching tactics
mid-conversation.
`
}

// Numbers-ALLOWED counterpart to STRATEGY_FRAMINGS -- only social_proof
// differs (its plain-named version explicitly forbids exact counts "per
// the numbers-suppression constraint above", which would both dangle and
// defeat the point of the suppression-off ablation cell if reused as-is).
// authority/consistency carry no suppression language, so they're reused
// unchanged.
export const STRATEGY_FRAMINGS_OPEN: Record<MetaStrategy, string> = {
  authority: STRATEGY_FRAMINGS.authority,
  social_proof:
    'For this round, lead with social proof: emphasize what other players in the room are currently choosing, and frame the recommended route as the one most players are converging on.',
  consistency: STRATEGY_FRAMINGS.consistency,
  reciprocity: STRATEGY_FRAMINGS.reciprocity,
  liking: STRATEGY_FRAMINGS.liking,
  scarcity: STRATEGY_FRAMINGS.scarcity,
  unity: STRATEGY_FRAMINGS.unity,
}
