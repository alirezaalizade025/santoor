// Entry point. Boots the app: loads identity, connects Supabase, restores the
// shared player position, then starts presence + audio wiring. Everything is
// split into focused modules under ./js/ and imported here.
import { store, audio, DEFAULT_PLAYLIST_ID } from './js/store.js';
import { render } from './js/render.js';
import { initSupabase, fetchPlaylists, subscribeToPlayerState, subscribeToTracks, subscribeToPlaylists } from './js/supabase.js';
import { initPresence } from './js/presence.js';
import { loadTrack, attachAudioListeners, loadPlaylistQueue } from './js/player.js';
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

// Realtime playlist INSERT/DELETE so the switcher stays live across devices.
function onPlaylistInserted(row) {
  if (store.playlists.some((p) => p.id === row.id)) return;
  store.playlists.push(row);
  render();
}
function onPlaylistDeleted(id) {
  store.playlists = store.playlists.filter((p) => p.id !== id);
  // If the playlist we're viewing was deleted elsewhere, fall back to Default.
  if (store.activePlaylistId === id) {
    store.activePlaylistId = DEFAULT_PLAYLIST_ID;
    try { localStorage.setItem('santoor:playlist', DEFAULT_PLAYLIST_ID); } catch (e) {}
    loadPlaylistQueue(true);
  }
  render();
}

async function init() {
  store.nickname = loadNickname();
  render();
  store.dbReady = await initSupabase();
  render();
  // If the client lib was merely slow/late (not a config problem), retry once
  // it finishes loading so we don't permanently show the setup banner.
  if (!store.dbReady && store.dbError === 'lib-unavailable') {
    await new Promise((r) => setTimeout(r, 600));
    store.dbReady = await initSupabase();
    render();
  }
  if (!store.dbReady) { store.loading = false; render(); return; }

  store.playlists = await fetchPlaylists();
  // If the remembered playlist no longer exists, fall back to Default.
  if (!store.playlists.some((p) => p.id === store.activePlaylistId)) {
    store.activePlaylistId = DEFAULT_PLAYLIST_ID;
  }
  await loadPlaylistQueue(true);
  store.loading = false;
  render();

  subscribeToPlayerState((remote) => { if (!store.followingId) { store.pendingRemote = remote; render(); } });
  subscribeToTracks(onTrackInserted, onTrackDeleted);
  subscribeToPlaylists(onPlaylistInserted, onPlaylistDeleted);
  initPresence();
  attachAudioListeners();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((e) => console.error('SW registration failed', e));
  }
}

init();
