// Entry point. Boots the app: loads identity, connects Supabase, restores the
// shared player position, then starts presence + audio wiring. Everything is
// split into focused modules under ./js/ and imported here.
import { store, audio } from './js/store.js';
import { render } from './js/render.js';
import { initSupabase, fetchTracks, fetchPlayerState, subscribeToPlayerState, subscribeToTracks } from './js/supabase.js';
import { initPresence } from './js/presence.js';
import { loadTrack, attachAudioListeners } from './js/player.js';
import { loadNickname } from './js/identity.js';

// Realtime INSERT on `tracks`: append the new row locally (idempotent — the
// device that added it already pushed it optimistically) and re-render.
function onTrackInserted(row) {
  if (store.queue.some((t) => t.id === row.id)) return;
  store.queue.push(row);
  if (store.currentIndex === -1) loadTrack(0, false);
  render();
}

// Realtime DELETE on `tracks`: remove by id and adjust currentIndex the same
// way removeTrack() does locally, so following the deletion stays consistent.
function onTrackDeleted(id) {
  const idx = store.queue.findIndex((t) => t.id === id);
  if (idx === -1) return;
  store.queue.splice(idx, 1);
  if (store.currentIndex === idx) {
    audio.pause(); audio.src = ''; store.isPlaying = false;
    store.currentIndex = store.queue.length ? Math.min(idx, store.queue.length - 1) : -1;
    if (store.currentIndex !== -1) loadTrack(store.currentIndex, false);
  } else if (store.currentIndex > idx) {
    store.currentIndex--;
  }
  render();
}

async function init() {
  store.nickname = loadNickname();
  render();
  store.dbReady = initSupabase();
  render();
  if (!store.dbReady) { store.loading = false; render(); return; }

  store.queue = await fetchTracks();
  const remoteState = await fetchPlayerState();
  if (remoteState && remoteState.current_track_id) {
    const idx = store.queue.findIndex((t) => t.id === remoteState.current_track_id);
    if (idx !== -1) loadTrack(idx, false, remoteState.position_seconds || 0);
  }
  store.loading = false;
  render();

  subscribeToPlayerState((remote) => { if (!store.followingId) { store.pendingRemote = remote; render(); } });
  subscribeToTracks(onTrackInserted, onTrackDeleted);
  initPresence();
  attachAudioListeners();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => console.error('SW registration failed', e));
  }
}

init();
