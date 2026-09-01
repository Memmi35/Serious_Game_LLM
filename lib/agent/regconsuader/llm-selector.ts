// Experiment A: LLM-based Strategy Selector, tested as a swap-in
// replacement for pickStrategyFromScorecard() in strategy.ts, isolated in
// its own file so the frozen-scorecard mechanism stays intact and
// runnable — see project roadmap memory ("Post-meeting task list") for why
// this is scoped as ONE variable change (selection mechanism only), not
// bundled with any change to the number/vocabulary of strategies.
//
// Design choice (confirmed with user): "personalization informed by
// aggregate data" — the LLM sees both this specific player's own history
// AND the frozen scorecard's per-strategy success rates for this round, so
// it reasons on top of the same warm-up evidence pickStrategyFromScorecard()
// uses, rather than starting from zero information. This keeps the 450
// warm-up decisions useful instead of discarded, and gives the model
// something concrete to ground its choice in.
import { ollama } from '@/lib/agent/ollama'
import type { HistoryRow } from '@/lib/agent/context'
import db from '@/lib/db'
import { META_STRATEGIES, type MetaStrategy } from './prompts'
import { pickStrategyFromScorecard } from './strategy'

function summarizePlayerHistory(history: HistoryRow[]): string {
  if (!history.length) return 'No past rounds yet for this player.'
  return history
    .map((h) => {
      const compliance =
        h.ai_compliance === true ? 'followed advice' : h.ai_compliance === false ? 'did NOT follow advice' : 'no recommendation given'
      return `Round ${h.round}: chose ${h.final_choice ?? h.initial_choice}, ${compliance}${h.choice_reason ? `, stated reason: "${h.choice_reason}"` : ''}`
    })
    .join('\n')
}

async function scorecardSummary(round: number): Promise<string> {
  const rows = await db.query(
    `SELECT strategy, attempts, successes FROM regconsuader_strategy_stats WHERE round = $1`,
    [round]
  )
  if (rows.rows.length === 0) return 'No aggregate data available for this round yet.'
  return rows.rows
    .map((r: { strategy: string; attempts: number; successes: number }) => {
      const rate = r.attempts > 0 ? ((r.successes / r.attempts) * 100).toFixed(1) : '0.0'
      return `${r.strategy}: ${rate}% success rate across ${r.attempts} past decisions this round`
    })
    .join('\n')
}

const STRATEGY_SELECTOR_INSTRUCTION = `
You are choosing a persuasion strategy for the advisor to use with ONE
specific player, for this round only. Three strategies are available:
authority, social_proof, consistency.

Below is (a) this player's own history in the game so far, and (b) how each
strategy has performed on average across other players in this same round.
Use both — don't ignore the aggregate data, but weigh it against what you
know about this specific player. For example, a player who has consistently
ignored advice might respond better to a different framing than the
round's overall best performer; a player with no history yet should
probably lean on the aggregate data more heavily.

Respond with ONLY a JSON object, no other text, in this exact shape:
{"strategy": "authority" | "social_proof" | "consistency", "reasoning": "1 short sentence"}
`

type StrategyChoice = { strategy: MetaStrategy; reasoning: string | null }

function parseStrategyChoice(raw: string): StrategyChoice | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && META_STRATEGIES.includes(parsed.strategy)) {
      return {
        strategy: parsed.strategy as MetaStrategy,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : null,
      }
    }
  } catch {
    // fall through
  }
  const match = raw.match(/authority|social_proof|consistency/i)
  return match ? { strategy: match[0].toLowerCase() as MetaStrategy, reasoning: null } : null
}

export async function pickStrategyWithLLM(
  sessionId: string,
  round: number,
  history: HistoryRow[],
  persuaderModel?: string
): Promise<StrategyChoice> {
  const [historyText, scorecardText] = await Promise.all([
    Promise.resolve(summarizePlayerHistory(history)),
    scorecardSummary(round),
  ])

  try {
    const raw = await ollama.chat(
      [
        {
          role: 'system',
          content: 'You are the Strategy Selector component of a persuasive traffic advisor system.',
        },
        {
          role: 'user',
          content: `This player's history:\n${historyText}\n\nAggregate strategy performance this round (from the frozen scorecard):\n${scorecardText}\n\n${STRATEGY_SELECTOR_INSTRUCTION}`,
        },
      ],
      { json: true, model: persuaderModel }
    )
    const choice = parseStrategyChoice(raw)
    if (choice) return choice
    throw new Error(`LLM Strategy Selector returned unusable response: ${raw.slice(0, 200)}`)
  } catch (err) {
    // Resilience: fall back to the frozen-scorecard argmax (NOT the mock
    // recommendation helper — this call only picks a strategy string, it
    // never generates player-facing text, so there's nothing to "mock" in
    // the same sense as recommend.ts's fallback). Falling back to the
    // scorecard lookup keeps behavior sane and comparable rather than
    // defaulting to a fixed strategy.
    console.error('LLM Strategy Selector call failed, falling back to frozen scorecard:', err)
    const fallbackStrategy = await pickStrategyFromScorecard(sessionId, round)
    return { strategy: fallbackStrategy, reasoning: null }
  }
}
