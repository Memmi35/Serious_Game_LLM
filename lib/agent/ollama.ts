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

// Some models wrap valid JSON in a markdown code fence even with
// format:'json' requested (e.g. `I'd suggest A. \`\`\`json\n{...}\n\`\`\``).
// JSON.parse() fails on the fence markers, which sends callers down the
// regex fallback path — and that fallback keeps the raw text (fences and
// all) as the "explanation", visibly polluting persuasion pitches. Extract
// just the fenced payload when present so the normal JSON.parse succeeds.
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : text
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
    const content = stripThink(data.message?.content ?? '')
    // Only unwrap a code fence for JSON-shaped calls — a conversational
    // reply (format:'json' not requested) is never supposed to be fenced,
    // so leave it untouched rather than risk mangling real prose that
    // happens to contain a ``` snippet.
    return opts.json ? stripCodeFence(content) : content
  } finally {
    clearTimeout(timeout)
  }
}

export const ollama = { chat }
