-- Drop existing constraints if necessary or create game_rooms table
create table if not exists public.game_rooms (
  id text primary key,
  status text not null default 'waiting', -- 'waiting', 'playing', 'completed'
  current_round int not null default 1,
  total_rounds int not null default 5,
  created_at timestamptz not null default now()
);

alter table public.game_rooms enable row level security;
create policy "dev_all_game_rooms" on public.game_rooms for all using (true) with check (true);

-- We can add room_id to simulation_sessions
alter table public.simulation_sessions add column if not exists room_id text references public.game_rooms(id) on delete cascade;

-- We can add room_id to traffic_edges 
alter table public.traffic_edges add column if not exists room_id text references public.game_rooms(id) on delete cascade;

-- To prevent primary key collisions on traffic_edges (since id was just edge name like '0-0_1-0'),
-- we need to drop the primary key and create a composite one, or just store the room_id.
-- Since it might be hard to safely alter primary key if constraint name varies, a safer way is to just use unique ID for edges like `roomID_edgeID` as the primary `id`, which requires no schema change for traffic_edges.
-- However, adding room_id makes querying easier.

-- Add missing user_name column for sessions
alter table public.simulation_sessions add column if not exists user_name text;

-- Inform postgrest to reload the schema cache
NOTIFY pgrst, 'reload schema';
