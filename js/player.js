// Core playback logic: loading tracks, transport controls, queue add/remove,
// position persistence, and the audio-element event wiring.
import { store, audio, DEVICE_ID } from './store.js';
import { showError, urlHost, guessTitle } from './util.js';
import { createTrack, deleteTrack, savePlayerState, updateTrackDuration } from './supabase.js';
import { broadcastPresence } from './presence.js';
import { render } from './render.js';
import { initMediaSession, updateMetadata, updatePlaybackState, updatePositionState } from './mediaSession.js';

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

// Keep a follower synced to the master's current position ("the minute"): the
// controller broadcasts its playback every 2s while playing. Broadcast (not
// presence) so it avoids the presence rate limit.
setInterval(() => {
  if (store.isPlaying && !store.followingId && store.presenceChannel) broadcastPlay();
}, 2000);

export function persistPosition(immediate) {
  if (!store.dbReady) return;
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  const payload = { current_track_id: track ? track.id : null, position_seconds: store.currentTime, is_playing: store.isPlaying };
  if (immediate) { clearTimeout(store.saveTimer); savePlayerState(payload); }
  else { clearTimeout(store.saveTimer); store.saveTimer = setTimeout(() => savePlayerState(payload), 800); }
}

// Broadcast our current playback over Realtime so a follower can play from the
// exact minute the master is at. Uses broadcast (not presence) so it is not
// subject to the presence rate limit. Only the controller (not a follower)
// broadcasts, to avoid echo loops.
function broadcastPlay() {
  if (store.followingId || !store.presenceChannel) return;
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  store.presenceChannel.send({
    type: 'broadcast',
    event: 'play',
    payload: {
      peer_id: DEVICE_ID,
      track_id: track ? track.id : null,
      position_seconds: store.currentTime,
      is_playing: store.isPlaying
    }
  });
}

export function loadTrack(index, autoplay, seekTo) {
  if (index < 0 || index >= store.queue.length) return;
  store.currentIndex = index;
  const track = store.queue[index];
  store.pendingSeek = seekTo || 0;
  audio.src = track.url;
  store.duration = 0;
  updateMetadata(track);
  if (autoplay) {
    audio.play().then(() => { store.isPlaying = true; store.autoplayBlocked = false; broadcastPresence(true); broadcastPlay(); render(); })
      .catch(() => {
        store.isPlaying = false;
        // When mirroring a leader, a rejected play() is an autoplay-policy block,
        // not a broken source — offer "Tap to join playback" instead of an error.
        if (store.followingId) { store.autoplayBlocked = true; render(); }
        else showError('Could not play this track — the source may block playback.');
        broadcastPresence(true);
      });
  } else {
    store.isPlaying = false;
    broadcastPresence(true);
    broadcastPlay();
  }
  render();
}

// Probe a pasted URL with a throwaway Audio element before inserting, so an
// obviously broken/unplayable link is caught here instead of only failing when
// the user later hits play. Resolves true if metadata loads; false on error or
// timeout. CORS-blocked-but-playable sources can still fail metadata, so a
// negative result asks for confirmation rather than hard-blocking the add.
function probePlayable(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = 'metadata';
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      probe.removeAttribute('src');
      probe.load();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    probe.addEventListener('loadedmetadata', () => finish(true), { once: true });
    probe.addEventListener('error', () => finish(false), { once: true });
    probe.src = url;
  });
}

export async function addTrack(url) {
  if (!url || !/^https?:\/\//i.test(url.trim())) { showError('Paste a valid track URL starting with http:// or https://'); return; }
  if (!store.dbReady) { showError('Database not configured — add your Supabase URL and key to supabase-config.js first.'); return; }
  const cleanUrl = url.trim();

  // Duplicate guard: don't create a second row for a URL already in the queue.
  if (store.queue.some((t) => t.url === cleanUrl)) { showError('That track is already in the queue.'); return; }

  // Pre-add validation probe: catch obviously broken links before inserting.
  store.addingTrack = true; render();
  const playable = await probePlayable(cleanUrl);
  store.addingTrack = false; render();
  if (!playable) {
    const proceed = window.confirm('This link did not load as playable audio (it may be broken, or the source may block cross-origin loading). Add it anyway?');
    if (!proceed) return;
  }

  const title = guessTitle(cleanUrl);
  const host = urlHost(cleanUrl);
  const row = await createTrack(cleanUrl, title, host);
  if (!row) return;
  if (store.queue.some((t) => t.id === row.id)) { render(); return; } // realtime may have raced us in
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
  if (store.isPlaying) { audio.pause(); store.isPlaying = false; persistPosition(true); broadcastPresence(true); broadcastPlay(); render(); }
  else { audio.play().then(() => { store.isPlaying = true; persistPosition(true); broadcastPresence(true); broadcastPlay(); render(); }).catch(() => showError('Playback failed.')); }
}

export function toggleLoop() { if (store.followingId) return; store.loop = !store.loop; render(); }

// Per-device volume (0..1). A local preference, NOT synced across Listen
// together (unlike position/play-state), and persisted to localStorage.
export function setVolume(v) {
  const vol = Math.min(Math.max(v, 0), 1);
  store.volume = vol;
  audio.volume = vol;
  try { localStorage.setItem('santoor:volume', String(vol)); } catch (e) {}
  render();
}

// Called from a real user gesture (the "Tap to join playback" button) after a
// mirrored autoplay was blocked. A genuine gesture satisfies the autoplay policy.
export function joinPlayback() {
  store.autoplayBlocked = false;
  audio.play().then(() => { store.isPlaying = true; render(); }).catch(() => { store.autoplayBlocked = true; render(); });
}export function next() {
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
  broadcastPlay();
  render();
}

export function seekBy(delta) {
  if (store.followingId) return;
  if (!store.duration) return;
  audio.currentTime = Math.min(Math.max(audio.currentTime + delta, 0), store.duration);
  store.currentTime = audio.currentTime;
  persistPosition(true);
  broadcastPresence(true);
  broadcastPlay();
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
  initMediaSession({
    onPlay: () => { if (!store.isPlaying) togglePlay(); },
    onPause: () => { if (store.isPlaying) togglePlay(); },
    onNext: () => next(),
    onPrev: () => prev(),
    onSeek: (delta) => seekBy(delta)
  });

  audio.addEventListener('play', () => { updatePlaybackState(true); });
  audio.addEventListener('pause', () => { updatePlaybackState(false); });

  audio.addEventListener('timeupdate', () => {
    store.currentTime = audio.currentTime;
    updatePositionState(audio.currentTime, store.duration);
    render();
  });

  // Periodic persistence/broadcast, decoupled from timeupdate. timeupdate fires
  // many times per second; a fixed interval re-arms nothing and does the work
  // exactly once every 5s while a track is loaded.
  setInterval(() => {
    if (store.currentIndex === -1) return;
    if (!store.followingId) persistPosition(false);
    broadcastPresence(false);
  }, 5000);
  audio.addEventListener('loadedmetadata', () => {
    store.duration = audio.duration;
    // Backfill the real duration to the tracks table once (only if not already
    // stored) so the queue can show lengths without loading every track.
    const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
    if (track && isFinite(audio.duration) && audio.duration > 0 && !track.duration_seconds) {
      track.duration_seconds = audio.duration;
      updateTrackDuration(track.id, audio.duration);
    }
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
