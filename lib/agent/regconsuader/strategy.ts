// Room 1 strategy assignment: deterministic pseudo-random rotation across
// META_STRATEGIES, keyed on (sessionId, round) so a re-run of the same room
// reproduces the same assignment. No knowledge base yet — this file is only
// used until a frozen scorecard exists (see project roadmap memory for the
// warm-up-then-freeze plan), at which point Room 2 replaces this with a
// scorecard lookup instead of rotation.
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
