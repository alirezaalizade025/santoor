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
4. Left sidebar → **Database → Replication**. Enable **realtime** for
   the `player_state`, `tracks`, and `playlists` tables:
   - `player_state` — lets other devices see playback position live.
   - `tracks` — lets other devices see queue adds/removes live (also
     required so "Listen together" can find a just-added track).
   - `playlists` — lets the playlist switcher update live across devices.
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

## Playlists, playback & queue features
- **Playlists**: use the **Playlist** dropdown to switch between named
  queues, **+ New** to create one, and **Delete** to remove a non-Default
  one (and its tracks). Each playlist has its own queue and its own synced
  playback position. The **Default** playlist always exists.
- **Add tracks**: paste a URL and press Add. Duplicate URLs are rejected,
  and the link is probed first — if it doesn't load as playable audio you
  get a confirm prompt before it's added.
- **Shuffle & repeat**: the shuffle button randomizes advance order
  (without repeating a track until the cycle is exhausted); the repeat
  button cycles off → repeat-all → repeat-one.
- **Volume**: the slider under the transport controls is per-device and
  saved locally — it does not sync to other listeners.
- **Recently played**: an expandable list under the queue shows tracks you
  played on this device; tap one to play it again (re-adding it if needed).
- **Real waveform**: when the audio source allows cross-origin analysis,
  the bars reflect the actual signal; otherwise they fall back to a
  decorative animation.
- **Track durations**: shown in the queue once known (cached to the
  database so they appear without reloading each track).

## Now Playing view
- Tap the mini-player (track art / title area) to open a full-screen
  **Now Playing** view. The top half is split into two large tap zones —
  left = previous track, right = next track — with a large play/pause
  button and an oversized current/total timer below. Close it with the ✕
  in the corner. It reuses the same colors/fonts as the rest of the app.


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
- **Host mode** (one-to-many): press **Host a session** to advertise your
  playback room-wide; everyone else sees a **Join session** button, and
  your controls then drive all joiners at once. It's the same sync
  mechanism as pairwise following, just with a single clear join button.
- Position sync accounts for network delay and re-corrects every few
  seconds if it drifts — this is "closely synced," not frame-perfect.
  Browser autoplay restrictions mean the very first mirrored `play` may
  occasionally need you to tap play once, depending on the browser.
- No database table changes were needed for this — presence data is
  ephemeral (only exists while a tab is open), so it lives entirely in
  Realtime, not in Postgres.

## Known limitations
- **No user accounts yet** — playlists are public and shared; anyone with
  your deployed URL can see, edit, and delete any playlist, since there's
  no login. The schema is already playlist-based, so adding Supabase Auth
  (private per-user playlists) later is an additive change.
- **Cross-playlist listen-together** — if you follow someone who's on a
  different playlist, you'll see "Waiting for a track to sync…" until that
  track exists in your active playlist.
- **CORS**: some hosts block cross-origin audio loading. Direct links to
  `.mp3`/`.m4a`/etc. usually work; some streaming platforms will refuse to
  play regardless — that's a source restriction, not a bug here. The real
  waveform also needs CORS-permissive audio; otherwise it falls back to a
  decorative animation.
- **Offline**: the app shell opens without internet; actual audio playback
  and adding/removing tracks or playlists still need a connection.
