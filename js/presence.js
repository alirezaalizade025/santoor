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

// Throttle all .track() calls: Supabase Realtime enforces a presence rate limit
// and CLOSES the channel ("Client presence rate limit exceeded") on a burst.
// Coalesce so we never send more often than PRESENCE_INTERVAL ms.
let lastPresenceAt = 0;
const PRESENCE_INTERVAL = 800;

export function broadcastPresence(immediate) {
  if (!store.presenceChannel) return;
  clearTimeout(store.presenceUpdateTimer);
  const fire = () => {
    const since = Date.now() - lastPresenceAt;
    if (since < PRESENCE_INTERVAL) {
      store.presenceUpdateTimer = setTimeout(fire, PRESENCE_INTERVAL - since);
      return;
    }
    lastPresenceAt = Date.now();
    store.presenceChannel.track(myPresencePayload());
  };
  store.presenceUpdateTimer = setTimeout(fire, immediate ? 0 : 1000);
}

// Merge a peer (from a broadcast payload) into onlineUsers.
function upsertPeer(peer) {
  if (!peer || !peer.id) return;
  const i = store.onlineUsers.findIndex((u) => u.id === peer.id);
  if (i === -1) store.onlineUsers.push(peer);
  else store.onlineUsers[i] = Object.assign({}, store.onlineUsers[i], peer);
}

function currentTrackId() {
  const t = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  return t ? t.id : null;
}

export function initPresence() {
  store.presenceChannel = store.db.channel('listeners-room', {
    config: { presence: { key: DEVICE_ID }, broadcast: { self: false } }
  });
  store.presenceChannel
    .on('presence', { event: 'sync' }, () => {
      const raw = store.presenceChannel.presenceState();
      store.onlineUsers = Object.entries(raw)
        .filter(([id]) => id !== DEVICE_ID)
        .map(([id, arr]) => {
          // A key can have several metas (frequent re-tracks create transient
          // joins/leaves). Take the most recent by our own updated_at so we
          // never read a stale following_id / is_playing from an old meta.
          const latest = arr.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
          return Object.assign({ id }, latest);
        });

      if (store.followingId) {
        const peer = store.onlineUsers.find((u) => u.id === store.followingId);
        if (!peer) { stopFollowing(); }
        else mirrorPeer(peer);
      }
      render();
    })
    // Join handshake (broadcast): a newcomer announces arrival; existing
    // members reply with their current playback state so the newcomer learns
    // "where active now". Replies never re-trigger a join, so no loop.
    .on('broadcast', { event: 'join' }, ({ payload }) => {
      if (!payload || !payload.peer) return;
      upsertPeer(payload.peer);
      store.presenceChannel.send({
        type: 'broadcast',
        event: 'reply',
        payload: {
          peer: Object.assign({ id: DEVICE_ID }, myPresencePayload()),
          state: {
            track_id: currentTrackId(),
            position_seconds: store.currentTime,
            is_playing: store.isPlaying
          }
        }
      });
      render();
    })
    .on('broadcast', { event: 'reply' }, ({ payload }) => {
      if (!payload || !payload.peer) return;
      upsertPeer(payload.peer);
      // Catch the newcomer up to the active playback so they know where it is.
      const s = payload.state;
      if (s && s.track_id && store.currentIndex === -1) {
        const idx = store.queue.findIndex((t) => t.id === s.track_id);
        if (idx !== -1) loadTrack(idx, false, s.position_seconds || 0);
      }
      render();
    })
    // Playback sync: the followed peer broadcasts its {track_id, second,
    // is_playing}. The subscriber plays that song from that minute. Scoped to
    // the peer we're following so other devices' broadcasts are ignored.
    .on('broadcast', { event: 'play' }, ({ payload }) => {
      if (!payload || payload.peer_id !== store.followingId) return;
      if (!payload.track_id) return;
      mirrorPeer({
        track_id: payload.track_id,
        position_seconds: payload.position_seconds,
        is_playing: payload.is_playing,
        updated_at: Date.now()
      });
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        broadcastPresence(true);
        // Announce arrival so existing members send us their current state.
        // Sent only here (not on receiving replies) so the process runs once.
        store.presenceChannel.send({
          type: 'broadcast',
          event: 'join',
          payload: { peer: Object.assign({ id: DEVICE_ID }, myPresencePayload()) }
        });
      }
    });

  // If the channel closes (e.g. a past rate-limit), rejoin so presence/follow
  // recover without a full page reload.
  store.presenceChannel.on('close', () => { setTimeout(initPresence, 2000); });

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
