// Core playback logic: loading tracks, transport controls, queue add/remove,
// position persistence, and the audio-element event wiring.
import { store, audio } from './store.js';
import { showError, urlHost, guessTitle } from './util.js';
import { createTrack, deleteTrack, savePlayerState } from './supabase.js';
import { broadcastPresence } from './presence.js';
import { render } from './render.js';

// Tiny silent clip used only to grant the audio element sticky activation on
// mobile (iOS/Android block programmatic play() outside a user gesture).
const SILENT_AUDIO = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTQQ91lwogr8efOOR0RUEkR/hK1B0he7sHrIWpBG0/0M3IgJ7l/9iI/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR/+Mf/fo/1kh/uIR';

// Run once on the first user gesture anywhere: play the silent clip (inside the
// gesture) so later mirrored play() calls are allowed on mobile. Race-safe: only
// restores the previous source if mirrorPeer hasn't already taken over.
let audioUnlocked = false;
function unlockAudioOnGesture() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((e) => window.removeEventListener(e, unlockAudioOnGesture));
  const prev = audio.src;
  const wasPlaying = !audio.paused;
  audio.muted = true;
  audio.src = SILENT_AUDIO;
  audio.play()
    .then(() => audio.pause())
    .catch(() => {})
    .finally(() => {
      audio.muted = false;
      if (audio.src === SILENT_AUDIO) {
        audio.src = prev;
        if (prev) { audio.load(); if (wasPlaying) audio.play().catch(() => {}); }
      }
    });
}

// Register immediately at module load so the first gesture (even during init's
// network awaits) can unlock audio for later mirrored playback.
['pointerdown', 'touchstart', 'click', 'keydown'].forEach((e) => window.addEventListener(e, unlockAudioOnGesture));

export function persistPosition(immediate) {
  if (!store.dbReady) return;
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  const payload = { current_track_id: track ? track.id : null, position_seconds: store.currentTime, is_playing: store.isPlaying };
  if (immediate) { clearTimeout(store.saveTimer); savePlayerState(payload); }
  else { clearTimeout(store.saveTimer); store.saveTimer = setTimeout(() => savePlayerState(payload), 800); }
}

export function loadTrack(index, autoplay, seekTo) {
  if (index < 0 || index >= store.queue.length) return;
  store.currentIndex = index;
  const track = store.queue[index];
  store.pendingSeek = seekTo || 0;
  audio.src = track.url;
  store.duration = 0;
  if (autoplay) {
    audio.play().then(() => { store.isPlaying = true; broadcastPresence(true); render(); })
      .catch(() => { store.isPlaying = false; showError('Could not play this track — the source may block playback.'); broadcastPresence(true); });
  } else {
    store.isPlaying = false;
    broadcastPresence(true);
  }
  render();
}

export async function addTrack(url) {
  if (!url || !/^https?:\/\//i.test(url.trim())) { showError('Paste a valid track URL starting with http:// or https://'); return; }
  if (!store.dbReady) { showError('Database not configured — add your Supabase URL and key to supabase-config.js first.'); return; }
  const cleanUrl = url.trim();
  const title = guessTitle(cleanUrl);
  const host = urlHost(cleanUrl);
  const row = await createTrack(cleanUrl, title, host);
  if (!row) return;
  store.queue.push(row);
  if (store.currentIndex === -1) { store.currentIndex = 0; loadTrack(0, false); persistPosition(true); }
  render();
}

export async function removeTrack(id) {
  const idx = store.queue.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const ok = await deleteTrack(id);
  if (!ok) return;
  store.queue.splice(idx, 1);
  if (store.currentIndex === idx) {
    audio.pause(); audio.src = ''; store.isPlaying = false;
    store.currentIndex = store.queue.length ? Math.min(idx, store.queue.length - 1) : -1;
    if (store.currentIndex !== -1) loadTrack(store.currentIndex, false);
    persistPosition(true);
  } else if (store.currentIndex > idx) { store.currentIndex--; }
  render();
}

export function togglePlay() {
  if (store.followingId) return;
  if (store.currentIndex === -1) return;
  if (store.isPlaying) { audio.pause(); store.isPlaying = false; persistPosition(true); broadcastPresence(true); render(); }
  else { audio.play().then(() => { store.isPlaying = true; persistPosition(true); broadcastPresence(true); render(); }).catch(() => showError('Playback failed.')); }
}

export function toggleLoop() { if (store.followingId) return; store.loop = !store.loop; render(); }

export function next() {
  if (store.followingId) return;
  if (store.currentIndex < store.queue.length - 1) { loadTrack(store.currentIndex + 1, true); persistPosition(true); broadcastPresence(true); }
}

export function prev() {
  if (store.followingId) return;
  if (store.currentIndex > 0) { loadTrack(store.currentIndex - 1, true); persistPosition(true); broadcastPresence(true); }
}

export function seekTo(fraction) {
  if (store.followingId) return;
  if (!store.duration) return;
  audio.currentTime = fraction * store.duration;
  store.currentTime = audio.currentTime;
  persistPosition(true);
  broadcastPresence(true);
  render();
}

export function applyRemote(remote, resume) {
  if (resume) {
    const idx = store.queue.findIndex((t) => t.id === remote.current_track_id);
    if (idx !== -1) loadTrack(idx, !!remote.is_playing, remote.position_seconds || 0);
  }
  store.pendingRemote = null;
  render();
}

// Wire the <audio> element once. The element lives outside the DOM, so these
// listeners survive the full re-renders that happen on every timeupdate.
export function attachAudioListeners() {
  audio.addEventListener('timeupdate', () => {
    store.currentTime = audio.currentTime;
    if (Math.floor(audio.currentTime) % 5 === 0) {
      if (!store.followingId) persistPosition(false);
      broadcastPresence(false);
    }
    render();
  });
  audio.addEventListener('loadedmetadata', () => {
    store.duration = audio.duration;
    if (store.pendingSeek != null) { try { audio.currentTime = store.pendingSeek; } catch (e) {} store.pendingSeek = null; }
    if (!store.followingId) broadcastPresence(true);
    render();
  });
  audio.addEventListener('ended', () => {
    if (store.followingId) return;
    if (store.currentIndex < store.queue.length - 1) { next(); }
    else if (store.loop && store.queue.length > 0) { loadTrack(0, true); persistPosition(true); broadcastPresence(true); }
    else { store.isPlaying = false; persistPosition(true); render(); }
  });
  audio.addEventListener('error', () => {
    if (store.currentIndex !== -1) showError('This track failed to load — link may be broken or blocks playback.');
  });

  window.addEventListener('online', () => { store.isOnline = true; render(); });
  window.addEventListener('offline', () => { store.isOnline = false; render(); });
}
