// Lock-screen / OS media controls via the Media Session API. Android, iOS,
// macOS, and Windows surface track metadata plus transport buttons (play,
// pause, next, previous, seek) here while audio plays. Control callbacks are
// injected from player.js so this module stays free of playback internals and
// there is no circular import with player.js.
let handlers = null;

export function initMediaSession(cbs) {
  handlers = cbs;
  if (!('mediaSession' in navigator)) return;

  const ms = navigator.mediaSession;
  const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (e) {} };

  set('play', () => handlers.onPlay && handlers.onPlay());
  set('pause', () => handlers.onPause && handlers.onPause());
  set('previoustrack', () => handlers.onPrev && handlers.onPrev());
  set('nexttrack', () => handlers.onNext && handlers.onNext());
  set('seekbackward', (d) => handlers.onSeek && handlers.onSeek(-(d.seekOffset || 10)));
  set('seekforward', (d) => handlers.onSeek && handlers.onSeek(d.seekOffset || 10));
  set('stop', () => handlers.onPause && handlers.onPause());
}

export function updateMetadata(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Untitled track',
      artist: track.host || 'Santoor',
      album: 'Santoor',
      artwork: [
        { src: new URL('icons/icon-192.png', location.href).href, sizes: '192x192', type: 'image/png' },
        { src: new URL('icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }
      ]
    });
  } catch (e) {}
}

export function updatePlaybackState(isPlaying) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

export function updatePositionState(positionSec, durationSec) {
  if (!('mediaSession' in navigator)) return;
  if (!durationSec || !isFinite(durationSec) || durationSec <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      playbackRate: 1,
      position: Math.min(Math.max(positionSec, 0), durationSec)
    });
  } catch (e) {}
}
