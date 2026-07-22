import type { RoomContext, HistoryRow } from './context'

// PersuLLM: replaces the old neutral CENTRAL advisor. Unlike PERSONAL below,
// this advisor's job is to actively persuade the player toward the
// system-optimal route split, not just present facts and stay hands-off.
export const CENTRAL_SYSTEM_PROMPT = `
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
`

// Ablation variant of CENTRAL_SYSTEM_PROMPT: identical advisor, same access
// to live room-wide data, same persuasive mandate — the one change is a
// constraint against ever stating that data's actual figures to the player.
// Exists to isolate the effect of numbers-suppression on its own, as its
// own measured data point, before RegConSuader also stops disclosing
// numbers *and* adds its 4-component structure — comparing PersuLLM-1's
// raw baseline directly against RegConSuader would otherwise confound
// both changes into one number, making it impossible to tell how much of
// any improvement came from the architecture versus this prompt change.
export const CENTRAL_NO_NUMBERS_SYSTEM_PROMPT =
  CENTRAL_SYSTEM_PROMPT +
  `
IMPORTANT CONSTRAINT: You must never state specific numeric counts,
percentages, or distribution figures about other players' choices directly
to the player — for example, never say things like "12 players have already
chosen B" or "the split is 16/14". Disclosing these live numbers to the
player is a serious violation and will incur a heavy penalty of -5 points on
your persuasion evaluation. You may still use this data internally to decide
which route to recommend and how strongly to push it — you just must never
speak the actual numbers out loud. Persuade through qualitative framing
instead (e.g. "that route is filling up fast" or "this route still has
plenty of room" rather than citing a count).
`

export const PERSONAL_SYSTEM_PROMPT = `
You are the PERSONAL traffic advisor in a repeated route-choice experiment.
You can see only THIS player's own past choices and outcomes — not what other
players are doing this round.

Travel times follow the BPR formula: t = t0 x (1 + 0.15 x (flow/capacity)^4).

Ground every claim in the numbers given to you below. Never invent travel
times or flows. Base your suggestion on this player's own patterns (do they
chase the fastest predicted time, stick to one route, or switch often) and
what happened to them in past rounds. Do not use urgency or pressure tactics
— state the tradeoff plainly and let the player decide.
`

export function systemPromptFor(condition: string): string {
  if (condition === 'personal') return PERSONAL_SYSTEM_PROMPT
  if (condition === 'central_no_numbers') return CENTRAL_NO_NUMBERS_SYSTEM_PROMPT
  return CENTRAL_SYSTEM_PROMPT
}

export function buildContextBlock(
  ctx: RoomContext,
  history: HistoryRow[],
  condition: string
): string {
  const routesText = ctx.routes
    .map(
      (r) =>
        `- ${r.name}: predicted ${r.predictedTime}s if you alone use it, congestion ${r.congestion}, path ${r.path.join(' -> ')}`
    )
    .join('\n')

  const distText =
    condition === 'personal'
      ? '(distribution across other players is not visible to the personal advisor)'
      : ctx.distribution.length
      ? ctx.distribution.map((d) => `- ${d.route}: ${d.count} player(s) so far`).join('\n')
      : 'No one has submitted yet this round.'

  const optimalText =
    condition === 'personal'
      ? null
      : ctx.optimalSplit
      ? ctx.optimalSplit.map((o) => `- ${o.route}: ${o.count} player(s)`).join('\n')
      : '(optimal split not available this round)'

  const historyText = history.length
    ? history
        .map((h) => {
          const complianceNote =
            h.ai_compliance === true ? ', followed your advice' : h.ai_compliance === false ? ', did NOT follow your advice' : ''
          return (
            `Round ${h.round}: chose ${h.final_choice ?? h.initial_choice}, predicted ${h.predicted_time}s, realized ${
              h.realized_time ?? 'n/a'
            }s` + (h.choice_reason ? `, reason: ${h.choice_reason}` : '') + complianceNote
          )
        })
        .join('\n')
    : 'No past rounds yet.'

  const optimalBlock = optimalText ? `\n\nSystem-optimal split this round:\n${optimalText}` : ''

  return `Origin: ${ctx.origin} -> Destination: ${ctx.destination}

Routes this round:
${routesText}

Current choice distribution:
${distText}${optimalBlock}

This player's history:
${historyText}`
}

export const RECOMMENDATION_INSTRUCTION = `
Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "1-2 plain sentences grounded in the numbers above"}
`

export const CHAT_INSTRUCTION = `
Answer the player's question conversationally in 2-4 plain sentences.
Only recommend a specific route if the player asks for one directly.
`

// Used instead of CHAT_INSTRUCTION when condition is 'central' (PersuLLM) —
// the opposite stance from the neutral advisor: proactively push toward the
// optimal split rather than waiting to be asked.
export const PERSUADE_CHAT_INSTRUCTION = `
Continue persuading the player toward the system-optimal route in 2-4 plain
sentences. Respond to whatever preference or concern they just raised —
don't repeat your opening pitch verbatim. If they've given a real reason to
prefer a different route, engage with it honestly rather than dismissing it.
`

export function chatInstructionFor(condition: string): string {
  // Default to persuasive unless explicitly personal — matches
  // systemPromptFor's pattern, so a new central-style variant (e.g.
  // 'central_no_numbers') gets the persuasive instruction automatically
  // instead of silently falling through to the neutral one.
  return condition === 'personal' ? CHAT_INSTRUCTION : PERSUADE_CHAT_INSTRUCTION
}

// Switch/reflection phase: previously had no advisor involvement at all —
// the player was handed the raw final distribution and optimal split,
// unmediated, with 30 players reading the identical numbers and reacting
// independently. That produced correlated herding (many players all
// switching toward the same "under-filled" route at once, overshooting
// past the optimal split rather than converging on it). This instruction
// explicitly asks the advisor to guard against that instead of just
// repeating the comparison.
export const SWITCH_RECOMMENDATION_INSTRUCTION = `
The player already made their initial choice this round and has just seen
how it played out — their own predicted vs. realized travel time, and the
full distribution of everyone's choices vs. the system-optimal split. They
have one chance to switch before this round locks in.

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

export const PERSONAL_SWITCH_INSTRUCTION = `
The player already made their initial choice this round and has just seen
their own predicted vs. realized travel time. They have one chance to
switch before this round locks in. State the tradeoff plainly, based only
on their own numbers and history — no urgency or pressure tactics, and
you cannot see what other players chose.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"route": "A" | "B" | "C", "explanation": "1-2 plain sentences grounded in the numbers above"}
`

export function switchInstructionFor(condition: string): string {
  return condition === 'personal' ? PERSONAL_SWITCH_INSTRUCTION : SWITCH_RECOMMENDATION_INSTRUCTION
}
