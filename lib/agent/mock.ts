export function getMockRecommendation(
  sessionId: string,
  round: number,
  condition: string
): { route: 'A' | 'B' | 'C'; explanation: string } {
  const routes = ['A', 'B', 'C'] as const
  const route = routes[(sessionId.charCodeAt(0) + round) % 3]

  const explanation =
    condition === 'central'
      ? `I am the CENTRAL agent. I can see all players in the room. For round ${round}, I suggest Route ${route}.`
      : condition === 'personal'
      ? `I am your PERSONAL agent. I can see only your history. For round ${round}, I suggest Route ${route}.`
      : `No AI condition active.`

  return { route, explanation }
}