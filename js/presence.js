// Realtime "presence": who's listening now and the "Listen together" follow
// feature. The follower mirrors the leader it follows; the leader just
// broadcasts its play state and never reads followers' playback.
import { store, audio, DEVICE_ID } from './store.js';
import { render } from './render.js';
import { loadTrack } from './player.js';

export function myPresencePayload() {
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  return {
    nickname: store.nickname,
    track_id: track ? track.id : null,
    track_title: track ? track.title : null,
    position_seconds: store.currentTime,
    is_playing: store.isPlaying,
    following_id: store.followingId,
    updated_at: Date.now()
  };
}

export function broadcastPresence(immediate) {
  if (!store.presenceChannel) return;
  if (immediate) { clearTimeout(store.presenceUpdateTimer); store.presenceChannel.track(myPresencePayload()); }
  else { clearTimeout(store.presenceUpdateTimer); store.presenceUpdateTimer = setTimeout(() => store.presenceChannel.track(myPresencePayload()), 1000); }
}

export function initPresence() {
  store.presenceChannel = store.db.channel('listeners-room', { config: { presence: { key: DEVICE_ID } } });
  store.presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const raw = store.presenceChannel.presenceState();
      store.onlineUsers = Object.entries(raw)
        .filter(([id]) => id !== DEVICE_ID)
        .map(([id, arr]) => Object.assign({ id }, arr[0]));

      if (store.followingId) {
        const peer = store.onlineUsers.find((u) => u.id === store.followingId);
        if (!peer) { stopFollowing(); }
        else mirrorPeer(peer);
      }
      render();
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') broadcastPresence(true);
    });

  // Heartbeat: re-track our presence so late joiners and reconnects always
  // converge on current state (Supabase presence sync on join can be missed).
  setInterval(() => { if (store.presenceChannel) broadcastPresence(false); }, 5000);
}

// Make this follower mirror a peer's playback. `peer` comes from presence state.
export function mirrorPeer(peer) {
  if (!peer.track_id) return;
  const idx = store.queue.findIndex((t) => t.id === peer.track_id);
  if (idx === -1) return;
  const elapsed = peer.is_playing ? (Date.now() - (peer.updated_at || Date.now())) / 1000 : 0;
  const targetTime = (peer.position_seconds || 0) + elapsed;

  if (store.currentIndex !== idx) {
    loadTrack(idx, peer.is_playing, targetTime);
    return;
  }
  if (peer.is_playing && !store.isPlaying) {
    audio.currentTime = targetTime;
    audio.play().then(() => { store.isPlaying = true; render(); }).catch(() => {});
  } else if (!peer.is_playing && store.isPlaying) {
    audio.pause();
    store.isPlaying = false;
    render();
  } else if (Math.abs(audio.currentTime - targetTime) > 1.5) {
    audio.currentTime = targetTime;
  }
}

export function startFollowing(peerId) {
  store.followingId = peerId;
  const peer = store.onlineUsers.find((u) => u.id === peerId);
  if (peer) mirrorPeer(peer);
  clearInterval(store.followDriftTimer);
  store.followDriftTimer = setInterval(() => {
    const p = store.onlineUsers.find((u) => u.id === store.followingId);
    if (p) mirrorPeer(p);
  }, 4000);
  broadcastPresence(true);
  render();
}

export function stopFollowing() {
  store.followingId = null;
  clearInterval(store.followDriftTimer);
  broadcastPresence(true);
  render();
}
