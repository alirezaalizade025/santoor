// View layer: builds the entire UI into #santoor-root and wires DOM events.
import { store, DEVICE_ID } from './store.js';
import { fmtTime, escapeHtml } from './util.js';
import { togglePlay, toggleLoop, cycleRepeat, toggleShuffle, next, prev, seekTo, addTrack, removeTrack, applyRemote, loadTrack, persistPosition, joinPlayback, setVolume } from './player.js';
import { startFollowing, stopFollowing, broadcastPresence } from './presence.js';
import { saveNickname } from './identity.js';

const root = document.getElementById('santoor-root');

export function render() {
  const track = store.currentIndex !== -1 ? store.queue[store.currentIndex] : null;
  // Never keep the full-screen view open with nothing to show.
  if (store.nowPlayingOpen && !track) store.nowPlayingOpen = false;
  const nickEl = document.getElementById('cn-nickname-input');
  const nickVal = (nickEl && document.activeElement === nickEl) ? nickEl.value : store.nickname;
  const progressPct = store.duration ? (store.currentTime / store.duration) * 100 : 0;
  const bars = Array.from({ length: 40 }).map((_, i) => {
    const isActive = (i / 40) * 100 <= progressPct;
    const h = 20 + Math.round(Math.abs(Math.sin(i * 12.9)) * 80);
    return `<div class="cn-bar ${isActive ? 'active' : ''} ${store.isPlaying && isActive ? 'playing' : ''}" style="height:${h}%; animation-delay:${(i % 6) * 0.08}s"></div>`;
  }).join('');

  const syncLabel = store.dbReady ? 'Synced via database' : 'Database not configured';
  const followingPeer = store.followingId ? store.onlineUsers.find((u) => u.id === store.followingId) : null;
  const followers = store.onlineUsers.filter((u) => u.following_id === DEVICE_ID);

  root.innerHTML = `
    <div class="cn-wrap">
      <div class="cn-header">
        <h1 class="cn-title">Santoor<span class="dot">.</span></h1>
        <div class="cn-sync-status"><span class="cn-pulse ${store.isPlaying && store.dbReady ? 'live' : 'off'}"></span>${syncLabel}</div>
      </div>

      ${!store.dbReady ? `<div class="cn-offline-banner">Add your Supabase URL and anon key to supabase-config.js, then reload — see README.md for the 5-minute setup.</div>` : ''}
      ${!store.isOnline ? `<div class="cn-offline-banner">You're offline — reconnect to add tracks or sync playback.</div>` : ''}
      ${store.dbReady && store.isOnline && !store.connectionHealthy ? `<div class="cn-offline-banner">Live connection lost — reconnecting…</div>` : ''}

      ${store.dbReady ? `
        <div class="cn-presence-row">
          <span class="cn-presence-count">🟢 ${store.onlineUsers.length + 1} listening now</span>
           <input class="cn-nickname-input" id="cn-nickname-input" value="${escapeHtml(nickVal)}" maxlength="24" title="Your display name" />
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

      <div class="cn-input-row">
        <input class="cn-input" id="cn-url-input" aria-label="Track URL" placeholder="Paste a track URL (https://...)" ${store.dbReady && !store.addingTrack ? '' : 'disabled'} />
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

        <div class="cn-waveform">${bars}</div>

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
  attachHandlers();
}

function attachHandlers() {
  const urlInput = document.getElementById('cn-url-input');
  const addBtn = document.getElementById('cn-add-btn');
  if (addBtn) addBtn.onclick = () => { addTrack(urlInput.value); urlInput.value = ''; };
  if (urlInput) urlInput.onkeydown = (e) => { if (e.key === 'Enter') { addTrack(urlInput.value); urlInput.value = ''; } };

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

  const volume = document.getElementById('cn-volume');
  if (volume) volume.oninput = (e) => setVolume(parseFloat(e.target.value));

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
