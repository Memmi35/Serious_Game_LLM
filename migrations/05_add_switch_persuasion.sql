-- The switch/reflection phase previously had no advisor involvement at all
-- (agents saw raw distribution + optimal-split numbers, unmediated, and
-- decided independently — see run-population.mjs commit history). Extending
-- the persuader into this phase too needs its own reason/transcript columns
-- rather than reusing choice_reason/persuasion_transcript, which already
-- store the *initial* choice's data and would otherwise be overwritten.
alter table public.round_logs add column if not exists switch_reason text;
alter table public.round_logs add column if not exists switch_transcript jsonb;
