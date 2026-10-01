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

// Extended from the original 3 (authority/social_proof/consistency) to the
// full Cialdini (2021) 7-principle taxonomy -- reciprocity, liking,
// scarcity, unity added. In practice this stays "LLM-selector only": the
// frozen scorecard (strategy.ts's pickStrategyFromScorecard) is seeded from
// regconsuader_strategy_stats, which only has rows for the original 3 --
// every round (1-5) has seeded data for this project, so its per-round
// argmax loop always overwrites the fallback with one of those 3, and the
// 7-wide assignStrategy() rotation below is never actually reached. The LLM
// selector (llm-selector.ts) is the only path that can genuinely pick one
// of the 4 new strategies.
export type MetaStrategy = 'authority' | 'social_proof' | 'consistency' | 'reciprocity' | 'liking' | 'scarcity' | 'unity'

export const META_STRATEGIES: MetaStrategy[] = [
  'authority',
  'social_proof',
  'consistency',
  'reciprocity',
  'liking',
  'scarcity',
  'unity',
]

// Pruned subset: the 4 strategies that measured at or above V2's (no-
// selector) compliance baseline on room EQB1 (social_proof 90.0%, unity
// 89.5%, consistency 87.6%, scarcity 85.7%, n=14-105 each), dropping the
// 3 that measured below it (authority 77.8% n=9, reciprocity 76.0% n=25,
// liking 70.0% n=10). Opt-in via STRATEGY_VOCAB=pruned in llm-selector.ts
// -- tests whether removing the weak framings closes V4's compliance gap
// with V2 without touching advice quality (EQB1's hypothetical-100%-
// compliance gap was already on par with V2's). Caveat: this prune is
// fit to one population (Pop50, this seed) and may not generalize.
export const META_STRATEGIES_PRUNED: MetaStrategy[] = ['social_proof', 'unity', 'consistency', 'scarcity']

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
  reciprocity:
    "For this round, lead with reciprocity: give the player something of real value first — a clear, honest piece of insight about how this round's congestion is actually forming — before asking them to follow the recommendation, so the ask feels like a fair exchange rather than a one-sided demand.",
  liking:
    "For this round, lead with liking: build rapport by relating to the player's own situation — acknowledge what they're likely weighing (time, hassle, past frustration) in a warm, non-generic way — before making the case for the recommended route.",
  scarcity:
    "For this round, lead with scarcity: frame the recommended route's current advantage as a narrowing window — the route is favorable right now but won't stay that way once more players commit.",
  unity:
    'For this round, lead with unity: frame the recommendation in terms of a shared identity — "we" as everyone navigating this same network together — so following it reads as contributing to a shared outcome, not just a personal choice.',
}

// Per-strategy matching criteria for the LLM selector (llm-selector.ts's
// STRATEGY_SELECTOR_INSTRUCTION). Added because the selector was previously
// given only a bare list of strategy names and a weak "don't repeat a
// failure" heuristic, with no guidance on which player/history pattern
// actually calls for which principle -- a smoke test (TPG4) showed that
// pruning the vocabulary down to the apparently-strongest 4 strategies
// backfired (consistency's own compliance rate dropped 87.6% -> 78.7%)
// because players who needed a dropped strategy got mismatched onto a
// remaining one instead. This keeps the full 7-option palette and instead
// gives the model real matching criteria, so it can place players better
// without removing any option.
//
// REVISED: the first version of this file invented its own matching
// heuristics from scratch, which measured worse than no criteria at all
// (room HQ0P). This version instead grounds each criterion directly in
// Cialdini's (2021) own stated activation condition for that principle --
// the specific circumstance under which the research says it persuades
// best -- translated onto the only signal the selector actually has
// access to: this player's own game history.
export const STRATEGY_MATCH_CRITERIA: Record<MetaStrategy, string> = {
  authority:
    "Cialdini: deference to authority is strongest when the audience lacks their own technical framework for the decision. Best fit: a player whose stated reasons show no independent technical or numeric reasoning of their own (gut-feel or habit-based reasons), who has not pushed back on expert-sourced advice before.",
  social_proof:
    'Cialdini: social proof persuades most under uncertainty about the correct choice. Best fit: a player whose stated reasons show hesitation, indecision, or explicit uncertainty -- weak fit for a player who has stated firm, independent conviction.',
  consistency:
    "Cialdini: the consistency pull is strongest when a prior choice was active and self-attributed in the player's own words, not accidental or imposed. Best fit: a player who has given their own explicit reasoning for a stable, repeated pattern across rounds.",
  reciprocity:
    'Cialdini: the reciprocity norm is triggered most by a gift that comes first, unprompted, and feels personally tailored, not generic. Best fit: a player who has not yet been given a direct, personalized piece of insight in earlier rounds (as opposed to a templated pitch).',
  liking:
    'Cialdini: liking builds through similarity, cooperation toward a shared goal, and familiarity from repeated contact. Best fit: a player the advisor has already interacted with across multiple rounds, where a track record of cooperative framing can be referenced.',
  scarcity:
    'Cialdini: scarcity persuades through loss-framing of a narrowing, freely-available opportunity -- a newly-closing option moves people more than a chronically scarce one. Best fit: a player facing a route whose current advantage is only now closing, not one that has already been framed as scarce for several rounds.',
  unity:
    'Cialdini: unity ("we-ness") persuades through genuine shared identity -- a real shared fate or shared experience, not mere similarity -- and only works when that shared identity is credible. Best fit: any player, since every player genuinely shares the same road network and congestion outcome; strongest when this authentic shared-fate framing has not already been used on them recently.',
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
// Anti-herding guard text moved to lib/agent/prompts-v2.ts's
// ANTI_HERDING_GUARD_TEXT (now an independent toggle, ANTI_HERDING_GUARD
// env var, wired in recommend.ts) -- was baked in here unconditionally,
// which meant every RegConSuader room ever run always had it and it could
// never be isolated as its own ablation variable. recommend.ts prepends it
// conditionally to whichever instruction is picked below.
export const RECOMMENDATION_INSTRUCTION = `
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
