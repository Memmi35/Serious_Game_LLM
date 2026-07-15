-- Lets each room pin its own PersuLLM model instead of relying on a
-- server-wide OLLAMA_MODEL env var. Existing rows get NULL, which the
-- advisor code treats as "fall back to OLLAMA_MODEL" — fully backward
-- compatible, no behavior change for rooms created before this migration.
alter table public.game_rooms add column if not exists persuader_model text;
