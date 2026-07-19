---
name: santoor-player
description: A cross-device-synced music player PWA. Use this file to
  understand the project before making changes.
---

# Santoor — cross-device music player

## What this is
A buildless PWA that plays audio from pasted URLs, keeps a single shared
queue, and syncs playback position across every device in real time via
Supabase. It also supports "Listen together," where one device mirrors
another's playback live.

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
| `js/store.js` | Single shared `store` object, the `audio` element, `DEVICE_ID` |
| `js/util.js` | `fmtTime`, `urlHost`, `guessTitle`, `escapeHtml`, `showError` |
| `js/identity.js` | Nickname load/save (`localStorage santoor:nickname`) |
| `js/supabase.js` | Client init + `tracks` CRUD + `player_state` sync + realtime subscriptions |
| `js/presence.js` | Realtime presence, `mirrorPeer`, follow/unfollow, ping/pong heartbeat |
| `js/player.js` | `loadTrack`, transport controls, queue add/remove, audio event wiring |
| `js/mediaSession.js` | OS lock-screen / media controls via the Media Session API |
| `js/render.js` | `render()` (one `innerHTML` template) + `attachHandlers()` |
| `manifest.json`, `service-worker.js`, `icons/` | PWA install + offline shell |
| `supabase-config.js` | Public anon key + project URL (committed on purpose) |
| `supabase-setup.sql` | DB schema + RLS policies |

## Data model
- **`tracks`** — `id uuid`, `url text`, `title text`, `host text`,
  `created_at timestamptz`. Optional `duration_seconds numeric` may be
  present (persisted after metadata loads). One shared queue.
  RLS: public select/insert/delete. **No UPDATE policy by design.**
- **`player_state`** — single row (`id = 1`): `current_track_id`,
  `position_seconds`, `is_playing`, `updated_by`, `updated_at`. Upserted
  continuously. RLS: public select/update.

## Sync mechanisms (there are three, don't conflate them)
1. **Track list (`tracks` table)** — realtime via `postgres_changes`
   (INSERT/DELETE) so adds/removes propagate live. Requires Realtime
   enabled for `tracks` in Supabase (Database → Replication).
2. **Playback position (`player_state` table)** — realtime via
   `postgres_changes` (UPDATE on `id=1`); powers the cross-device
   "Resume here" banner. Requires Realtime enabled for `player_state`.
3. **Presence / listen-together** — realtime via Presence + broadcast on
   the `listeners-room` channel; ephemeral, never stored in Postgres.
   The leader broadcasts room-wide; followers mirror via `mirrorPeer`.

## Conventions to preserve
- `tracks` table: Create/Read/Delete only — do not add an Update policy or
  update UI for existing tracks unless explicitly asked; this was a
  deliberate product decision.
- No localStorage/sessionStorage inside any Claude-artifact-rendered
  version of this app if one is ever built in Claude — only in this
  standalone deployed version, where it's fine.
- Anon key in `supabase-config.js` is meant to be public; do not "fix"
  this by hiding it or moving it to an env var — GitHub Pages has no
  server-side runtime, so there's nowhere to hide it. Security is enforced
  via RLS policies in `supabase-setup.sql`, not key secrecy.
- Naming is `santoor` everywhere: DOM id `santoor-root`, `localStorage`
  keys `santoor:*`, cache name `santoor-shell-vN`. `cn-` CSS prefix and JS
  variable names stay as-is (cosmetic only).
- Bump `CACHE_NAME` in `service-worker.js` on ANY shell-file change; the
  service worker pre-caches `SHELL_FILES`, so a stale bump serves old code.
- Listen-together guardrails: while `store.followingId` is set, the
  follower must NOT write `player_state` (would hijack the leader) and
  must NOT show the "Resume here" banner. The leader only broadcasts.

## Known limitations
- **No user accounts yet** — single shared queue; anyone with the URL can
  edit it (no login). Supabase Auth would fix this later.
- **CORS**: some hosts block cross-origin audio. Direct `.mp3`/`.m4a`
  links usually work; some streaming platforms refuse regardless.
- **Offline**: the shell opens offline, but audio playback and adding/
  removing tracks need a connection.
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
