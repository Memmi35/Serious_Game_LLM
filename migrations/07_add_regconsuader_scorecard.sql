-- RegConSuader's frozen strategy scorecard (see project roadmap memory:
-- warm-up-then-freeze plan). Built from 3 clean Room 1 runs (Q4BX, O3WG,
-- L1LI — 450 decisions total, post live-crowding-fix) using compliance as
-- the success signal, keyed on (round, strategy) since round <-> scenario
-- is a fixed 1:1 mapping in this game. This table is written once by a
-- one-off seed and is NOT updated live during Room 2 runs — see the
-- Configurator lookup in lib/agent/regconsuader/strategy.ts for why online
-- updates during evaluation would undermine the whole point of freezing it.
create table if not exists public.regconsuader_strategy_stats (
  round integer not null,
  strategy text not null,
  attempts integer not null default 0,
  successes integer not null default 0,
  primary key (round, strategy)
);
