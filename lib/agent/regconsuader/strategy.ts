// Room 1 strategy assignment: deterministic pseudo-random rotation across
// META_STRATEGIES, keyed on (sessionId, round) so a re-run of the same room
// reproduces the same assignment. Kept (not deleted) for any future
// warm-up round that needs to add more training data to the scorecard —
// but Room 2 onward uses pickStrategyFromScorecard() below instead.
import db from '@/lib/db'
import { META_STRATEGIES, type MetaStrategy } from './prompts'

// Same string-hash approach as lib/scenarios.ts's seededRandom — deterministic
// given the same seed string, so assignment is reproducible without needing
// to persist it separately.
function seededIndex(seed: string, modulus: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0
  }
  return (h >>> 0) % modulus
}

export function assignStrategy(sessionId: string, round: number): MetaStrategy {
  const idx = seededIndex(`${sessionId}:${round}`, META_STRATEGIES.length)
  return META_STRATEGIES[idx]
}

// Room 2 onward: look up the frozen scorecard (regconsuader_strategy_stats,
// seeded once from 3 clean Room 1 runs — see migrations/07_add_regconsuader_scorecard.sql)
// and pick whichever strategy has the highest success rate for this round.
// Deliberately NOT updated here — freezing means this table stays fixed for
// the whole of Room 2's run, so results are comparable across every
// decision instead of drifting as the room progresses (see project roadmap
// memory: warm-up-then-freeze, not online learning during evaluation).
// Falls back to the same deterministic rotation if a round has no seeded
// data yet (e.g. a 6th round was added later without re-running warm-up).
export async function pickStrategyFromScorecard(sessionId: string, round: number): Promise<MetaStrategy> {
  const rows = await db.query(
    `SELECT strategy, attempts, successes FROM regconsuader_strategy_stats WHERE round = $1`,
    [round]
  )
  if (rows.rows.length === 0) {
    return assignStrategy(sessionId, round)
  }
  let best: MetaStrategy = assignStrategy(sessionId, round)
  let bestRate = -1
  for (const row of rows.rows) {
    const rate = row.attempts > 0 ? row.successes / row.attempts : 0
    if (rate > bestRate) {
      bestRate = rate
      best = row.strategy as MetaStrategy
    }
  }
  return best
}
