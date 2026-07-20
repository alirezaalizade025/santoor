// View layer: builds the entire UI into #santoor-root and wires DOM events.
import { store, DEVICE_ID } from './store.js';
import { fmtTime, escapeHtml } from './util.js';
import { togglePlay, toggleLoop, cycleRepeat, toggleShuffle, next, prev, seekTo, addTrack, removeTrack, applyRemote, loadTrack, persistPosition, joinPlayback, setVolume, playFromHistory, clearHistory, switchPlaylist, addPlaylist, removePlaylist } from './player.js';
import { startFollowing, stopFollowing, broadcastPresence, becomeHost, stopHosting, joinHost } from './presence.js';
import { saveNickname } from './identity.js';
import { isWaveformActive } from './waveform.js';
import {
  switchTab, searchCastbox, addCastboxChannel, openCastboxChannel,
  playCastboxEpisode, addCastboxEpisodeToQueue, removeCastboxChannel,
} from './castbox.js';

const root = document.getElementById('santoor-root');

// Truthful message for the "database not ready" banner so the user can tell
// whether they forgot to add keys vs. the Supabase CDN being blocked/offline.
function dbNotReadyMessage() {
  if (store.dbError === 'lib-unavailable') {
    return 'Couldn’t load the Supabase client library (CDN blocked or offline). Check your connection and reload.';
  }
  if (store.dbError === 'init-failed') {
    return 'Supabase client failed to initialize — check the browser console and your keys.';
  }
  return 'Add your Supabase URL and anon key to supabase-config.js, then reload — see README.md for the 5-minute setup.';
}

export function render() {
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  // Never keep the full-screen view open with nothing to show.
  if (store.nowPlayingOpen && !track) store.nowPlayingOpen = false;
  const nickEl = document.getElementById('cn-nickname-input');
  const nickVal = (nickEl && document.activeElement === nickEl) ? nickEl.value : store.nickname;
  // Preserve the URL input's focus and in-progress text across re-renders.
  // Playback fires render() on every timeupdate, which would otherwise wipe
  // the field and steal focus while the user is typing a new track URL.
  const urlEl = document.getElementById('cn-url-input');
  const urlFocused = urlEl && document.activeElement === urlEl;
  const urlVal = urlFocused ? urlEl.value : '';
  const selStart = urlFocused ? urlEl.selectionStart : null;
  const selEnd = urlFocused ? urlEl.selectionEnd : null;
  // Preserve the Castbox search input's focus/value too (same reason as above).
  const cbEl = document.getElementById('cb-search');
  const cbFocused = cbEl && document.activeElement === cbEl;
  const cbVal = cbFocused ? cbEl.value : store.castboxQuery;
  const progressPct = store.duration ? (store.currentTime / store.duration) * 100 : 0;
  // When the real-signal AnalyserNode is driving the waveform, render flat bars
  // that waveform.js animates directly (its RAF loop overwrites the heights). If
  // the source is CORS-tainted (silent analyser) or unsupported, fall back to the
  // decorative sine-wave bars keyed to progress.
  const liveWave = isWaveformActive();
  const bars = Array.from({ length: 40 }).map((_, i) => {
    if (liveWave) return `<div class="cn-bar" style="height:6%"></div>`;
    const isActive = (i / 40) * 100 <= progressPct;
    const h = 20 + Math.round(Math.abs(Math.sin(i * 12.9)) * 80);
    return `<div class="cn-bar ${isActive ? 'active' : ''} ${store.isPlaying && isActive ? 'playing' : ''}" style="height:${h}%; animation-delay:${(i % 6) * 0.08}s"></div>`;
  }).join('');

  const syncLabel = store.dbReady ? 'Synced via database' : 'Database not configured';
  const socketLabel = !store.dbReady
    ? 'Realtime off'
    : !store.isOnline
      ? 'Offline'
      : store.connectionHealthy
        ? 'Live'
        : 'Reconnecting…';
  const socketClass = !store.dbReady || !store.isOnline || !store.connectionHealthy ? 'off' : 'live';
  const followingPeer = store.followingId ? store.onlineUsers.find((u) => u.id === store.followingId) : null;
  const followers = store.onlineUsers.filter((u) => u.following_id === DEVICE_ID);
  // Host mode: another peer advertising a session to join (we're not already in it).
  const hostPeer = store.onlineUsers.find((u) => u.hosting && u.id !== store.followingId);

  root.innerHTML = `
    <div class="cn-wrap">
      <div class="cn-header">
        <h1 class="cn-title">Santoor<span class="dot">.</span></h1>
        <div class="cn-status-group">
          <div class="cn-sync-status"><span class="cn-pulse ${store.isPlaying && store.dbReady ? 'live' : 'off'}"></span>${syncLabel}</div>
          <div class="cn-socket-status" title="Realtime socket connection status">
            <span class="cn-pulse ${socketClass}"></span>${socketLabel}
          </div>
        </div>
      </div>

      <div class="cn-tabbar">
        <button class="cn-tab ${store.activeTab === 'player' ? 'active' : ''}" id="cn-tab-player" data-tab="player">Player</button>
        <button class="cn-tab ${store.activeTab === 'castbox' ? 'active' : ''}" id="cn-tab-castbox" data-tab="castbox">Castbox</button>
      </div>

      ${!store.dbReady ? `<div class="cn-offline-banner">${dbNotReadyMessage()}</div>` : ''}
      ${!store.isOnline ? `<div class="cn-offline-banner">You're offline — reconnect to add tracks or sync playback.</div>` : ''}
      ${store.dbReady && store.isOnline && !store.connectionHealthy ? `<div class="cn-offline-banner">Live connection lost — reconnecting…</div>` : ''}

      ${store.dbReady ? `
        <div class="cn-presence-row">
          <span class="cn-presence-count">🟢 ${store.onlineUsers.length + 1} listening now</span>
           <input class="cn-nickname-input" id="cn-nickname-input" value="${escapeHtml(nickVal)}" maxlength="24" title="Your display name" />
        </div>
        ${!store.followingId ? `
          <div class="cn-host-row">
            <button class="cn-btn-small ${store.isHost ? 'cn-btn-active' : ''}" id="cn-host-toggle" title="${store.isHost ? 'Stop hosting your session' : 'Host a session others can join — your controls drive everyone'}">
              ${store.isHost ? 'Hosting — Stop' : 'Host a session'}
            </button>
            ${store.isHost && followers.length > 0 ? `<span class="cn-host-count">${followers.length} joined</span>` : ''}
          </div>
        ` : ''}
      ` : ''}

      ${hostPeer && !store.isHost ? `
        <div class="cn-banner cn-followed-banner">
          <div class="cn-banner-text">${escapeHtml(hostPeer.nickname || 'Someone')} is hosting a session</div>
          <div class="cn-banner-actions">
            <button class="cn-btn-small" id="cn-join-host" data-host="${hostPeer.id}">Join session</button>
          </div>
        </div>
      ` : ''}

      ${followers.length > 0 ? `
        <div class="cn-banner cn-followed-banner">
          <div class="cn-banner-text">${followers.length === 1
            ? escapeHtml(followers[0].nickname) + ' is listening together with you'
            : followers.length + ' people are listening together with you'}</div>
        </div>
      ` : ''}

      ${followingPeer ? `
        <div class="cn-banner">
          <div class="cn-banner-text">Listening together with ${escapeHtml(followingPeer.nickname)} — controls are locked to stay in sync</div>
          <div class="cn-banner-actions">
            <button class="cn-btn-small" id="cn-stop-following">Stop</button>
          </div>
        </div>
      ` : ''}

      ${store.autoplayBlocked ? `
        <div class="cn-banner">
          <div class="cn-banner-text">Playback is ready but your browser blocked autoplay.</div>
          <div class="cn-banner-actions">
            <button class="cn-btn-small" id="cn-join-playback">Tap to join playback</button>
          </div>
        </div>
      ` : ''}

      ${store.pendingSyncMsg ? `
        <div class="cn-banner">
          <div class="cn-banner-text">${escapeHtml(store.pendingSyncMsg)}</div>
        </div>
      ` : ''}

      ${store.pendingRemote ? `
        <div class="cn-banner">
          <div class="cn-banner-text">Playing on another device — at ${fmtTime(store.pendingRemote.position_seconds || 0)}</div>
          <div class="cn-banner-actions">
            <button class="cn-btn-small" id="cn-resume-remote">Resume here</button>
            <button class="cn-btn-small" id="cn-dismiss-remote">Dismiss</button>
          </div>
        </div>
      ` : ''}

      ${store.dbReady && store.playlistsSupported ? `
        <div class="cn-playlist-row">
          <label class="cn-playlist-label" for="cn-playlist-select">Playlist</label>
          <select class="cn-playlist-select" id="cn-playlist-select" aria-label="Active playlist">
            ${store.playlists.map((p) => `<option value="${p.id}" ${p.id === store.activePlaylistId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <button class="cn-btn-small" id="cn-playlist-new" title="Create a new playlist">+ New</button>
          ${store.activePlaylistId !== '00000000-0000-0000-0000-000000000001'
            ? `<button class="cn-btn-small" id="cn-playlist-del" title="Delete this playlist and all its tracks">Delete</button>`
            : ''}
        </div>
      ` : ''}

      ${store.activeTab === 'player' ? `
      <div class="cn-input-row">
        <input class="cn-input" id="cn-url-input" aria-label="Track URL" placeholder="Paste a track URL (https://...)" value="${escapeHtml(urlVal)}" ${store.dbReady && !store.addingTrack ? '' : 'disabled'} />
        <button class="cn-add-btn" id="cn-add-btn" ${store.dbReady && !store.addingTrack ? '' : 'disabled'}>${store.addingTrack ? 'Checking…' : 'Add'}</button>
      </div>
      ${store.errorMsg ? `<div class="cn-error">${escapeHtml(store.errorMsg)}</div>` : ''}

      <div class="cn-player">
        <div class="cn-now-playing ${track ? 'cn-now-playing-tappable' : ''}" id="cn-now-playing" ${track ? 'role="button" tabindex="0" aria-label="Open now playing"' : ''}>
          <div class="cn-art ${store.isPlaying ? 'spinning' : ''}"></div>
          <div class="cn-track-info">
            ${track ? `
              <div class="cn-track-title">${escapeHtml(track.title || 'Untitled track')}</div>
              <div class="cn-track-sub">${escapeHtml(track.host || '')}</div>
            ` : `<div class="cn-empty-state">${store.loading ? 'Loading your queue…' : 'Paste a URL above to start listening'}</div>`}
          </div>
        </div>

        <div class="cn-waveform ${liveWave ? 'cn-waveform-live' : ''}">${bars}</div>

        <div class="cn-progress-row">
          <span class="cn-time">${fmtTime(store.currentTime)}</span>
          <div class="cn-progress-track" id="cn-progress-track">
            <div class="cn-progress-fill" style="width:${progressPct}%"></div>
            <div class="cn-progress-handle" style="left:${progressPct}%"></div>
          </div>
          <span class="cn-time">${fmtTime(store.duration)}</span>
        </div>

        <div class="cn-controls">
          <button class="cn-ctrl-btn ${store.shuffle ? 'cn-loop-active' : ''}" id="cn-shuffle" ${store.followingId ? 'disabled' : ''} title="Shuffle" aria-label="Shuffle" aria-pressed="${store.shuffle ? 'true' : 'false'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.6 8.6L6.4 4.4 5 5.8l4.2 4.2 1.4-1.4zM14.5 5l1.9 1.9L4 19.3 5.4 20.7 17.8 8.3 19.7 10.2V5h-5.2zM13.4 15.4l-1.4 1.4 2.9 2.9H14.5v0h5.2v-5.2l-1.9 1.9-4.4-4.4z"/></svg>
          </button>
          <button class="cn-ctrl-btn" id="cn-prev" ${store.currentIndex <= 0 && store.currentTime <= 3 || store.followingId ? 'disabled' : ''} title="Previous" aria-label="Previous track">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="cn-ctrl-btn cn-play-btn" id="cn-play" ${store.currentIndex === -1 || store.followingId ? 'disabled' : ''} title="Play/Pause" aria-label="${store.isPlaying ? 'Pause' : 'Play'}">
            ${store.isPlaying
              ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`
              : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`}
          </button>
          <button class="cn-ctrl-btn" id="cn-next" ${store.currentIndex === -1 || store.followingId ? 'disabled' : ''} title="Next" aria-label="Next track">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>
          </button>
          <button class="cn-ctrl-btn ${store.repeatMode !== 'off' ? 'cn-loop-active' : ''} ${store.repeatMode === 'one' ? 'cn-repeat-one' : ''}" id="cn-repeat" ${store.followingId ? 'disabled' : ''} title="${store.repeatMode === 'one' ? 'Repeat one' : store.repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}" aria-label="${store.repeatMode === 'one' ? 'Repeat one' : store.repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          </button>
        </div>

        <div class="cn-volume-row">
          <svg class="cn-volume-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4.03v8.06A4.5 4.5 0 0016.5 12z"/></svg>
          <input class="cn-volume" id="cn-volume" type="range" min="0" max="1" step="0.01" value="${store.volume}" aria-label="Volume" title="Volume (this device only)" />
        </div>
      </div>

      ${store.dbReady && store.onlineUsers.length > 0 ? `
        <div class="cn-section-label">Listening now</div>
        <div class="cn-listeners">
          ${store.onlineUsers.map((u) => {
            // Prevent a mutual follow loop: if this peer is already following us,
            // both players would lock onto each other and drift. Disable our
            // button toward them and explain why. (Deliberate: one-directional.)
            const followsMe = u.following_id === DEVICE_ID;
            const isFollowing = store.followingId === u.id;
            const disabled = followsMe && !isFollowing;
            return `
            <div class="cn-listener-item">
              <span class="cn-listener-dot"></span>
              <div class="cn-listener-info">
                <div class="cn-listener-name">${escapeHtml(u.nickname || 'Listener')}</div>
                <div class="cn-listener-status">${u.track_title ? (u.is_playing ? 'Playing — ' : 'Paused — ') + escapeHtml(u.track_title) : 'Idle'}</div>
              </div>
              <button class="cn-btn-small ${isFollowing ? 'cn-btn-active' : ''}" data-follow="${u.id}" ${disabled ? 'disabled' : ''} title="${disabled ? 'They\'re already listening together with you' : 'Mirror this listener\'s playback'}">
                ${isFollowing ? 'Following' : (disabled ? 'Listening with you' : 'Listen together')}
              </button>
            </div>
          `;
          }).join('')}
        </div>
      ` : ''}

      <div class="cn-section-label">Queue — ${store.queue.length} track${store.queue.length === 1 ? '' : 's'}</div>
      <div class="cn-queue">
        ${store.queue.length === 0 ? `<div class="cn-empty-queue">${store.loading ? 'Loading…' : 'No tracks yet'}</div>` : store.queue.map((t, i) => `
          <div class="cn-queue-item ${i === store.currentIndex ? 'active' : ''}" data-idx="${i}">
            <span class="cn-queue-idx">${(i + 1).toString().padStart(2, '0')}</span>
            <span class="cn-queue-title">${escapeHtml(t.title || 'Untitled track')}</span>
            ${t.duration_seconds ? `<span class="cn-queue-dur">${fmtTime(t.duration_seconds)}</span>` : ''}
            <button class="cn-queue-remove" data-remove="${t.id}" title="Remove" aria-label="Remove ${escapeHtml(t.title || 'track')} from queue">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.3 5.71L12 12.01l-6.3-6.3-1.41 1.42 6.3 6.29-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/></svg>
            </button>
          </div>
        `).join('')}
      </div>

      ${store.history.length > 0 ? `
        <div class="cn-section-label cn-history-label" id="cn-history-toggle" role="button" tabindex="0" aria-expanded="${store.historyOpen ? 'true' : 'false'}">
          <span>Recently played — ${store.history.length}</span>
          <span class="cn-history-caret">${store.historyOpen ? '▾' : '▸'}</span>
        </div>
        ${store.historyOpen ? `
          <div class="cn-queue cn-history">
            ${store.history.map((h) => `
              <div class="cn-queue-item cn-history-item" data-hist="${h.id}" role="button" tabindex="0" title="Play ${escapeHtml(h.title || 'track')}">
                <span class="cn-queue-idx">↺</span>
                <span class="cn-queue-title">${escapeHtml(h.title || 'Untitled track')}</span>
                <span class="cn-queue-dur">${escapeHtml(h.host || '')}</span>
              </div>
            `).join('')}
            <button class="cn-btn-small cn-history-clear" id="cn-history-clear">Clear history</button>
          </div>
        ` : ''}
      ` : ''}

      ${store.activeTab === 'castbox' ? castboxView() : ''}
    </div>

    ${store.nowPlayingOpen ? `
      <div class="cn-np" id="cn-np">
        <button class="cn-np-close" id="cn-np-close" aria-label="Close now playing">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7.4 6l-1.4 1.4 4.6 4.6-4.6 4.6L7.4 18l4.6-4.6 4.6 4.6 1.4-1.4-4.6-4.6 4.6-4.6L16.6 6 12 10.6z"/></svg>
        </button>

        <div class="cn-np-tapzones">
          <button class="cn-np-tap cn-np-tap-prev" id="cn-np-prev" ${(store.currentIndex <= 0 && store.currentTime <= 3) || store.followingId ? 'disabled' : ''} aria-label="Previous track">
            <span class="cn-np-tap-hint"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg><span>Previous</span></span>
          </button>
          <button class="cn-np-tap cn-np-tap-next" id="cn-np-next" ${store.currentIndex === -1 || store.followingId ? 'disabled' : ''} aria-label="Next track">
            <span class="cn-np-tap-hint"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg><span>Next</span></span>
          </button>
        </div>

        <div class="cn-np-meta">
          <div class="cn-np-title">${track ? escapeHtml(track.title || 'Untitled track') : 'Nothing playing'}</div>
          <div class="cn-np-sub">${track ? escapeHtml(track.host || '') : 'Paste a URL to start'}</div>
        </div>

        <button class="cn-np-play" id="cn-np-play" ${store.currentIndex === -1 || store.followingId ? 'disabled' : ''} aria-label="${store.isPlaying ? 'Pause' : 'Play'}">
          ${store.isPlaying
            ? `<svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`
            : `<svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}
        </button>

        <div class="cn-np-timer">
          <span class="cn-np-time-cur">${fmtTime(store.currentTime)}</span>
          <span class="cn-np-time-sep">/</span>
          <span class="cn-np-time-dur">${fmtTime(store.duration)}</span>
        </div>

        <div class="cn-np-progress" id="cn-np-progress">
          <div class="cn-np-progress-fill" style="width:${progressPct}%"></div>
        </div>
      </div>
    ` : ''}
  `;
  attachHandlers(urlFocused, selStart, selEnd);
}

// Castbox tab: search box, results, and previously-selected channels with their
// episodes. Playback is delegated to player.js via the handlers below.
function castboxView() {
  const results = store.castboxResults.map((r) => `
    <div class="cn-queue-item cb-result">
      ${r.artwork ? `<img class="cb-art" src="${escapeHtml(r.artwork)}" alt="" loading="lazy" />` : `<div class="cb-art cb-art-empty"></div>`}
      <div class="cb-result-info">
        <div class="cn-queue-title">${escapeHtml(r.title || 'Untitled channel')}</div>
        <div class="cn-queue-dur">${escapeHtml(r.author || '')}</div>
      </div>
      <button class="cn-btn-small cb-add-channel" data-feed="${escapeHtml(r.feedUrl)}" data-title="${escapeHtml(r.title || '')}" data-author="${escapeHtml(r.author || '')}" data-art="${escapeHtml(r.artwork || '')}">Add</button>
    </div>
  `).join('');

  const channels = store.castboxChannels.map((c) => {
    const open = store.castboxOpenChannel === c.id;
    const eps = store.castboxEpisodes[c.id] || [];
    const episodesHtml = open ? `
      <div class="cn-queue cn-history">
        ${store.castboxLoading && !eps.length ? `<div class="cn-empty-queue">Loading episodes…</div>` :
          eps.length ? eps.map((e, i) => `
            <div class="cn-queue-item cb-episode">
              <span class="cn-queue-idx">${(i + 1).toString().padStart(2, '0')}</span>
              <span class="cn-queue-title">${escapeHtml(e.title || 'Untitled episode')}</span>
              ${e.durationSeconds ? `<span class="cn-queue-dur">${fmtTime(e.durationSeconds)}</span>` : ''}
              <button class="cn-btn-small cb-play-ep" data-ch="${c.id}" data-i="${i}">Play</button>
              <button class="cn-btn-small cb-add-ep" data-ch="${c.id}" data-i="${i}">+ Queue</button>
            </div>
          `).join('') : `<div class="cn-empty-queue">No episodes found</div>`}
      </div>` : '';
    return `
      <div class="cn-queue-item cb-channel ${open ? 'active' : ''}" data-ch-open="${c.id}" role="button" tabindex="0" title="Toggle episodes">
        ${c.artwork_url ? `<img class="cb-art" src="${escapeHtml(c.artwork_url)}" alt="" loading="lazy" />` : `<div class="cb-art cb-art-empty"></div>`}
        <div class="cb-result-info">
          <div class="cn-queue-title">${escapeHtml(c.title || 'Untitled channel')}</div>
          <div class="cn-queue-dur">${escapeHtml(c.author || '')}</div>
        </div>
        <button class="cn-queue-remove cb-del-channel" data-del-ch="${c.id}" title="Remove channel" aria-label="Remove channel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.3 5.71L12 12.01l-6.3-6.3-1.41 1.42 6.3 6.29-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/></svg>
        </button>
      </div>
      ${episodesHtml}
    `;
  }).join('');

  return `
    <div class="cn-input-row">
      <input class="cn-input" id="cb-search" aria-label="Search Castbox" placeholder="Search podcasts…" value="${escapeHtml(cbVal)}" ${store.dbReady ? '' : 'disabled'} />
      <button class="cn-add-btn" id="cb-search-btn" ${store.dbReady ? '' : 'disabled'}>${store.castboxLoading ? '…' : 'Search'}</button>
    </div>

    ${store.castboxResults.length > 0 ? `
      <div class="cn-section-label">Search results</div>
      <div class="cn-queue">${results}</div>
    ` : ''}

    <div class="cn-section-label">Selected channels — ${store.castboxChannels.length}</div>
    ${store.castboxChannels.length === 0
      ? `<div class="cn-empty-queue">${store.loading ? 'Loading…' : 'No channels yet — search above and tap Add'}</div>`
      : `<div class="cn-queue">${channels}</div>`}
  `;
}

function attachHandlers(urlFocused, selStart, selEnd) {
  const urlInput = document.getElementById('cn-url-input');
  const addBtn = document.getElementById('cn-add-btn');
  if (addBtn) addBtn.onclick = () => { addTrack(urlInput.value); urlInput.value = ''; };
  if (urlInput) {
    if (urlFocused && document.activeElement !== urlInput) {
      urlInput.focus();
      if (selStart !== null) urlInput.setSelectionRange(selStart, selEnd);
    }
    urlInput.onkeydown = (e) => { if (e.key === 'Enter') { addTrack(urlInput.value); urlInput.value = ''; } };
  }

  // --- Tab bar ---
  document.querySelectorAll('.cn-tab').forEach((el) => {
    el.onclick = () => switchTab(el.getAttribute('data-tab'));
  });

  // --- Castbox tab ---
  const cbSearch = document.getElementById('cb-search');
  if (cbSearch) {
    if (cbFocused && document.activeElement !== cbSearch) {
      cbSearch.focus();
    }
    const doSearch = () => searchCastbox(cbSearch.value);
    cbSearch.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
  }
  const cbSearchBtn = document.getElementById('cb-search-btn');
  if (cbSearchBtn) cbSearchBtn.onclick = () => searchCastbox(document.getElementById('cb-search')?.value || '');

  document.querySelectorAll('.cb-add-channel').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      addCastboxChannel({
        feedUrl: el.getAttribute('data-feed'),
        title: el.getAttribute('data-title'),
        author: el.getAttribute('data-author'),
        artwork: el.getAttribute('data-art'),
      });
    });
  });
  document.querySelectorAll('[data-ch-open]').forEach((el) => {
    const go = () => openCastboxChannel(el.getAttribute('data-ch-open'));
    el.addEventListener('click', (e) => { if (e.target.closest('[data-del-ch]')) return; go(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  document.querySelectorAll('[data-del-ch]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); removeCastboxChannel(el.getAttribute('data-del-ch')); });
  });
  document.querySelectorAll('.cb-play-ep').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); playCastboxEpisode(el.getAttribute('data-ch'), parseInt(el.getAttribute('data-i'), 10)); });
  });
  document.querySelectorAll('.cb-add-ep').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); addCastboxEpisodeToQueue(el.getAttribute('data-ch'), parseInt(el.getAttribute('data-i'), 10)); });
  });

  const playBtn = document.getElementById('cn-play'); if (playBtn) playBtn.onclick = togglePlay;
  const prevBtn = document.getElementById('cn-prev'); if (prevBtn) prevBtn.onclick = prev;
  const nextBtn = document.getElementById('cn-next'); if (nextBtn) nextBtn.onclick = next;
  const repeatBtn = document.getElementById('cn-repeat'); if (repeatBtn) repeatBtn.onclick = cycleRepeat;
  const shuffleBtn = document.getElementById('cn-shuffle'); if (shuffleBtn) shuffleBtn.onclick = toggleShuffle;

  const progressTrack = document.getElementById('cn-progress-track');
  if (progressTrack) progressTrack.onclick = (e) => { const rect = progressTrack.getBoundingClientRect(); seekTo((e.clientX - rect.left) / rect.width); };

  document.querySelectorAll('.cn-queue-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]')) return;
      if (store.followingId) return;
      loadTrack(parseInt(el.getAttribute('data-idx'), 10), true);
      persistPosition(true);
      broadcastPresence(true);
    });
  });
  document.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); removeTrack(el.getAttribute('data-remove')); });
  });

  const resumeBtn = document.getElementById('cn-resume-remote'); if (resumeBtn) resumeBtn.onclick = () => applyRemote(store.pendingRemote, true);
  const dismissBtn = document.getElementById('cn-dismiss-remote'); if (dismissBtn) dismissBtn.onclick = () => { store.pendingRemote = null; render(); };

  const nicknameInput = document.getElementById('cn-nickname-input');
  if (nicknameInput) {
    nicknameInput.onchange = () => {
      store.nickname = nicknameInput.value.trim() || store.nickname;
      saveNickname(store.nickname);
      broadcastPresence(true);
    };
  }
  document.querySelectorAll('[data-follow]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-follow');
      store.followingId === id ? stopFollowing() : startFollowing(id);
    });
  });
  const stopBtn = document.getElementById('cn-stop-following'); if (stopBtn) stopBtn.onclick = stopFollowing;
  const joinBtn = document.getElementById('cn-join-playback'); if (joinBtn) joinBtn.onclick = joinPlayback;

  const playlistSelect = document.getElementById('cn-playlist-select');
  if (playlistSelect) playlistSelect.onchange = () => switchPlaylist(playlistSelect.value);
  const playlistNew = document.getElementById('cn-playlist-new');
  if (playlistNew) playlistNew.onclick = () => { const name = window.prompt('Name for the new playlist:'); if (name) addPlaylist(name); };
  const playlistDel = document.getElementById('cn-playlist-del');
  if (playlistDel) playlistDel.onclick = () => {
    const p = store.playlists.find((x) => x.id === store.activePlaylistId);
    if (window.confirm('Delete "' + (p ? p.name : 'this playlist') + '" and all its tracks? This cannot be undone.')) removePlaylist(store.activePlaylistId);
  };

  const hostToggle = document.getElementById('cn-host-toggle');
  if (hostToggle) hostToggle.onclick = () => (store.isHost ? stopHosting() : becomeHost());
  const joinHostBtn = document.getElementById('cn-join-host');
  if (joinHostBtn) joinHostBtn.onclick = () => joinHost(joinHostBtn.getAttribute('data-host'));

  const volume = document.getElementById('cn-volume');
  if (volume) volume.oninput = (e) => setVolume(parseFloat(e.target.value));

  const historyToggle = document.getElementById('cn-history-toggle');
  if (historyToggle) {
    const toggle = () => { store.historyOpen = !store.historyOpen; render(); };
    historyToggle.onclick = toggle;
    historyToggle.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  }
  document.querySelectorAll('[data-hist]').forEach((el) => {
    const go = () => playFromHistory(el.getAttribute('data-hist'));
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const histClear = document.getElementById('cn-history-clear');
  if (histClear) histClear.onclick = (e) => { e.stopPropagation(); clearHistory(); };

  // --- Now Playing full-screen view ---
  const openNp = () => { if (store.currentIndex !== -1) { store.nowPlayingOpen = true; render(); } };
  const nowPlaying = document.getElementById('cn-now-playing');
  if (nowPlaying) {
    nowPlaying.onclick = openNp;
    nowPlaying.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNp(); } };
  }
  const npClose = document.getElementById('cn-np-close'); if (npClose) npClose.onclick = () => { store.nowPlayingOpen = false; render(); };
  const npPlay = document.getElementById('cn-np-play'); if (npPlay) npPlay.onclick = togglePlay;
  const npPrev = document.getElementById('cn-np-prev'); if (npPrev) npPrev.onclick = prev;
  const npNext = document.getElementById('cn-np-next'); if (npNext) npNext.onclick = next;
  const npProgress = document.getElementById('cn-np-progress');
  if (npProgress) npProgress.onclick = (e) => { const rect = npProgress.getBoundingClientRect(); seekTo((e.clientX - rect.left) / rect.width); };
}
