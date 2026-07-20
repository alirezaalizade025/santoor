// All Supabase access: client init, track CRUD (Create/Read/Delete — no
// Update by design), and the continuously-updated player_state row.
import { store, DEVICE_ID, DEFAULT_PLAYLIST_ID } from './store.js';
import { showError } from './util.js';

// Retry a Supabase call a few times with exponential backoff before giving up.
// Transient network blips (mobile handoff, flaky wifi) otherwise fail a write
// outright. `fn` must return the Supabase `{ data, error }` shape; we retry when
// it throws OR returns an error, and resolve with the first success.
async function withRetry(label, fn, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      if (!res || !res.error) return res;
      lastErr = res.error;
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * Math.pow(2, i)));
  }
  console.error(label + ' failed after ' + attempts + ' attempts', lastErr);
  return { data: null, error: lastErr };
}

// Wait until the Supabase client library (loaded from the CDN in index.html)
// is available. If the classic CDN <script> is slow or momentarily blocked,
// the module may run first; this resolves once `window.supabase` exists.
function whenSupabaseLibReady() {
  if (window.supabase) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.querySelector('script[src*="supabase"]');
    if (script) {
      script.addEventListener('load', () => resolve(!!window.supabase), { once: true });
      script.addEventListener('error', () => resolve(false), { once: true });
    }
    // Fallback polling in case the script tag isn't found but the lib arrives.
    let tries = 0;
    const tick = () => {
      if (window.supabase) return resolve(true);
      if (++tries > 50) return resolve(false); // ~5s
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });
}

export async function initSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) {
    store.dbError = 'missing-config';
    return false;
  }
  const libReady = await whenSupabaseLibReady();
  if (!libReady) {
    console.error('Supabase client library failed to load (CDN blocked or offline).');
    store.dbError = 'lib-unavailable';
    return false;
  }
  try {
    store.db = window.supabase.createClient(cfg.url, cfg.anonKey);
    store.dbError = null;
    return true;
  } catch (e) {
    console.error('Supabase init failed', e);
    store.dbError = 'init-failed';
    return false;
  }
}

export async function fetchTracks() {
  const { data, error } = await store.db.from('tracks')
    .select('*')
    .eq('playlist_id', store.activePlaylistId)
    .order('created_at', { ascending: true });
  if (error) { console.error('fetchTracks error', error); showError('Could not load your tracks from the database.'); return []; }
  return data;
}

// Fetch all playlists. Falls back gracefully if the playlists table isn't set
// up yet (older Supabase project) so the app still works on the Default queue.
export async function fetchPlaylists() {
  const { data, error } = await store.db.from('playlists').select('*').order('created_at', { ascending: true });
  if (error) {
    console.warn('fetchPlaylists unavailable — run the latest supabase-setup.sql', error.message || error);
    store.playlistsSupported = false;
    return [{ id: DEFAULT_PLAYLIST_ID, name: 'Default' }];
  }
  store.playlistsSupported = true;
  if (!data.some((p) => p.id === DEFAULT_PLAYLIST_ID)) data.unshift({ id: DEFAULT_PLAYLIST_ID, name: 'Default' });
  return data;
}

export async function createPlaylist(name) {
  const { data, error } = await withRetry('createPlaylist',
    () => store.db.from('playlists').insert({ name }).select().single());
  if (error) { showError('Could not create that playlist.'); return null; }
  return data;
}

export async function deletePlaylist(id) {
  if (id === DEFAULT_PLAYLIST_ID) { showError('The Default playlist cannot be deleted.'); return false; }
  const { error } = await withRetry('deletePlaylist',
    () => store.db.from('playlists').delete().eq('id', id));
  if (error) { showError('Could not delete that playlist.'); return false; }
  return true;
}

export function createTrack(url, title, host) {
  return withRetry('createTrack',
    () => store.db.from('tracks').insert({ url, title, host, playlist_id: store.activePlaylistId }).select().single())
    .then(({ data, error }) => {
      if (error) { showError('Could not save that track — check your Supabase setup or connection.'); return null; }
      return data;
    });
}

export async function deleteTrack(id) {
  const { error } = await withRetry('deleteTrack',
    () => store.db.from('tracks').delete().eq('id', id));
  if (error) { showError('Could not remove that track — check your connection.'); return false; }
  return true;
}

// Backfill a track's real duration once metadata has loaded, so the queue can
// show lengths without loading each track first. Fire-and-forget: a failure
// (e.g. the narrow UPDATE policy not yet applied in Supabase) is non-fatal and
// only means durations won't be cached. Uses the "public update track duration"
// RLS policy — see supabase-setup.sql.
export async function updateTrackDuration(id, seconds) {
  if (!store.dbReady || !isFinite(seconds) || seconds <= 0) return;
  const { error } = await store.db.from('tracks').update({ duration_seconds: seconds }).eq('id', id);
  if (error) console.warn('updateTrackDuration skipped', error.message || error);
}

export async function fetchPlayerState() {
  const { data, error } = await store.db.from('player_state').select('*').eq('playlist_id', store.activePlaylistId).single();
  if (error) { console.error('fetchPlayerState error', error); return null; }
  return data;
}

export async function savePlayerState(partial) {
  const payload = Object.assign(
    { playlist_id: store.activePlaylistId, updated_by: DEVICE_ID, updated_at: new Date().toISOString() },
    partial
  );
  // Upsert so a playlist that has no state row yet (freshly created) still saves.
  await withRetry('savePlayerState',
    () => store.db.from('player_state').upsert(payload, { onConflict: 'playlist_id' }));
}

export function subscribeToPlayerState(onChange) {
  return store.db.channel('player_state_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_state' }, (payload) => {
      if (payload.new && payload.new.playlist_id === store.activePlaylistId && payload.new.updated_by !== DEVICE_ID) onChange(payload.new);
    })
    .subscribe();
}

// Realtime for the shared queue: mirror INSERT/DELETE on `tracks` so every
// device's queue stays live without a manual reload. Requires Realtime enabled
// for the `tracks` table in Supabase (Database → Replication). Without it, adds
// and removes only appear after a page refresh — and "Listen together" silently
// fails when a follower's client never loaded the leader's newly-added track.
export function subscribeToTracks(onInsert, onDelete) {
  return store.db.channel('tracks_changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tracks' }, (payload) => {
      // Only surface inserts for the playlist currently being viewed.
      if (payload.new && (payload.new.playlist_id || DEFAULT_PLAYLIST_ID) === store.activePlaylistId) onInsert(payload.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tracks' }, (payload) => {
      // DELETE payloads only include the primary key by default, so we can't
      // filter by playlist here — app.js ignores ids not in the current queue.
      if (payload.old && payload.old.id) onDelete(payload.old.id);
    })
    .subscribe();
}

// Realtime playlist create/delete so the switcher stays live across devices.
export function subscribeToPlaylists(onInsert, onDelete) {
  return store.db.channel('playlists_changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'playlists' }, (payload) => {
      if (payload.new) onInsert(payload.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'playlists' }, (payload) => {
      if (payload.old && payload.old.id) onDelete(payload.old.id);
    })
    .subscribe();
}

// ---------------------------------------------------------------------------
// Castbox: search + resolve via Supabase Edge Functions (server-side proxy to
// Podcast Index / RSS — keeps third-party keys out of the browser and dodges
// CORS). The anon key is used as the bearer; the functions are public.
// ---------------------------------------------------------------------------
async function invokeCastbox(fn, body) {
  if (!store.dbReady || !store.db) {
    return { data: null, error: 'database not ready' };
  }
  try {
    const { data, error } = await store.db.functions.invoke(fn, { body });
    if (error) return { data: null, error };
    return { data, error: null };
  } catch (e) {
    console.error('castbox invoke ' + fn + ' failed', e);
    return { data: null, error: e };
  }
}

export async function callCastboxSearch(q) {
  const { data, error } = await invokeCastbox('castbox-search', { q });
  if (error || !data) return { feeds: [] };
  return data;
}

export async function callCastboxResolve(feed) {
  const { data, error } = await invokeCastbox('castbox-resolve', { feed });
  if (error || !data) return { meta: {}, episodes: [] };
  return data;
}

// Selected Castbox channels (the Castbox tab's "previously selected" list).
export async function fetchCastboxChannels() {
  if (!store.dbReady || !store.db) return [];
  const { data, error } = await store.db
    .from('castbox_channels')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('fetchCastboxChannels unavailable — run the latest supabase-setup.sql', error.message || error);
    return [];
  }
  return data;
}

export async function saveCastboxChannel(meta) {
  const { data, error } = await withRetry('saveCastboxChannel',
    () => store.db.from('castbox_channels')
      .insert({
        castbox_id: meta.id || null,
        title: meta.title,
        author: meta.author || null,
        rss_url: meta.feedUrl || meta.rss_url || null,
        artwork_url: meta.artwork || meta.artwork_url || null,
        description: meta.description || null,
      })
      .select()
      .single());
  if (error) { showError('Could not save that channel.'); return null; }
  return data;
}

export async function deleteCastboxChannel(id) {
  const { error } = await withRetry('deleteCastboxChannel',
    () => store.db.from('castbox_channels').delete().eq('id', id));
  if (error) { showError('Could not remove that channel.'); return false; }
  return true;
}

// Realtime for selected channels so the Castbox tab stays live across devices.
export function subscribeToCastboxChannels(onInsert, onDelete) {
  return store.db.channel('castbox_channels_changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'castbox_channels' }, (payload) => {
      if (payload.new) onInsert(payload.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'castbox_channels' }, (payload) => {
      if (payload.old && payload.old.id) onDelete(payload.old.id);
    })
    .subscribe();
}
