'use client'
import { useEffect, useState } from 'react'

type Rec = {
  condition: 'baseline' | 'central'
  route?: 'A' | 'B' | 'C'
  explanation?: string
} | null

const ROUTE_STYLES: Record<string, string> = {
  A: 'border-blue-400 text-blue-300',
  B: 'border-purple-400 text-purple-300',
  C: 'border-orange-400 text-orange-300',
}

export function AgentRecommendation({
  sessionId,
  roomId,
  round,
  onConditionResolved,
}: {
  sessionId: string
  roomId: string
  round: number
  onConditionResolved?: (condition: string) => void
}) {
  const [rec, setRec] = useState<Rec>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    fetch(
      `/api/agent/recommend?sessionId=${sessionId}&roomId=${roomId}&round=${round}`
    )
      .then(r => r.json())
      .then(data => {
        setRec(data)
        if (data.condition) onConditionResolved?.(data.condition)
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [sessionId, roomId, round])

  // baseline condition — show nothing
  if (!loading && (!rec || rec.condition === 'baseline')) return null

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-700 p-3 mt-4 animate-pulse">
        <p className="text-xs text-gray-500">AI advisor thinking...</p>
      </div>
    )
  }

  if (error || !rec?.route) {
    return (
      <div className="rounded-lg border border-gray-700 p-3 mt-4">
        <p className="text-xs text-gray-500">AI advisor unavailable this round.</p>
      </div>
    )
  }

  return (
    <div
      className={`rounded-lg border p-3 mt-4 ${ROUTE_STYLES[rec.route]}`}
    >
      <p className="text-xs uppercase tracking-wide opacity-60 mb-1">
        AI advisor suggests
      </p>
      <p className="font-semibold text-white text-sm">
        Route {rec.route}
      </p>
      <p className="text-xs mt-1 opacity-80 leading-relaxed">
        {rec.explanation}
      </p>
    </div>
  )
}