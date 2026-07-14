// Entry point. Boots the app: loads identity, connects Supabase, restores the
// shared player position, then starts presence + audio wiring. Everything is
// split into focused modules under ./js/ and imported here.
import { store } from './js/store.js';
import { render } from './js/render.js';
import { initSupabase, fetchTracks, fetchPlayerState, subscribeToPlayerState } from './js/supabase.js';
import { initPresence } from './js/presence.js';
import { loadTrack, attachAudioListeners } from './js/player.js';
import { loadNickname } from './js/identity.js';

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
  initPresence();
  attachAudioListeners();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => console.error('SW registration failed', e));
  }
}

init();
