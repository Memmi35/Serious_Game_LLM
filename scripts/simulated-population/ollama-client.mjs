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
// Mirrors lib/agent/ollama.ts's NUM_CTX — see that file for why an
// unrequested context window (defaulting to each model's max, e.g. 131072
// for deepseek-r1:32b) makes the advisor and population models evict each
// other from GPU memory on every alternating call instead of coexisting.
const NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || "8192", 10);

export const USE_MOCK = process.env.AGENT_MODE !== "ollama";

// Mirrors lib/agent/ollama.ts's stripThink() — see that file for why. This
// client currently only ever talks to the population model, which isn't a
// reasoning model today, but keeping this here too means swapping in a
// reasoning model for the population later doesn't silently reintroduce
// the same parsing bug.
function stripThink(text) {
  if (!text) return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

// Mirrors lib/agent/ollama.ts's stripCodeFence() — see that file for why.
function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text;
}

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
        options: { num_ctx: NUM_CTX },
        ...(opts.json ? { format: "json" } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const content = stripThink(data.message?.content ?? "");
    return opts.json ? stripCodeFence(content) : content;
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
