// Shared, mutable app state. Every module imports this single object and
// reads/writes its fields, which avoids ES-module live-binding pitfalls for
// primitives (loop, followingId, etc.) and keeps cross-module state in one place.

export const audio = new Audio();
audio.preload = 'metadata';

export const DEVICE_ID = 'dev-' + Math.random().toString(36).slice(2, 8);

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
  errorMsg: '',
  isOnline: navigator.onLine,
  loading: true,
  loop: false,
  nickname: '',
};
