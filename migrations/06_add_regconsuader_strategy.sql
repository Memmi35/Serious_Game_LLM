-- RegConSuader Room 1 (see project roadmap memory): each pitch is assigned
-- one of a small set of meta-strategies (authority / social_proof /
-- consistency), rotated deterministically per (session, round) since there
-- is no knowledge base yet. This column records which strategy was used for
-- a given pitch, so a later pass can tally success rates per
-- (scenario_type, meta_strategy) and build/freeze the KB scorecard —
-- without this, there would be no way to attribute a round's outcome back
-- to the strategy that produced it.
alter table public.agent_recommendations add column if not exists regconsuader_strategy text;
