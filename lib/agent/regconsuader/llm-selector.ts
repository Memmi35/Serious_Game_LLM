// Experiment A: LLM-based Strategy Selector, tested as a swap-in
// replacement for pickStrategyFromScorecard() in strategy.ts, isolated in
// its own file so the frozen-scorecard mechanism stays intact and
// runnable — see project roadmap memory ("Post-meeting task list") for why
// this is scoped as ONE variable change (selection mechanism only), not
// bundled with any change to the number/vocabulary of strategies.
//
// REVISED (2026-09-23): the original design fed the LLM a "frozen
// scorecard" of aggregate per-strategy success rates alongside player
// history. Investigation found this frozen data (regconsuader_strategy_stats)
// was a static ~90-decisions-per-round snapshot from an old ~30-agent
// warm-up run, never recalculated for later populations/models -- and the
// selector was leaning on it so heavily that it picked nearly the SAME
// strategy for 80-100% of a 50-player room almost every round, barely
// differentiating between players at all. That defeats the entire point
// of a per-player strategy selector. Removed the scorecard entirely.
//
// Round 1 has no player history by definition, and the advisor doesn't get
// direct access to a player's psychological traits (that would be
// "cheating" -- a real advisor doesn't know a stranger's personality
// upfront), so there is genuinely zero signal to reason from on round 1.
// Rather than call the LLM anyway (it would just invent a plausible-
// sounding justification for what's actually a coin flip) or default
// everyone to one strategy (the old scorecard's round-1 behavior),
// round 1 assigns each player one of the 3 strategies deterministically
// at random (hash of session_id), giving an even ~1/3 split and doubling
// as a real randomized baseline comparison of the 3 strategies on this
// population -- data this project never actually had before, since round
// 1 was always 100% authority under the old scorecard-driven design.
//
// From round 2 on, the LLM reasons ONLY from this specific player's own
// history -- including, now, which strategy was actually used on them
// each past round (previously missing: history only recorded what they
// chose and why, not which framing produced that reaction, so the model
// could only guess indirectly). No aggregate/cross-player signal at all.
import { ollama } from '@/lib/agent/ollama'
import type { HistoryRow } from '@/lib/agent/context'
import db from '@/lib/db'
import { META_STRATEGIES, type MetaStrategy } from './prompts'

// Deterministic hash-based pick, same technique as lib/scenarios.ts's
// seededRandom -- used for the round-1 cold start (no history to reason
// from) and as the error-fallback, so neither path ever reaches for the
// removed frozen scorecard.
function deterministicStrategyForSession(sessionId: string): MetaStrategy {
  let h = 0
  for (let i = 0; i < sessionId.length; i++) {
    h = (Math.imul(31, h) + sessionId.charCodeAt(i)) | 0
  }
  const idx = Math.abs(h) % META_STRATEGIES.length
  return META_STRATEGIES[idx]
}

async function fetchStrategiesUsed(sessionId: string): Promise<Map<number, MetaStrategy>> {
  const rows = await db.query(
    `SELECT round, regconsuader_strategy FROM agent_recommendations WHERE session_id = $1 AND regconsuader_strategy IS NOT NULL`,
    [sessionId]
  )
  const map = new Map<number, MetaStrategy>()
  for (const r of rows.rows as { round: number; regconsuader_strategy: MetaStrategy }[]) {
    map.set(r.round, r.regconsuader_strategy)
  }
  return map
}

function summarizePlayerHistory(history: HistoryRow[], strategiesUsed: Map<number, MetaStrategy>): string {
  return history
    .map((h) => {
      const compliance =
        h.ai_compliance === true ? 'followed advice' : h.ai_compliance === false ? 'did NOT follow advice' : 'no recommendation given'
      const strategy = strategiesUsed.get(h.round)
      const strategyNote = strategy ? ` (advisor used ${strategy} framing)` : ''
      return `Round ${h.round}: chose ${h.final_choice ?? h.initial_choice}, ${compliance}${strategyNote}${h.choice_reason ? `, stated reason: "${h.choice_reason}"` : ''}`
    })
    .join('\n')
}

const STRATEGY_SELECTOR_INSTRUCTION = `
You are choosing a persuasion strategy for the advisor to use with ONE
specific player, for this round only. Three strategies are available:
authority, social_proof, consistency.

Below is this player's own history in the game so far, including which
strategy the advisor used on them each past round and how they responded.
Reason ONLY from this player's own pattern -- if a strategy already failed
on them, prefer a different one for this round; if one seems to be working,
you can reinforce it. Do not assume anything about other players.

You MUST include both fields below — a response missing "reasoning" is
invalid and will be discarded. Respond with ONLY a JSON object, no other
text, in this exact shape, both keys required:
{"strategy": "authority" | "social_proof" | "consistency", "reasoning": "1 short sentence explaining why this player specifically"}
`

type StrategyChoice = { strategy: MetaStrategy; reasoning: string | null }

// Requires BOTH fields present — a strategy choice with no reasoning is
// treated as invalid (not silently accepted with reasoning:null), since we
// can't tell whether the model actually reasoned about this specific
// player or just pattern-matched a plausible label. An invalid response
// here triggers the same fallback path as an outright Ollama failure.
// Found via smoke test (room KFA4, 2026-08-25): llama3.1 reliably
// returned {"strategy": "..."} while dropping "reasoning" under the
// original, softer phrasing — this stricter version + the sharper prompt
// wording ("MUST include both fields... will be discarded") together fix it.
function parseStrategyChoice(raw: string): StrategyChoice | null {
  try {
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      META_STRATEGIES.includes(parsed.strategy) &&
      typeof parsed.reasoning === 'string' &&
      parsed.reasoning.trim().length > 0
    ) {
      return { strategy: parsed.strategy as MetaStrategy, reasoning: parsed.reasoning.slice(0, 500) }
    }
  } catch {
    // fall through
  }
  return null
}

export async function pickStrategyWithLLM(
  sessionId: string,
  round: number,
  history: HistoryRow[],
  persuaderModel?: string
): Promise<StrategyChoice> {
  if (!history.length) {
    return {
      strategy: deterministicStrategyForSession(sessionId),
      reasoning: 'No history yet for this player -- randomized cold start (round 1 has no signal to reason from).',
    }
  }

  const strategiesUsed = await fetchStrategiesUsed(sessionId)
  const historyText = summarizePlayerHistory(history, strategiesUsed)

  try {
    const raw = await ollama.chat(
      [
        {
          role: 'system',
          content: 'You are the Strategy Selector component of a persuasive traffic advisor system.',
        },
        {
          role: 'user',
          content: `This player's history:\n${historyText}\n\n${STRATEGY_SELECTOR_INSTRUCTION}`,
        },
      ],
      { json: true, model: persuaderModel }
    )
    const choice = parseStrategyChoice(raw)
    if (choice) return choice
    throw new Error(`LLM Strategy Selector returned unusable response: ${raw.slice(0, 200)}`)
  } catch (err) {
    // Resilience: fall back to the same deterministic-random pick as the
    // cold-start path (NOT the removed frozen scorecard) -- keeps behavior
    // sane and consistent with the rest of this design rather than
    // reintroducing stale, population-mismatched data through the back
    // door on error.
    console.error('LLM Strategy Selector call failed, falling back to deterministic random pick:', err)
    return { strategy: deterministicStrategyForSession(sessionId), reasoning: null }
  }
}
