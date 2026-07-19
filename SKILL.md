---
name: santoor-player
description: A cross-device-synced music player PWA. Use this file to
  understand the project before making changes.
---

# Santoor — cross-device music player

## What this is
A buildless PWA that plays audio from pasted URLs, organizes them into one or
more named playlists (queues), and syncs playback position across every device
in real time via Supabase. It also supports "Listen together" (pairwise or
one-to-many host mode), where devices mirror another's playback live.

## Architecture
- Hosting: GitHub Pages (static files only, no server)
- Backend: Supabase (Postgres + Realtime), free tier
- No build step — plain HTML/CSS/JS ES modules, no framework, no bundler
- `app.js` is the entry module (`<script type="module">`) and imports the
  focused modules under `js/`. Shared mutable state lives in one object in
  `js/store.js` to avoid ES-module live-binding pitfalls for primitives.

## Files
| File | Purpose |
| --- | --- |
| `index.html` | Shell; loads Supabase CDN client, `supabase-config.js`, then `app.js` |
| `styles.css` | All styles; design tokens in `:root` (`--bg`, `--gold`, `--font-display`, …). Class prefix `cn-` is legacy/cosmetic |
| `app.js` | Entry module: `init()` — identity, Supabase, restore position, presence, audio wiring |
| `js/store.js` | Single shared `store` object, the `audio` element, `DEVICE_ID`, `DEFAULT_PLAYLIST_ID`, per-device volume/history/playlist prefs |
| `js/util.js` | `fmtTime`, `urlHost`, `guessTitle`, `escapeHtml`, `showError` |
| `js/identity.js` | Nickname load/save (`localStorage santoor:nickname`) |
| `js/supabase.js` | Client init + retry wrapper + `tracks`/`playlists` CRUD + per-playlist `player_state` sync + realtime subscriptions |
| `js/presence.js` | Realtime presence, `mirrorPeer`, follow/unfollow, host mode, ping/pong heartbeat |
| `js/player.js` | `loadTrack`, transport, shuffle/repeat, queue + playlist add/remove/switch, volume, history, audio wiring |
| `js/mediaSession.js` | OS lock-screen / media controls via the Media Session API |
| `js/waveform.js` | Real audio-signal waveform via Web Audio `AnalyserNode` (graceful fallback to decorative bars if CORS-tainted/unsupported) |
| `js/render.js` | `render()` (one `innerHTML` template) + `attachHandlers()` |
| `manifest.json`, `service-worker.js`, `icons/` | PWA install + offline shell |
| `supabase-config.js` | Public anon key + project URL (committed on purpose) |
| `supabase-setup.sql` | DB schema + RLS policies |

## Data model
- **`playlists`** — `id uuid`, `name text`, `created_at`. Multiple named
  queues. A fixed **Default** playlist id
  `00000000-0000-0000-0000-000000000001` always exists (pre-playlist data
  migrates onto it, and clients fall back to it). RLS: public
  select/insert/delete.
- **`tracks`** — `id uuid`, `url`, `title`, `host`,
  `duration_seconds numeric` (backfilled after metadata loads),
  `playlist_id uuid` FK → `playlists` (default = Default playlist, cascade
  delete), `created_at`. Queues are scoped per `playlist_id`.
  RLS: public select/insert/delete, plus a **narrow public UPDATE policy
  used ONLY to backfill `duration_seconds`** (RLS is row-level so it
  technically allows any column, but the app writes only that field). The
  UI still never edits tracks in place.
- **`player_state`** — **one row per playlist**, keyed by
  `playlist_id uuid` (was a single global `id=1` row before playlists):
  `current_track_id`, `position_seconds`, `is_playing`, `updated_by`,
  `updated_at`. Upserted continuously. RLS: public select/insert/update.

## Sync mechanisms (there are three, don't conflate them)
1. **Track list (`tracks` table)** — realtime via `postgres_changes`
   (INSERT/DELETE), filtered client-side to the active `playlist_id` so
   adds/removes propagate live. Requires Realtime enabled for `tracks`
   (and `playlists` for the live switcher) in Supabase.
2. **Playback position (`player_state` table)** — realtime via
   `postgres_changes` (UPDATE), matched to the active `playlist_id`;
   powers the cross-device "Resume here" banner. Requires Realtime enabled
   for `player_state`.
3. **Presence / listen-together** — realtime via Presence + broadcast on
   the `listeners-room` channel; ephemeral, never stored in Postgres. The
   leader/host broadcasts room-wide; followers mirror via `mirrorPeer`.
   Host mode is the same machinery: a host sets `hosting: true` in its
   presence payload so joiners get one "Join session" button; joining is
   just `startFollowing(hostId)`.

## Conventions to preserve
- `tracks` table: create/read/delete for user actions — do not add
  in-place track editing UI. The only UPDATE ever performed is the
  automatic `duration_seconds` backfill (see data model); keep it that
  way unless explicitly asked to add editing.
- No localStorage/sessionStorage inside any Claude-artifact-rendered
  version of this app if one is ever built in Claude — only in this
  standalone deployed version, where it's fine.
- Anon key in `supabase-config.js` is meant to be public; do not "fix"
  this by hiding it or moving it to an env var — GitHub Pages has no
  server-side runtime, so there's nowhere to hide it. Security is enforced
  via RLS policies in `supabase-setup.sql`, not key secrecy.
- Naming is `santoor` everywhere: DOM id `santoor-root`, `localStorage`
  keys `santoor:*` (`nickname`, `device-id`, `volume`, `history`,
  `playlist`), cache name `santoor-shell-vN`. `cn-` CSS prefix and JS
  variable names stay as-is (cosmetic only).
- Bump `CACHE_NAME` in `service-worker.js` on ANY shell-file change; the
  service worker pre-caches `SHELL_FILES` (which lists every `js/*.js`),
  so forgetting the bump serves old code.
- Listen-together guardrails: while `store.followingId` is set, the
  follower must NOT write `player_state` (would hijack the leader) and
  must NOT show the "Resume here" banner. The leader/host only broadcasts.
- Per-device (NOT synced) preferences: volume, shuffle/repeat mode,
  recently-played history, and the active playlist selection. Playback
  position/play-state/track ARE synced; local preferences are not.

## Known limitations
- **No user accounts yet** — playlists are public; anyone with the URL can
  see/edit/delete any playlist (no login). Supabase Auth + `auth.uid()`
  RLS is the planned next step (schema is already playlist-based to make
  that additive).
- **Cross-playlist listen-together** — mirroring a peer who is on a
  different playlist shows the "Waiting for a track to sync…" banner until
  that track exists in your active playlist (the follower is not auto-moved
  to the leader's playlist yet).
- **Real waveform needs CORS** — `js/waveform.js` uses an `AnalyserNode`,
  which reads all-zero samples from CORS-tainted cross-origin audio. When
  that happens (most pasted links) it silently falls back to the
  decorative bars.
- **CORS**: some hosts block cross-origin audio. Direct `.mp3`/`.m4a`
  links usually work; some streaming platforms refuse regardless.
- **Offline**: the shell opens offline, but audio playback and adding/
  removing tracks/playlists need a connection.
- **Lock screen**: the OS media widget (Media Session API) has a fixed
  Android layout — the app's in-app Now Playing screen is separate and
  does not appear on the real lock screen.

## How to test changes locally
- Serve over HTTP, never `file://` (breaks the service worker, ES modules,
  and Supabase calls): `python3 -m http.server 8000` in the repo root,
  then open `http://localhost:8000`.
- The Service Worker only registers on HTTPS or `localhost`.
- No build/compile/test step. Edit a file, then **hard-reload** (the SW
  serves the cached shell, so a normal reload can hide a fix). Bump
  `CACHE_NAME` after any shell change.
