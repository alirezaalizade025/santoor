// All Supabase access: client init, track CRUD (Create/Read/Delete — no
// Update by design), and the continuously-updated player_state row.
import { store, DEVICE_ID } from './store.js';
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

export function initSupabase() {
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) return false;
  try {
    store.db = window.supabase.createClient(cfg.url, cfg.anonKey);
    return true;
  } catch (e) {
    console.error('Supabase init failed', e);
    return false;
  }
}

export async function fetchTracks() {
  const { data, error } = await store.db.from('tracks').select('*').order('created_at', { ascending: true });
  if (error) { console.error('fetchTracks error', error); showError('Could not load your tracks from the database.'); return []; }
  return data;
}

export async function createTrack(url, title, host) {
  const { data, error } = await withRetry('createTrack',
    () => store.db.from('tracks').insert({ url, title, host }).select().single());
  if (error) { showError('Could not save that track — check your Supabase setup or connection.'); return null; }
  return data;
}

export async function deleteTrack(id) {
  const { error } = await withRetry('deleteTrack',
    () => store.db.from('tracks').delete().eq('id', id));
  if (error) { showError('Could not remove that track — check your connection.'); return false; }
  return true;
}

export async function fetchPlayerState() {
  const { data, error } = await store.db.from('player_state').select('*').eq('id', 1).single();
  if (error) { console.error('fetchPlayerState error', error); return null; }
  return data;
}

export async function savePlayerState(partial) {
  const payload = Object.assign({ id: 1, updated_by: DEVICE_ID, updated_at: new Date().toISOString() }, partial);
  await withRetry('savePlayerState',
    () => store.db.from('player_state').update(payload).eq('id', 1));
}

export function subscribeToPlayerState(onChange) {
  return store.db.channel('player_state_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_state', filter: 'id=eq.1' }, (payload) => {
      if (payload.new && payload.new.updated_by !== DEVICE_ID) onChange(payload.new);
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
      if (payload.new) onInsert(payload.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tracks' }, (payload) => {
      if (payload.old && payload.old.id) onDelete(payload.old.id);
    })
    .subscribe();
}
