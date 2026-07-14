-- Run this in Supabase: Project → SQL Editor → New query → paste → Run

-- Table 1: the URL list. Create + Read + Delete only — no update column
-- or policy is provided on purpose, matching "no update" requirement.
create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text,
  host text,
  created_at timestamptz not null default now()
);

-- Table 2: current playback position, one shared row. This one DOES get
-- upserted continuously — it's live "now playing" state, not part of the
-- URL list, so it's intentionally a separate table with different rules.
create table if not exists player_state (
  id int primary key default 1,
  current_track_id uuid references tracks(id) on delete set null,
  position_seconds numeric not null default 0,
  is_playing boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);
insert into player_state (id) values (1) on conflict (id) do nothing;

-- Row Level Security: enabled, with permissive policies since this app
-- has no login system yet — anyone with your anon key can read/write.
-- Fine for a personal project only you use; if you ever add real user
-- accounts, tighten these to check auth.uid().
alter table tracks enable row level security;
alter table player_state enable row level security;

create policy "public read tracks" on tracks for select using (true);
create policy "public insert tracks" on tracks for insert with check (true);
create policy "public delete tracks" on tracks for delete using (true);
-- No update policy on tracks — update requests will be rejected by RLS.

create policy "public read player_state" on player_state for select using (true);
create policy "public update player_state" on player_state for update using (true);

-- Realtime: after running this, also go to
-- Database → Replication → and enable realtime for the player_state table
-- (this is what lets other devices see playback updates live).
