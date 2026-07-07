const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1'
const TIMEOUT_MS = 30_000

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function chat(messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        ...(opts.json ? { format: 'json' } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`)
    }

    const data = await res.json()
    return data.message?.content ?? ''
  } finally {
    clearTimeout(timeout)
  }
}

export const ollama = { chat }
