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

// Well-known Default playlist id (matches supabase-setup.sql). Pre-playlist
// tracks and the legacy single player_state row migrate onto this playlist.
export const DEFAULT_PLAYLIST_ID = '00000000-0000-0000-0000-000000000001';

// Remember the last selected playlist per device so a reload reopens it.
function loadActivePlaylist() {
  try { return localStorage.getItem('santoor:playlist') || DEFAULT_PLAYLIST_ID; } catch (e) { return DEFAULT_PLAYLIST_ID; }
}

// Per-device volume (0..1). A local playback preference — intentionally NOT
// synced across "Listen together", unlike position/play-state. Persisted so it
// survives reloads.
function loadVolume() {
  try {
    const v = parseFloat(localStorage.getItem('santoor:volume'));
    if (isFinite(v) && v >= 0 && v <= 1) return v;
  } catch (e) {}
  return 1;
}
export const initialVolume = loadVolume();
audio.volume = initialVolume;

export const store = {
  db: null,
  dbReady: false,
  dbError: null,                           // 'missing-config' | 'lib-unavailable' | 'init-failed' | null
  playlists: [],                         // [{id,name,created_at}]
  activePlaylistId: loadActivePlaylist(), // which playlist's queue is shown
  playlistsSupported: true,              // false if the playlists table isn't set up yet
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
  isHost: false,           // when true, we advertise a room-wide "join my session" host
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
  loop: false,            // legacy alias kept in sync with repeatMode === 'all'
  repeatMode: 'off',      // 'off' | 'all' | 'one'
  shuffle: false,         // when true, next()/auto-advance pick a random unplayed track
  shuffleHistory: [],     // queue indices already played this shuffle cycle
  nickname: '',
  nowPlayingOpen: false, // full-screen Now Playing view visibility
  addingTrack: false,    // true while a pasted URL is being probed before insert
  volume: initialVolume, // per-device, not synced
  history: loadHistory(),   // recently played: [{id,title,host,url,at}], newest first, per-device
  historyOpen: false,       // recently-played section expanded

  // Castbox tab state. The tab reuses the existing queue/player for playback;
  // these fields only drive the search/selection UI.
  activeTab: 'player',      // 'player' | 'castbox'
  castboxChannels: [],      // selected channels: [{id,castbox_id,title,author,rss_url,artwork_url,description,created_at}]
  castboxResults: [],       // last search results: [{id,title,author,artwork,feedUrl,description}]
  castboxEpisodes: {},      // channelId -> [{title,url,type,durationSeconds,publishedAt}]
  castboxLoading: false,    // true while a search/resolve is in flight
  castboxQuery: '',         // current search input value (preserved across re-renders)
  castboxOpenChannel: null, // channel row currently expanded to show episodes
};

// Recently-played history is a local, per-device list (not shared queue state),
// so it lives in localStorage. Newest first, capped.
function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('santoor:history') || '[]');
    if (Array.isArray(raw)) return raw.slice(0, 50);
  } catch (e) {}
  return [];
}
