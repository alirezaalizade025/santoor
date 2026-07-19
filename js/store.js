// Shared, mutable app state. Every module imports this single object and
// reads/writes its fields, which avoids ES-module live-binding pitfalls for
// primitives (loop, followingId, etc.) and keeps cross-module state in one place.

export const audio = new Audio();
audio.preload = 'metadata';

// Stable per-device id, persisted in localStorage so it survives reloads and
// two tabs on the same phone count as one device (not two phantom listeners).
// Falls back to an in-memory id if storage is unavailable (private mode, etc.).
function loadDeviceId() {
  try {
    const saved = localStorage.getItem('santoor:device-id');
    if (saved) return saved;
  } catch (e) {}
  const id = 'dev-' + Math.random().toString(36).slice(2, 10);
  try { localStorage.setItem('santoor:device-id', id); } catch (e) {}
  return id;
}

export const DEVICE_ID = loadDeviceId();

export const store = {
  db: null,
  dbReady: false,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  pendingSeek: null,
  saveTimer: null,
  presenceChannel: null,
  onlineUsers: [],
  peerLastSeen: {},        // id -> last ping/pong timestamp (ms), for real-time disconnect detection
  connectionHealthy: true, // our own Realtime socket state
  followingId: null,
  followDriftTimer: null,
  presenceUpdateTimer: null,
  pingTimer: null,         // sends our heartbeat ping
  peerReapTimer: null,     // removes peers that stopped responding
  connCheckTimer: null,    // watches our own connection
  pendingRemote: null,
  pendingSyncMsg: '', // set when mirrorPeer can't find a peer's track locally yet
  autoplayBlocked: false, // set when a mirrored play() is rejected by autoplay policy
  errorMsg: '',
  isOnline: navigator.onLine,
  loading: true,
  loop: false,
  nickname: '',
  nowPlayingOpen: false, // full-screen Now Playing view visibility
  addingTrack: false,    // true while a pasted URL is being probed before insert
};
