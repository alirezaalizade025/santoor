---
name: "santoor-dev"
description: "Fast, low-token workflow for developing the Santoor static PWA (index.html/app.js/styles.css + Supabase). Use when editing the app, fixing bugs, or adding features."
keywords: ["santoor", "pwa", "static", "supabase", "develop", "fast", "cheap"]
---

# Santoor Dev — Fast & Cheap

Buildless static PWA. The whole point of this skill is to stop wasting tokens on
tooling that doesn't exist and on re-reading files you already understand.

## Before you do anything
- This repo has **no package.json, no build, no tests, no lint**. Do NOT:
  - search for npm/yarn/pnpm, bundlers, tsconfig, jest, eslint.
  - run `npm install`, `npm run dev/build/test`, or any package command.
  - web-search for framework docs — everything you need is in the repo.
- If you must confirm something, `grep`/`glob` first; only `read` the exact slice.
  `app.js` is ~470 lines of one IIFE — read the function you touch, not the file.

## Dev loop (cheapest verification)
- Serve over HTTP only — `file://` breaks the service worker and Supabase calls:
  `python3 -m http.server 8000` in the repo root (background it with the bash tool).
- Edit a file, hard-reload the browser. No compile step. Done.

## Rules that prevent wasted debugging cycles
- **Bump `CACHE_NAME` in `service-worker.js`** (e.g. `santoor-shell-v2` → `v3`)
  every time you change `index.html`, `app.js`, `styles.css`, `manifest.json`, or
  `supabase-config.js`. Forgetting this = confusing "stale" bugs that cost hours.
- **Naming is `santoor` everywhere** (DOM id `santoor-root`, `localStorage`
  keys `santoor:*`, cache name `santoor-shell-vN`). Keep it consistent.
- **No UPDATE on the `tracks` table by design** (create/read/delete only). Don't
  add update logic unless you also add an RLS policy in `supabase-setup.sql`.
- **Realtime for `player_state` is enabled manually** in Supabase
  (Database → Replication). The SQL alone won't turn it on.
- `supabase-config.js` anon key is committed on purpose (RLS-protected). `.env`
  holds the real DB password and is gitignored — never echo or commit it.

## Editing surface
- UI is rendered by one `root.innerHTML = \`...\`` template in `app.js:184`.
  Edit that template string and its handlers; there are no components.
- Supabase client is the CDN `<script>` (already in `index.html:20`); call
  `window.supabase` directly. Schema truth = `supabase-setup.sql`.
- Deploy = push files to the **root** of the `main` branch (GitHub Pages).
  `.nojekyll` must stay.
