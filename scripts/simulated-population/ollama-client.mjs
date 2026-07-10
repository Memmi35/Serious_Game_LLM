// Standalone Ollama client for simulated-population scripts. Mirrors
// lib/agent/ollama.ts's calling convention (same base URL env var, same
// endpoint shape) since scripts/ runs outside Next.js and can't import that
// .ts file directly. Keep the two in sync if the chat API usage changes.
//
// Reuses the same AGENT_MODE=ollama toggle as lib/agent/recommend.ts: unset
// (or anything else) means mock mode, so this runs with no server locally.
//
// Model is intentionally a SEPARATE env var from lib/agent/ollama.ts's
// OLLAMA_MODEL. The 30 agents are the fixed population — their model stays
// constant across experiments. OLLAMA_MODEL is the PersuLLM advisor's model,
// the thing that actually gets varied (qwen vs deepseek vs llama, etc.)
// between test runs. Sharing one env var would make it impossible to run
// "population on qwen, advisor on deepseek" at the same time.

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = process.env.AGENT_POPULATION_MODEL || "qwen2.5:3b";
// Steady-state calls are usually a couple seconds. This is generous headroom
// for a busy/shared GPU, not the expected normal case — see warmUp() below,
// which is what actually protects against slow cold-start model loads.
const TIMEOUT_MS = 90_000;

export const USE_MOCK = process.env.AGENT_MODE !== "ollama";

async function chatRaw(messages, opts, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function chat(messages, opts = {}) {
  return chatRaw(messages, opts, TIMEOUT_MS);
}

// Forces Ollama to load MODEL into GPU memory before the real experiment
// starts, so agent 1's first decision isn't the one that eats the cold-load
// latency (which can exceed even a generous per-call timeout on a shared/
// busy GPU). Uses a long timeout since this is the one call expected to be
// slow; every call after this should be fast because Ollama keeps the model
// loaded for OLLAMA_KEEP_ALIVE (default 5m).
export async function warmUp() {
  const start = Date.now();
  await chatRaw([{ role: "user", content: "Reply with just: ok" }], {}, 180_000);
  return Date.now() - start;
}
