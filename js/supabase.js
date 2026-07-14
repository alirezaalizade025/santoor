// All Supabase access: client init, track CRUD (Create/Read/Delete — no
// Update by design), and the continuously-updated player_state row.
import { store, DEVICE_ID } from './store.js';
import { showError } from './util.js';

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
  const { data, error } = await store.db.from('tracks').insert({ url, title, host }).select().single();
  if (error) { console.error('createTrack error', error); showError('Could not save that track — check your Supabase setup.'); return null; }
  return data;
}

export async function deleteTrack(id) {
  const { error } = await store.db.from('tracks').delete().eq('id', id);
  if (error) { console.error('deleteTrack error', error); showError('Could not remove that track.'); return false; }
  return true;
}

export async function fetchPlayerState() {
  const { data, error } = await store.db.from('player_state').select('*').eq('id', 1).single();
  if (error) { console.error('fetchPlayerState error', error); return null; }
  return data;
}

export async function savePlayerState(partial) {
  const payload = Object.assign({ id: 1, updated_by: DEVICE_ID, updated_at: new Date().toISOString() }, partial);
  const { error } = await store.db.from('player_state').update(payload).eq('id', 1);
  if (error) console.error('savePlayerState error', error);
}

export function subscribeToPlayerState(onChange) {
  return store.db.channel('player_state_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_state', filter: 'id=eq.1' }, (payload) => {
      if (payload.new && payload.new.updated_by !== DEVICE_ID) onChange(payload.new);
    })
    .subscribe();
}
