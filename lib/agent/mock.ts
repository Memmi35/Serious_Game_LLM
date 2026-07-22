export function getMockRecommendation(
  sessionId: string,
  round: number,
  condition: string
): { route: 'A' | 'B' | 'C'; explanation: string } {
  const routes = ['A', 'B', 'C'] as const
  const route = routes[(sessionId.charCodeAt(0) + round) % 3]

  const explanation =
    condition === 'personal'
      ? `I am your PERSONAL agent. I can see only your history. For round ${round}, I suggest Route ${route}.`
      : condition === 'baseline'
      ? `No AI condition active.`
      : `I'm PersuLLM. For round ${round}, Route ${route} is the one that gets us closer to the optimal split — I really think you should take it. (mock mode)`

  return { route, explanation }
}