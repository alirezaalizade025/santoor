# Santoor — music player, GitHub Pages + Supabase

## What's in this folder
- `index.html`, `styles.css`, `app.js` — the app
- `manifest.json`, `service-worker.js`, `icons/` — makes it installable + offline-capable
- `supabase-config.js` — paste your Supabase keys here
- `supabase-setup.sql` — run this once in Supabase to create your tables
- `.nojekyll` — tells GitHub Pages to serve files as-is (no Jekyll processing)

## 1. Set up Supabase (~5 min)
1. Go to https://supabase.com → sign up (free) → **New project**.
2. Pick a name, a database password (save it), a region. Wait ~2 min.
3. Left sidebar → **SQL Editor → New query**. Paste in the entire contents
   of `supabase-setup.sql` from this folder, click **Run**.
4. Left sidebar → **Database → Replication**. Find the `player_state`
   table and toggle it **on** — this is what lets other devices see
   playback updates live, instantly.
5. Left sidebar → **Project Settings → API**. Copy the **Project URL**
   and the **anon public** key.
6. Open `supabase-config.js` in this folder and paste them in:
   ```js
   window.SUPABASE_CONFIG = {
     url: "https://xxxxx.supabase.co",
     anonKey: "eyJ..."
   };
   ```

## 2. Deploy to GitHub Pages
1. Push all files in this folder to the **root** of your repo (not inside
   a subfolder) — `index.html` must sit next to `app.js`, `styles.css`, etc.
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** →
   Branch: `main`, folder `/ (root)`.
3. Repo → **Actions** tab → confirm a "pages build and deployment" run
   completes with a green check.
4. Visit `https://yourusername.github.io/your-repo/`.

The included `.nojekyll` file avoids a common GitHub Pages gotcha where
Jekyll processing interferes with plain static sites.

## 3. Install it on Android
1. Open your deployed URL in Chrome on Android.
2. Tap **⋮ → Add to Home screen / Install app**.
3. It opens full-screen from your home screen from then on.

## How the pieces fit together
- **GitHub Pages** hosts the static files — it has no database of its own.
- **Supabase** is the database + API. `app.js` calls it directly from the
  browser using the anon key (safe to expose — access is controlled by the
  Row Level Security policies in `supabase-setup.sql`, not by hiding the key).
- **Tracks table**: Create (paste a URL), Read (load your queue), Delete
  (remove a track). No update policy exists on purpose — matches your
  request that the URL list itself never needs editing in place.
- **player_state table**: a single row holding which track is playing,
  at what position, and whether it's paused. This one *is* continuously
  updated (that's a different concern from the URL list — it's live status,
  not stored content). Every device subscribes to this row in real time via
  Supabase Realtime, so when you pause on your phone, your laptop sees it
  within about a second and offers to pick up from that exact spot.

## Listen together (new)
- The header shows how many people currently have the app open (🟢 N
  listening now) — this uses Supabase Realtime **Presence**, a WebSocket
  feature, separate from the database sync above. Nobody needs to be
  playing anything for the count to show them as present.
- Give yourself a display name in the box next to the listener count —
  it's saved locally so it persists across visits on that browser.
- Under "Listening now," each other visitor has a **Listen together**
  button. Turning it on makes your player mirror theirs: same track, same
  position, same play/pause state. Your own controls lock while following
  (there's a "Stop" button in the banner to take back control).
- Position sync accounts for network delay and re-corrects every few
  seconds if it drifts — this is "closely synced," not frame-perfect.
  Browser autoplay restrictions mean the very first mirrored `play` may
  occasionally need you to tap play once, depending on the browser.
- No database table changes were needed for this — presence data is
  ephemeral (only exists while a tab is open), so it lives entirely in
  Realtime, not in Postgres.

## Known limitations
- **No user accounts yet** — this setup is single-shared-queue, meant for
  one person across their own devices. Anyone with your deployed URL can
  see and modify the queue too, since there's no login. If you want private
  accounts later, we can add Supabase Auth on top of this same schema.
- **CORS**: some hosts block cross-origin audio loading. Direct links to
  `.mp3`/`.m4a`/etc. usually work; some streaming platforms will refuse to
  play regardless — that's a source restriction, not a bug here.
- **Offline**: the app shell opens without internet; actual audio playback
  and adding/removing tracks still need a connection.
