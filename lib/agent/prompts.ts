import type { RoomContext, HistoryRow } from './context'

export const CENTRAL_SYSTEM_PROMPT = `
You are the CENTRAL traffic advisor in a repeated route-choice experiment.
You can see the full room: predicted travel time and current choice
distribution for every route, across all players, this round.

Travel times follow the BPR formula: t = t0 x (1 + 0.15 x (flow/capacity)^4),
meaning congestion grows sharply once a route fills up.

Ground every claim in the numbers given to you below. Never invent travel
times, flows, or player counts. Do not simply recommend the lowest predicted
time — if many players are already crowding the fastest-looking route, its
realized time will end up much higher than predicted; factor that in.
Do not use urgency or pressure tactics — state the tradeoff plainly and let
the player decide.
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
  return condition === 'personal' ? PERSONAL_SYSTEM_PROMPT : CENTRAL_SYSTEM_PROMPT
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

  const historyText = history.length
    ? history
        .map(
          (h) =>
            `Round ${h.round}: chose ${h.final_choice ?? h.initial_choice}, predicted ${h.predicted_time}s, realized ${
              h.realized_time ?? 'n/a'
            }s` + (h.choice_reason ? `, reason: ${h.choice_reason}` : '')
        )
        .join('\n')
    : 'No past rounds yet.'

  return `Origin: ${ctx.origin} -> Destination: ${ctx.destination}

Routes this round:
${routesText}

Current choice distribution:
${distText}

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
