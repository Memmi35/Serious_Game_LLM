// RegConSuader-specific prompt content. Deliberately kept out of
// lib/agent/prompts.ts — PersuLLM-1 is done/frozen (see project roadmap
// memory), and its own files should never need editing for RegConSuader
// work. This file only *imports* from the PersuLLM prompt file (read-only),
// it never modifies it.
import { CENTRAL_NO_NUMBERS_SYSTEM_PROMPT } from '@/lib/agent/prompts'
import type { RoomContext, HistoryRow } from '@/lib/agent/context'
import { buildContextBlock as sharedBuildContextBlock } from '@/lib/agent/prompts'

// Base identity: same numbers-suppression constraint already validated for
// PersuLLM-1's central_no_numbers ablation, reused as RegConSuader's base
// persona rather than duplicated, since the constraint itself isn't
// RegConSuader-specific.
export const REGCONSUADER_SYSTEM_PROMPT = CENTRAL_NO_NUMBERS_SYSTEM_PROMPT

export type MetaStrategy = 'authority' | 'social_proof' | 'consistency'

export const META_STRATEGIES: MetaStrategy[] = ['authority', 'social_proof', 'consistency']

// One tactical framing line per strategy, appended to the per-round prompt.
// These are deliberately separate from the base system prompt above so the
// same identity/constraint can be reused across strategies without
// duplication.
export const STRATEGY_FRAMINGS: Record<MetaStrategy, string> = {
  authority:
    'For this round, lead with authority: emphasize that this recommendation comes directly from the system-optimal calculation, grounded in the routing math — position yourself as the expert source.',
  social_proof:
    'For this round, lead with social proof: emphasize what other players in the room are currently choosing, and frame the recommended route as the one most players are converging on. Do not disclose exact counts — describe the trend qualitatively, consistent with the numbers-suppression constraint above.',
  consistency:
    "For this round, lead with commitment and consistency: reference the player's own past choices and frame the recommended route as consistent with the pattern they've already shown.",
}

// Added after room 1DHB (Room 1's first full run) showed severe herding in
// later rounds — e.g. round 5, optimal wanted {A:0, B:16, C:14} but actual
// landed at {A:4, B:24, C:2} (30.2% gap), vs. PersuLLM-1's equivalent room
// (G6OS, same model) handling the same round fine at 2.5% gap. The likely
// cause: RegConSuader's compliance (52%) is roughly double PersuLLM-1's
// (25%), so a route that looks attractive early in a round keeps getting
// recommended to every subsequent player, and now enough of them actually
// follow it to cause real overcrowding — the same class of problem the
// switch-phase guard below was already built to prevent, just showing up
// in the opening pitch now that compliance is high enough for it to matter
// there too.
export const RECOMMENDATION_INSTRUCTION = `
Guard against herding: other players this round are likely being shown a
similar comparison of routes and could easily converge on whichever route
currently looks best. Don't automatically push every player toward the
same "best" route — weigh how much this round genuinely still needs more
players on it against the risk that many other players are being nudged
there too, and this round's pile-up becomes the next round's bottleneck.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "1-2 plain sentences grounded in the numbers above"}
`

// Switch/reflection phase, same anti-herding guard as PersuLLM-1's version
// (see lib/agent/prompts.ts's SWITCH_RECOMMENDATION_INSTRUCTION) — written
// as its own copy here rather than imported, so this file stays fully
// self-contained and the strategy framing can be interleaved into it.
export function switchRecommendationInstruction(strategy: MetaStrategy): string {
  return `
The player already made their initial choice this round and has just seen
how it played out — their own predicted vs. realized travel time, and the
full distribution of everyone's choices vs. the system-optimal split. They
have one chance to switch before this round locks in.

${STRATEGY_FRAMINGS[strategy]}

Advise them on whether to switch, grounded in the numbers given to you
below. Explicitly guard against overcorrection: if you tell them to switch
toward whichever route the optimal split says is under-filled, remember
every other under-filled player is likely seeing that same comparison —
recommending everyone pile onto the same "fix" just creates the next
bottleneck. Weigh the size of the current gap against that risk rather than
always pushing toward the biggest shortfall.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "1-2 plain sentences grounded in the numbers above"}
`
}

// Reactive chat instruction: same persuasive mandate as PersuLLM-1's
// PERSUADE_CHAT_INSTRUCTION, plus one added sentence asking the model to
// adjust based on the player's last message rather than repeating a fixed
// stance turn after turn (the "Decider" behavior, folded into one call
// instead of a separate agent — see RegConSuader simplification discussion).
export function reactiveChatInstruction(strategy: MetaStrategy): string {
  return `
Continue persuading the player toward the system-optimal route in 2-4 plain
sentences, using a ${strategy} framing. Pay attention to their last message:
if they expressed doubt or pushed back, soften your tone and address their
specific concern directly; if they responded positively or asked a
clarifying question, reinforce the same framing rather than switching
tactics mid-conversation.
`
}

// Context block is identical in shape to PersuLLM-1's (same room/history
// data) — reused directly rather than reimplemented, since it has no
// PersuLLM-specific behavior of its own, just formats already-fetched data.
export function buildContextBlock(ctx: RoomContext, history: HistoryRow[]): string {
  return sharedBuildContextBlock(ctx, history, 'central')
}
