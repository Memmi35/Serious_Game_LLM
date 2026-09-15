// Prompt Version 2 for the mid-dialogue commuter reply -- see
// lib/agent/prompts-v2.ts for the shared rationale. Kept in its own file
// (imported by decide-llm.mjs behind the PROMPT_VERSION toggle) rather than
// edited in place, so v1's buildPersuadeeReplyPrompt stays untouched and
// both are runnable side by side for comparison.
export function buildPersuadeeReplyPromptV2(persuaderMessage) {
  return `The traffic advisor just said: "${persuaderMessage}"

You haven't made your final decision yet. Respond naturally and in
character -- a real reply (3-5 sentences) that actually reasons through
your own situation: your trade-offs, what's at stake for you today, and a
specific reaction to what the advisor just said. Push back, ask a question,
state a preference, or show you're persuaded -- but explain WHY, don't just
repeat the advisor's numbers back at them or give a one-line verdict.

Respond with ONLY a JSON object, no other text: {"reply": "your 3-5 sentence response"}`;
}
