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
const TIMEOUT_MS = 30_000;

export const USE_MOCK = process.env.AGENT_MODE !== "ollama";

export async function chat(messages, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
