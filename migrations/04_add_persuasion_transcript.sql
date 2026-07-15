-- The multi-turn PersuLLM persuasion dialogue (opening pitch -> agent reply
-- -> advisor rebuttal) was only ever held in memory during
-- run-population.mjs and discarded once the round's final choice was
-- decided — only the opening pitch (agent_recommendations.explanation) and
-- the one-line final reason (round_logs.choice_reason) survived. This
-- column lets the full transcript be persisted so persuasion technique/
-- quality can actually be reviewed after the fact, not just the outcome.
alter table public.round_logs add column if not exists persuasion_transcript jsonb;
