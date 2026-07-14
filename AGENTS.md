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
- **Service worker caching:** `service-worker.js` caches the app shell under a versioned `CACHE_NAME` (`santoor-shell-vN`). When you change `index.html`, `app.js`, `styles.css`, `manifest.json`, or `supabase-config.js`, bump the version number or clients keep serving stale files.
- **Naming must stay consistent** — the project was renamed Continuum → Santoor. Anything new should use `santoor`: DOM id `santoor-root`, `localStorage` keys `santoor:*`, cache name `santoor-shell-vN`. `.vscode/settings.json` has "Santoor" as a cSpell word.
- **`tracks` table has no UPDATE policy on purpose** (create/read/delete only). Don't add update logic without also adding an RLS policy in `supabase-setup.sql`.
- **Realtime for `player_state` must be enabled manually** in the Supabase dashboard (Database → Replication); the SQL alone doesn't turn it on.

## Secrets
- `supabase-config.js` holds the **anon** key and IS committed — that's intentional and safe (protected by RLS).
- `.env` holds the real DB password and is gitignored. Never commit it or echo its contents into other files.
