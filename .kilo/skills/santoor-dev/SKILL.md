---
name: "santoor-dev"
description: "Fast, low-token workflow for developing the Santoor static PWA (buildless ES modules + Supabase). Use when editing the app, fixing bugs, or adding features."
keywords: ["santoor", "pwa", "static", "supabase", "esm", "presence", "develop", "fast", "cheap"]
---

# Santoor Dev — Fast & Cheap

Buildless static PWA. Native ES modules (no bundler, no npm, no tests). The goal of
this skill is to skip tooling that doesn't exist and avoid re-reading code you already
understand. See `AGENTS.md` for the full project rundown; this is the high-leverage subset.

## When to use
- Editing the player UI, playback logic, or the "Listen together" presence feature.
- Fixing bugs or adding features in `index.html`, `styles.css`, `js/*`, or `supabase-*`.

## Architecture (module map)
`app.js` is the **entry module** (loaded as `<script type="module">`). It imports the
rest and runs `init()`. Everything shared lives in one place to dodge ES-module
live-binding pitfalls for primitives:

- `js/store.js` — the single `store` object (all mutable state: queue, currentIndex,
  isPlaying, followingId, onlineUsers, loop, …), the `audio` element, `DEVICE_ID`.
  **Add new cross-module state here**; never create module-level mutable primitives
  that other modules read/write (use `store.x`).
- `js/util.js` — `fmtTime`, `urlHost`, `guessTitle`, `escapeHtml`, `showError`.
- `js/identity.js` — `loadNickname` / `saveNickname` (localStorage `santoor:nickname`).
- `js/supabase.js` — client init + `tracks` CRUD + `player_state` sync.
- `js/presence.js` — Realtime presence, `mirrorPeer`, follow/unfollow, heartbeat.
- `js/player.js` — `loadTrack`, transport controls, queue add/remove, audio wiring.
- `js/render.js` — `render()` (the `root.innerHTML` template) + `attachHandlers()`.

Circular imports (`render ↔ player ↔ presence`) are fine because cross-module calls
only happen at runtime (inside handlers), never at module top level.

## Dev loop (cheapest verification)
- Serve over HTTP — `file://` breaks the service worker, ES modules, and Supabase calls:
  `python3 -m http.server 8000` in the repo root (background it with the bash tool).
- Edit a file, hard-reload the browser. No build/compile step. Done.

## Hard rules (prevent wasted debugging cycles)
- **Bump `CACHE_NAME` in `service-worker.js`** (`santoor-shell-vN`) on ANY change to
  `index.html`, `app.js`, any `js/*.js`, `styles.css`, `manifest.json`, or
  `supabase-config.js`. It pre-caches `SHELL_FILES` (which lists every `js/*.js`);
  forgetting the bump = stale shell served from cache.
- **Naming is `santoor` everywhere** — DOM id `santoor-root`, `localStorage` keys
  `santoor:*`, cache name `santoor-shell-vN`. Keep it consistent.
- **`tracks` table has NO UPDATE policy by design** (create/read/delete only). Don't
  add update logic without also adding an RLS policy in `supabase-setup.sql`.
- **Realtime for `player_state` is enabled manually** in Supabase
  (Database → Replication). The SQL alone doesn't turn it on.
- **`supabase-config.js` anon key is committed on purpose** (RLS-protected). `.env`
  holds the real DB password and is gitignored — never echo or commit it.
- **Listen-together guardrails** (in `js/player.js` / `js/presence.js`): while
  `store.followingId` is set, the follower must NOT call `persistPosition` (don't write
  the shared `player_state` row — it hijacks the leader) and must NOT show the
  `pendingRemote` banner. The leader only broadcasts; it never reads followers' playback.
- **Mobile autoplay unlock** (`js/player.js` `unlockAudioOnGesture`): a programmatic
  `audio.play()` fired from a Realtime `sync` event is blocked by iOS/Android. The
  first user gesture anywhere plays a silent clip to grant the element sticky
  activation so the follower can start playing when the leader starts. Don't remove it
  or move the listener registration out of module load (must be active before init's
  network awaits).
- **Realtime has two separate channels — don't conflate them:**
  - `realtime:listeners-room` (**presence**) powers "Listen together". It is
    **room-wide**: the leader broadcasts `track_id`/`position_seconds`/`is_playing`
    to EVERY device, not just followers. `following_id` in the payload only drives
    the leader's "X is listening together with you" banner — it is NOT required for
    sync. Debug presence by watching these WS frames in DevTools.
  - `realtime:player_state_changes` (**postgres_changes**) powers the "Resume here"
    cross-device banner. It needs Realtime enabled for the `player_state` table in
    the Supabase dashboard (Database → Replication). If the console shows
    "Unable to subscribe to changes", that's the cause — it is unrelated to presence
    and only breaks the resume banner, not Listen together.
- **Stale shell gotcha**: after ANY change, the user must **hard-reload** (or close the
  tab) — the service worker serves the cached `santoor-shell-vN` shell, so a normal
  reload can hide your fix. Always bump `CACHE_NAME` AND tell the user to hard-reload.

## Editing tips
- Read only the module/function you touch — files are small now, no need to load the
  whole app. `grep`/`glob` first; only `read` the exact slice.
- UI template lives in `js/render.js`'s `render()`; handlers in `attachHandlers()`.
  There are no components — it's one `innerHTML` string.
- Supabase client comes from the CDN `<script>` in `index.html`; call `window.supabase`
  directly. Schema truth = `supabase-setup.sql`.
- Deploy = push all files to the **root** of the `main` branch (GitHub Pages).
  `.nojekyll` must stay.
