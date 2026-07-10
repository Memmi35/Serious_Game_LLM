-- Records which persona/config drove a given simulation_sessions row, for
-- the 30-agent simulated-population runs (Step 1 of the persuasion roadmap).
-- trust_in_advice is stored but unused while there's no advisor (baseline
-- condition) — kept so the same persona record works unchanged once
-- PersuLLM-1 exists.
create table if not exists public.simulation_agents (
  session_id uuid primary key references public.simulation_sessions(id) on delete cascade,
  room_id text references public.game_rooms(id) on delete cascade,
  agent_index int not null,
  persona_label text not null,
  llm_backend text not null default 'rule-based-v1',
  risk_aversion numeric not null,
  delay_sensitivity numeric not null,
  trust_in_advice numeric not null,
  decision_latency_mean numeric not null,
  decision_latency_sigma numeric not null,
  route_stickiness numeric not null,
  softmax_temperature numeric not null,
  commute_habit text,
  created_at timestamptz not null default now()
);

alter table public.simulation_agents enable row level security;
create policy "dev_all_simulation_agents" on public.simulation_agents for all using (true) with check (true);

NOTIFY pgrst, 'reload schema';
