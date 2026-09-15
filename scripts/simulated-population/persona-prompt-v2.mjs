// Prompt Version 2 for the simulated-commuter persona -- see
// lib/agent/prompts-v2.ts for the shared rationale (ELM-grounded richness).
// Only adds one paragraph on top of the v1 personaSystemPrompt(): everything
// else (trait phrasing, bounds) is reused unchanged via the same
// traitPhrase()/BOUNDS logic, imported rather than duplicated.
import { personaSystemPrompt } from "./persona-prompt.mjs";

const RICHNESS_PARAGRAPH = `

When you respond -- in conversation or in your reasoning -- actually reason
through your own situation out loud: your time pressure today, your trust
level toward the advisor, what happened to you last round if anything. A
one-line reaction isn't enough; react the way a real person with your
specific stakes and personality actually would.`;

// Inserted before the final "You will be shown..." paragraph so the
// richness instruction reads as part of the persona's own voice, not a
// bolted-on afterthought at the very end.
export function personaSystemPromptV2(persona) {
  const base = personaSystemPrompt(persona);
  const marker = "\n\nYou will be shown 3 candidate routes";
  const idx = base.indexOf(marker);
  if (idx === -1) return base + RICHNESS_PARAGRAPH;
  return base.slice(0, idx) + RICHNESS_PARAGRAPH + base.slice(idx);
}

export { ROUTE_CHOICE_INSTRUCTION } from "./persona-prompt.mjs";
