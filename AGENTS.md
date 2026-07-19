# AGENTS.md

## What this is
Static, buildless PWA music player. No `package.json`, no bundler, no npm scripts, no tests, no lint/typecheck. Just plain HTML/CSS/JS served as files. Don't look for a build system — there isn't one.

- `index.html` loads `supabase-config.js` then `app.js`; the Supabase JS client comes from a CDN `<script>` (not installed locally).
- `app.js` is one big IIFE that renders the whole UI via `root.innerHTML` into `#santoor-root`. There is no framework and no component system.
- Backend is Supabase (Postgres + Realtime), called directly from the browser with the anon key. `supabase-setup.sql` is the schema; run it manually in the Supabase SQL Editor.

## Running / verifying
- Serve over HTTP (e.g. VS Code Live Server), not `file://` — the service worker and Supabase calls need a real origin.
- No automated checks exist. Verify changes by loading the served page in a browser and watching the console.
- Deploy = push files to the **root** of the GitHub Pages branch (`main`, `/`). `.nojekyll` must stay present.

## Non-obvious gotchas
- **Service worker caching:** `service-worker.js` caches the app shell under a versioned `CACHE_NAME` (`santoor-shell-vN`). When you change any shell file (see `SHELL_FILES`, which lists every `js/*.js`, `index.html`, `styles.css`, `manifest.json`, `supabase-config.js`), bump the version number or clients keep serving stale files.
- **Naming must stay consistent** — the project was renamed Continuum → Santoor. Anything new should use `santoor`: DOM id `santoor-root`, `localStorage` keys `santoor:*`, cache name `santoor-shell-vN`.
- **`tracks` table:** create/read/delete for user actions; the ONLY update the app performs is the automatic `duration_seconds` backfill (a narrow public UPDATE policy exists just for that). Don't add in-place track editing.
- **Playlists:** the queue is scoped per `playlist_id`; `player_state` is one row per playlist (keyed by `playlist_id`, not the old global `id=1`). A fixed Default playlist id `00000000-0000-0000-0000-000000000001` always exists and is the fallback. Re-run `supabase-setup.sql` (idempotent) after pulling schema changes.
- **Realtime must be enabled manually** in the Supabase dashboard (Database → Replication) for `player_state`, `tracks`, AND `playlists`; the SQL alone doesn't turn it on.
- **Per-device (not synced) state:** volume, shuffle/repeat, recently-played history, and active-playlist selection live in `localStorage` and are intentionally NOT broadcast. Only track/position/play-state sync.

## Secrets
- `supabase-config.js` holds the **anon** key and IS committed — that's intentional and safe (protected by RLS).
- `.env` holds the real DB password and is gitignored. Never commit it or echo its contents into other files.
