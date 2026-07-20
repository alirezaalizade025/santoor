-- Run this in Supabase: Project → SQL Editor → New query → paste → Run
-- Safe to re-run: uses IF NOT EXISTS / conditional guards throughout.

-- ---------------------------------------------------------------------------
-- Playlists: multiple named queues instead of one shared list.
-- (Still public / no login yet — accounts can layer on later via auth.uid().)
-- A fixed "Default" playlist with a well-known id lets pre-playlist tracks and
-- the pre-playlist single player_state row migrate cleanly.
-- ---------------------------------------------------------------------------
create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Well-known Default playlist id (kept stable so clients can fall back to it).
insert into playlists (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Default')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Table: the URL list. Create + Read + Delete for user actions. The only
-- UPDATE performed by the app is the automatic duration_seconds backfill.
-- ---------------------------------------------------------------------------
create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text,
  host text,
  duration_seconds numeric,
  playlist_id uuid references playlists(id) on delete cascade
    default '00000000-0000-0000-0000-000000000001',
  created_at timestamptz not null default now()
);

-- Migrate an older schema: add missing columns and backfill playlist_id.
alter table tracks add column if not exists duration_seconds numeric;
alter table tracks add column if not exists playlist_id uuid
  references playlists(id) on delete cascade
  default '00000000-0000-0000-0000-000000000001';
update tracks set playlist_id = '00000000-0000-0000-0000-000000000001'
  where playlist_id is null;
create index if not exists tracks_playlist_id_idx on tracks (playlist_id);

-- ---------------------------------------------------------------------------
-- Playback position — now ONE ROW PER PLAYLIST (keyed by playlist_id) instead
-- of a single global row. Continuously upserted; live "now playing" state.
-- ---------------------------------------------------------------------------
create table if not exists player_state (
  playlist_id uuid primary key references playlists(id) on delete cascade,
  current_track_id uuid references tracks(id) on delete set null,
  position_seconds numeric not null default 0,
  is_playing boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Migration from the old single-row player_state (integer id=1):
-- if the legacy `id` column still exists, copy its row into the Default
-- playlist's row, then drop the legacy column/constraint.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'player_state' and column_name = 'id'
  ) then
    alter table player_state add column if not exists playlist_id uuid;
    update player_state
      set playlist_id = '00000000-0000-0000-0000-000000000001'
      where id = 1 and playlist_id is null;
    delete from player_state where playlist_id is null;
    alter table player_state drop constraint if exists single_row;
    alter table player_state drop constraint if exists player_state_pkey;
    alter table player_state drop column id;
    alter table player_state add primary key (playlist_id);
  end if;
end $$;

-- Ensure the Default playlist always has a player_state row.
insert into player_state (playlist_id)
values ('00000000-0000-0000-0000-000000000001')
on conflict (playlist_id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security: permissive (no login yet). Tighten to auth.uid() when
-- accounts are added.
-- ---------------------------------------------------------------------------
alter table playlists enable row level security;
alter table tracks enable row level security;
alter table player_state enable row level security;

drop policy if exists "public read playlists" on playlists;
drop policy if exists "public insert playlists" on playlists;
drop policy if exists "public delete playlists" on playlists;
create policy "public read playlists" on playlists for select using (true);
create policy "public insert playlists" on playlists for insert with check (true);
create policy "public delete playlists" on playlists for delete using (true);

drop policy if exists "public read tracks" on tracks;
drop policy if exists "public insert tracks" on tracks;
drop policy if exists "public delete tracks" on tracks;
drop policy if exists "public update track duration" on tracks;
create policy "public read tracks" on tracks for select using (true);
create policy "public insert tracks" on tracks for insert with check (true);
create policy "public delete tracks" on tracks for delete using (true);
-- Narrow UPDATE policy: added ONLY so a device can backfill duration_seconds
-- once metadata loads. RLS is row-level, not column-level, so this technically
-- permits any column update; the app writes only duration_seconds here. The
-- product rule "tracks are create/read/delete, not editable in place" still
-- holds in the UI — this is a metadata backfill, not user-facing editing.
create policy "public update track duration" on tracks for update using (true) with check (true);

drop policy if exists "public read player_state" on player_state;
drop policy if exists "public update player_state" on player_state;
drop policy if exists "public insert player_state" on player_state;
create policy "public read player_state" on player_state for select using (true);
create policy "public update player_state" on player_state for update using (true);
create policy "public insert player_state" on player_state for insert with check (true);

-- ---------------------------------------------------------------------------
-- Castbox channels: user-selected podcast channels surfaced in the Castbox tab.
-- Mirrors the permissive (no-login-yet) policy used by playlists. The episode
-- audio itself is stored as ordinary `tracks` rows (RSS enclosure URLs), so no
-- separate episodes table is needed.
-- ---------------------------------------------------------------------------
create table if not exists castbox_channels (
  id uuid primary key default gen_random_uuid(),
  castbox_id text,
  title text not null,
  author text,
  rss_url text not null,
  artwork_url text,
  description text,
  created_at timestamptz not null default now()
);

alter table castbox_channels enable row level security;

drop policy if exists "public read castbox_channels" on castbox_channels;
drop policy if exists "public insert castbox_channels" on castbox_channels;
drop policy if exists "public delete castbox_channels" on castbox_channels;
create policy "public read castbox_channels" on castbox_channels for select using (true);
create policy "public insert castbox_channels" on castbox_channels for insert with check (true);
create policy "public delete castbox_channels" on castbox_channels for delete using (true);

-- ---------------------------------------------------------------------------
-- Realtime: after running this, go to Database → Replication and enable
-- realtime for `tracks`, `player_state`, `playlists`, AND `castbox_channels`:
--   • tracks          → live queue adds/removes (also lets "Listen together"
--                       find a just-added track).
--   • player_state    → live playback position ("Resume here" banner).
--   • playlists       → live playlist create/delete across devices.
--   • castbox_channels → live channel add/remove in the Castbox tab.
-- ---------------------------------------------------------------------------
