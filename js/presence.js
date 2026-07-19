// Realtime "presence": who's listening now and the "Listen together" follow
// feature. The follower mirrors the leader it follows; the leader just
// broadcasts its play state and never reads followers' playback.
import { store, audio, DEVICE_ID } from './store.js';
import { render } from './render.js';
import { loadTrack } from './player.js';

// Send a channel broadcast. Prefer the websocket `send()` (no extra HTTP
// requests, no deprecation warning) when the channel is actually subscribed.
// Newer @supabase/realtime-js warns when `send()` auto-falls back to the REST
// API during a disconnect, so only use the explicit `httpSend()` REST path when
// the socket isn't connected. Fall back to plain `send()` on older SDKs.
function channelSend(payload) {
  const ch = store.presenceChannel;
  if (!ch) return;
  const socketConnected = ch.socket && typeof ch.socket.isConnected === 'function'
    ? ch.socket.isConnected()
    : (ch.state === 'joined' || ch.state === 'CHANNEL_JOINED');
  if (socketConnected) {
    ch.send(payload);
  } else if (typeof ch.httpSend === 'function') {
    ch.httpSend(payload);
  } else {
    ch.send(payload);
  }
}

export function myPresencePayload() {
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  return {
    nickname: store.nickname,
    track_id: track ? track.id : null,
    track_title: track ? track.title : null,
    position_seconds: store.currentTime,
    is_playing: store.isPlaying,
    following_id: store.followingId,
    hosting: store.isHost,   // room-wide "join my session" flag for host mode
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

// --- Ping/pong heartbeat: detect disconnects in real time ---------------------
// Supabase presence "leave" can lag many seconds when a tab freezes or a network
// drops without a clean socket close. We layer an app-level ping/pong on top:
// every peer broadcasts a `ping`; receivers reply with a `pong`. We stamp each
// peer's last-heard time and reap anyone who goes silent, so the "listening now"
// list and follow feature react to drop-offs within a few seconds.
const PING_INTERVAL = 15000;  // how often we broadcast our ping (over the ws socket)
const PEER_TIMEOUT = 45000;   // peer is considered gone after this much silence

// Record that we just heard from a peer (any ping/pong/presence message).
function markPeerSeen(id) {
  if (!id || id === DEVICE_ID) return;
  store.peerLastSeen[id] = Date.now();
}

// Reflect the current Realtime socket state in the UI (our own connection).
function refreshConnectionHealth() {
  const rt = store.db && store.db.realtime;
  const connected = rt && typeof rt.isConnected === 'function' ? rt.isConnected() : navigator.onLine;
  if (connected !== store.connectionHealthy) {
    store.connectionHealthy = connected;
    render();
  }
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
      const now = Date.now();
      const candidates = Object.entries(raw)
        .filter(([id]) => id !== DEVICE_ID)
        .map(([id, arr]) => {
          // A key can have several metas (frequent re-tracks create transient
          // joins/leaves). Take the most recent by our own updated_at so we
          // never read a stale following_id / is_playing from an old meta.
          const latest = arr.slice().sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
          // New peer: give it a grace stamp so it isn't reaped before its first ping.
          if (store.peerLastSeen[id] === undefined) store.peerLastSeen[id] = now;
          return Object.assign({ id }, latest);
        });
      // Keep only peers whose ping/pong heartbeat is still fresh, so a peer that
      // dropped without a clean leave doesn't linger in the list.
      store.onlineUsers = candidates.filter((u) => (now - store.peerLastSeen[u.id]) < PEER_TIMEOUT);

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
      markPeerSeen(payload.peer.id);
      upsertPeer(payload.peer);
        channelSend({
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
      markPeerSeen(payload.peer.id);
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
      markPeerSeen(payload.peer_id);
      if (!payload.track_id) return;
      mirrorPeer({
        track_id: payload.track_id,
        position_seconds: payload.position_seconds,
        is_playing: payload.is_playing,
        updated_at: Date.now()
      });
    })
    // Ping/pong heartbeat. A peer's ping proves it's still connected; we reply
    // with a pong so it learns the same about us. Both stamp last-heard time.
    .on('broadcast', { event: 'ping' }, ({ payload }) => {
      if (!payload || !payload.id) return;
      markPeerSeen(payload.id);
      channelSend({ type: 'broadcast', event: 'pong', payload: { id: DEVICE_ID } });
    })
    .on('broadcast', { event: 'pong' }, ({ payload }) => {
      if (!payload || !payload.id) return;
      markPeerSeen(payload.id);
    })
    // Host-mode announcement: a host broadcasts its hosting state via a regular
    // broadcast (in addition to presence) because presence .track() updates can
    // be dropped when the channel is flaky or rate-limited — the "Join session"
    // button must surface reliably. Presence still carries it as a fallback.
    .on('broadcast', { event: 'hosting' }, ({ payload }) => {
      if (!payload || !payload.id) return;
      markPeerSeen(payload.id);
      const u = store.onlineUsers.find((x) => x.id === payload.id);
      if (u) { u.hosting = !!payload.hosting; if (!payload.hosting && store.followingId === payload.id) stopFollowing(); render(); }
      else { upsertPeer(Object.assign({ id: payload.id }, payload)); render(); }
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        store.connectionHealthy = true;
        broadcastPresence(true);
        // Announce arrival so existing members send us their current state.
        // Sent only here (not on receiving replies) so the process runs once.
      channelSend({
          type: 'broadcast',
          event: 'join',
          payload: { peer: Object.assign({ id: DEVICE_ID }, myPresencePayload()) }
        });
        startHeartbeat();
        render();
      }
    });

  // If the channel closes (e.g. a past rate-limit), rejoin so presence/follow
  // recover without a full page reload.
  store.presenceChannel.on('close', () => {
    stopHeartbeat();
    store.connectionHealthy = false;
    render();
    setTimeout(initPresence, 2000);
  });
}

// Start the ping/pong + reaper + connection-watch timers. Safe to call again:
// each timer is cleared first so reconnects don't stack duplicates.
function startHeartbeat() {
  stopHeartbeat();

  // Broadcast our ping so peers know we're alive; also re-track presence so late
  // joiners and reconnects converge on our current state. Skip when the socket
  // is down to avoid the noisy "falling back to REST API" spam during reconnects.
  store.pingTimer = setInterval(() => {
    if (!store.presenceChannel || !store.connectionHealthy) return;
    channelSend({ type: 'broadcast', event: 'ping', payload: { id: DEVICE_ID } });
    broadcastPresence(false);
  }, PING_INTERVAL);

  // Reap peers we've stopped hearing from -> real-time "who left".
  store.peerReapTimer = setInterval(() => {
    const now = Date.now();
    const before = store.onlineUsers.length;
    store.onlineUsers = store.onlineUsers.filter((u) => {
      const alive = (now - (store.peerLastSeen[u.id] || 0)) < PEER_TIMEOUT;
      if (!alive) {
        delete store.peerLastSeen[u.id];
        if (store.followingId === u.id) stopFollowing();
      }
      return alive;
    });
    if (store.onlineUsers.length !== before) render();
  }, 3000);

  // Watch our OWN connection so a dropped socket surfaces immediately.
  store.connCheckTimer = setInterval(refreshConnectionHealth, 3000);
}

function stopHeartbeat() {
  clearInterval(store.pingTimer);
  clearInterval(store.peerReapTimer);
  clearInterval(store.connCheckTimer);
  store.pingTimer = store.peerReapTimer = store.connCheckTimer = null;
}

// Make this follower mirror a peer's playback. `peer` comes from presence state.
export function mirrorPeer(peer) {
  if (!peer.track_id) return;
  const idx = store.queue.findIndex((t) => t.id === peer.track_id);
  if (idx === -1) {
    // The leader is on a track this device hasn't loaded yet (e.g. it was just
    // added and the tracks Realtime subscription hasn't delivered it). Surface a
    // visible, non-blocking banner instead of silently doing nothing, so the
    // failure mode is debuggable. It clears itself once the track arrives.
    if (!store.pendingSyncMsg) { store.pendingSyncMsg = 'Waiting for a track to sync…'; render(); }
    return;
  }
  if (store.pendingSyncMsg) { store.pendingSyncMsg = ''; render(); }
  // elapsed uses each device's local clock (peer.updated_at is stamped on the
  // sender). Clock skew between devices can make this wildly wrong, so clamp it
  // to a sane max (a legit gap between updates is small — we broadcast ~every 2s
  // while playing). The periodic drift-correction below then converges it.
  const rawElapsed = peer.is_playing ? (Date.now() - (peer.updated_at || Date.now())) / 1000 : 0;
  const elapsed = Math.min(Math.max(rawElapsed, 0), 10);
  const targetTime = (peer.position_seconds || 0) + elapsed;

  if (store.currentIndex !== idx) {
    loadTrack(idx, peer.is_playing, targetTime);
    return;
  }
  if (peer.is_playing && !store.isPlaying) {
    audio.currentTime = targetTime;
    audio.play()
      .then(() => { store.isPlaying = true; store.autoplayBlocked = false; render(); })
      // A mirrored play() (no direct user gesture) can be rejected by the
      // browser's autoplay policy. Surface a "Tap to join playback" button
      // whose click handler calls audio.play() from a real gesture.
      .catch(() => { store.autoplayBlocked = true; render(); });
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
  }, 2000);
  broadcastPresence(true);
  render();
}

export function stopFollowing() {
  store.followingId = null;
  store.pendingSyncMsg = '';
  store.autoplayBlocked = false;
  clearInterval(store.followDriftTimer);
  broadcastPresence(true);
  render();
}

// --- Host mode (one-to-many) --------------------------------------------------
// A host advertises `hosting: true` room-wide; anyone can join (which is just
// startFollowing(hostId)) and the host's controls then drive every joiner at
// once. This reuses the existing leader-broadcasts / follower-mirrors machinery
// — a host is simply a leader that announced itself so joiners get one clear
// "Join session" button instead of per-peer follow buttons.
export function becomeHost() {
  if (store.followingId) stopFollowing(); // can't host while mirroring someone else
  store.isHost = true;
  broadcastPresence(true);
  // Immediate, non-throttled announcement so the "Join session" button appears
  // on peers at once (presence .track() alone can lag or be dropped).
  channelSend({ type: 'broadcast', event: 'hosting', payload: { id: DEVICE_ID, hosting: true, nickname: store.nickname } });
  render();
}

export function stopHosting() {
  store.isHost = false;
  broadcastPresence(true);
  channelSend({ type: 'broadcast', event: 'hosting', payload: { id: DEVICE_ID, hosting: false, nickname: store.nickname } });
  render();
}

export function joinHost(hostId) {
  if (store.isHost) stopHosting(); // stop advertising our own session when we join another
  startFollowing(hostId);
}
