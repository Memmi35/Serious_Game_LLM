const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
const MODEL = process.env.OLLAMA_MODEL || 'llama3.1'
// Ollama defaults to each model's max supported context window when none is
// requested (e.g. deepseek-r1:32b defaults to 131072, ballooning its VRAM
// footprint to ~54GB purely from KV cache overhead we never use — our
// context blocks are a few hundred to low thousands of tokens). Capping
// this is what lets the advisor and population models coexist in GPU
// memory instead of evicting each other on every alternating call.
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '8192', 10)
// Generous headroom for a busy/shared GPU or a cold model load (Ollama has
// to load the model into memory on its first call, or after switching
// OLLAMA_MODEL to a different advisor model between experiment runs).
const TIMEOUT_MS = 90_000

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

// Reasoning models (deepseek-r1 etc.) prefix their answer with a <think>...</think>
// block. Downstream code JSON.parse()s this content directly, so an unstripped
// think block either breaks parsing or lets a stray route letter inside the
// reasoning get regex-matched instead of the model's actual answer.
function stripThink(text: string): string {
  if (!text) return text
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '') // unclosed block (ran out of tokens mid-thought)
    .trim()
}

async function chat(messages: ChatMessage[], opts: { json?: boolean; model?: string } = {}): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || MODEL,
        messages,
        stream: false,
        options: { num_ctx: NUM_CTX },
        ...(opts.json ? { format: 'json' } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`)
    }

    const data = await res.json()
    return stripThink(data.message?.content ?? '')
  } finally {
    clearTimeout(timeout)
  }
}

export const ollama = { chat }
