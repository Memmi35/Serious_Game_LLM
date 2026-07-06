'use client'
import { useState, useRef, useEffect } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

export function AgentChat({
  sessionId,
  roomId,
  round,
  condition,
}: {
  sessionId: string
  roomId: string
  round: number
  condition: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // don't show chat in baseline condition
  if (condition === 'baseline') return null

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMessage: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          roomId,
          round,
          message: text,
          history: [...messages, userMessage],
        }),
      })
      const data = await res.json()
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.reply },
      ])
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ])
    }

    setLoading(false)
  }

  return (
    <div className="rounded-lg border border-border mt-4 flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2">
        <span className="text-sm font-medium">
          {condition === 'central' ? '🟡 Central AI Advisor' : '🟢 Personal AI Advisor'}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          Ask me anything about the routes
        </span>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-3 p-4 h-48 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-6">
            No messages yet — ask the advisor something!
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Ask about the routes..."
          className="text-sm"
          disabled={loading}
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}