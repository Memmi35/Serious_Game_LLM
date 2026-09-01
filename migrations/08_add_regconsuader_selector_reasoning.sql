-- Experiment A (LLM-based Strategy Selector, lib/agent/regconsuader/llm-selector.ts):
-- when REGCONSUADER_SELECTOR=llm is active, the selector's one-sentence
-- justification for its strategy choice is stored here alongside the
-- strategy itself, so a later pass can inspect *why* it picked what it
-- picked per (player, round) rather than only seeing the final choice.
-- NULL whenever the frozen-scorecard selector (the default) was used
-- instead, since that path has no reasoning to record.
alter table public.agent_recommendations add column if not exists regconsuader_selector_reasoning text;
