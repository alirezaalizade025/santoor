(function () {
  const root = document.getElementById('santoor-root');
  const DEVICE_ID = 'dev-' + Math.random().toString(36).slice(2, 8);

  // ── Supabase client ─────────────────────────────────────────────────
  let db = null;
  let dbReady = false;
  function initSupabase() {
    const cfg = window.SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.anonKey) return false;
    try {
      db = window.supabase.createClient(cfg.url, cfg.anonKey);
      return true;
    } catch (e) {
      console.error('Supabase init failed', e);
      return false;
    }
  }

  // ── Identity (for presence / "listen together") ─────────────────────
  function loadNickname() {
    try {
      const saved = localStorage.getItem('santoor:nickname');
      if (saved) return saved;
    } catch (e) {}
    const name = 'Listener-' + Math.random().toString(36).slice(2, 6);
    try { localStorage.setItem('santoor:nickname', name); } catch (e) {}
    return name;
  }
  function saveNickname(name) {
    try { localStorage.setItem('santoor:nickname', name); } catch (e) {}
  }
  let nickname = loadNickname();

  // ── Presence (who's listening now + "listen together") ─────────────
  let presenceChannel = null;
  let onlineUsers = []; // [{id, nickname, track_id, position_seconds, is_playing, updated_at}]
  let followingId = null;
  let followDriftTimer = null;
  let presenceUpdateTimer = null;

  function myPresencePayload() {
    const track = state.currentIndex !== -1 ? state.queue[state.currentIndex] : null;
    return {
      nickname,
      track_id: track ? track.id : null,
      track_title: track ? track.title : null,
      position_seconds: state.currentTime,
      is_playing: state.isPlaying,
      following_id: followingId,
      updated_at: Date.now()
    };
  }

  function broadcastPresence(immediate) {
    if (!presenceChannel) return;
    if (immediate) { clearTimeout(presenceUpdateTimer); presenceChannel.track(myPresencePayload()); }
    else { clearTimeout(presenceUpdateTimer); presenceUpdateTimer = setTimeout(() => presenceChannel.track(myPresencePayload()), 1000); }
  }

  function initPresence() {
    presenceChannel = db.channel('listeners-room', { config: { presence: { key: DEVICE_ID } } });
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const raw = presenceChannel.presenceState();
        onlineUsers = Object.entries(raw)
          .filter(([id]) => id !== DEVICE_ID)
          .map(([id, arr]) => Object.assign({ id }, arr[0]));

        if (followingId) {
          const peer = onlineUsers.find((u) => u.id === followingId);
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
    setInterval(() => { if (presenceChannel) broadcastPresence(false); }, 5000);
  }

  function mirrorPeer(peer) {
    if (!peer.track_id) return;
    const idx = state.queue.findIndex((t) => t.id === peer.track_id);
    if (idx === -1) return;
    const elapsed = peer.is_playing ? (Date.now() - (peer.updated_at || Date.now())) / 1000 : 0;
    const targetTime = (peer.position_seconds || 0) + elapsed;

    if (state.currentIndex !== idx) {
      loadTrack(idx, peer.is_playing, targetTime);
      return;
    }
    if (peer.is_playing && !state.isPlaying) {
      audio.currentTime = targetTime;
      audio.play().then(() => { state.isPlaying = true; render(); }).catch(() => {});
    } else if (!peer.is_playing && state.isPlaying) {
      audio.pause();
      state.isPlaying = false;
      render();
    } else if (Math.abs(audio.currentTime - targetTime) > 1.5) {
      audio.currentTime = targetTime;
    }
  }

  function startFollowing(peerId) {
    followingId = peerId;
    const peer = onlineUsers.find((u) => u.id === peerId);
    if (peer) mirrorPeer(peer);
    clearInterval(followDriftTimer);
    followDriftTimer = setInterval(() => {
      const p = onlineUsers.find((u) => u.id === followingId);
      if (p) mirrorPeer(p);
    }, 4000);
    broadcastPresence(true);
    render();
  }
  function stopFollowing() {
    followingId = null;
    clearInterval(followDriftTimer);
    broadcastPresence(true);
    render();
  }

  // ── Track CRUD (Create, Read, Delete — no Update, by design) ───────
  async function fetchTracks() {
    const { data, error } = await db.from('tracks').select('*').order('created_at', { ascending: true });
    if (error) { console.error('fetchTracks error', error); showError('Could not load your tracks from the database.'); return []; }
    return data;
  }
  async function createTrack(url, title, host) {
    const { data, error } = await db.from('tracks').insert({ url, title, host }).select().single();
    if (error) { console.error('createTrack error', error); showError('Could not save that track — check your Supabase setup.'); return null; }
    return data;
  }
  async function deleteTrack(id) {
    const { error } = await db.from('tracks').delete().eq('id', id);
    if (error) { console.error('deleteTrack error', error); showError('Could not remove that track.'); return false; }
    return true;
  }

  // ── Playback state sync (separate table, continuously updated) ─────
  async function fetchPlayerState() {
    const { data, error } = await db.from('player_state').select('*').eq('id', 1).single();
    if (error) { console.error('fetchPlayerState error', error); return null; }
    return data;
  }
  async function savePlayerState(partial) {
    const payload = Object.assign({ id: 1, updated_by: DEVICE_ID, updated_at: new Date().toISOString() }, partial);
    const { error } = await db.from('player_state').update(payload).eq('id', 1);
    if (error) console.error('savePlayerState error', error);
  }
  function subscribeToPlayerState(onChange) {
    return db.channel('player_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_state', filter: 'id=eq.1' }, (payload) => {
        if (payload.new && payload.new.updated_by !== DEVICE_ID) onChange(payload.new);
      })
      .subscribe();
  }

  // ── Player state & logic ────────────────────────────────────────────
  let state = { queue: [], currentIndex: -1, isPlaying: false, currentTime: 0 };
  let audio = new Audio();
  audio.preload = 'metadata';
  let duration = 0;
  let pendingSeek = null;
  let saveTimer = null;
  let pendingRemote = null;
  let errorMsg = '';
  let isOnline = navigator.onLine;
  let loading = true;
  let loop = false;

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return m + ':' + s;
  }
  function urlHost(url) { try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown source'; } }
  function guessTitle(url) {
    try {
      const path = new URL(url).pathname;
      const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || 'Untitled track');
      return last.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ');
    } catch (e) { return 'Untitled track'; }
  }
  function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
  function showError(msg) { errorMsg = msg; render(); setTimeout(() => { errorMsg = ''; render(); }, 5000); }

  function persistPosition(immediate) {
    if (!dbReady) return;
    const track = state.currentIndex !== -1 ? state.queue[state.currentIndex] : null;
    const payload = { current_track_id: track ? track.id : null, position_seconds: state.currentTime, is_playing: state.isPlaying };
    if (immediate) { clearTimeout(saveTimer); savePlayerState(payload); }
    else { clearTimeout(saveTimer); saveTimer = setTimeout(() => savePlayerState(payload), 800); }
  }

  function loadTrack(index, autoplay, seekTo) {
    if (index < 0 || index >= state.queue.length) return;
    state.currentIndex = index;
    const track = state.queue[index];
    pendingSeek = seekTo || 0;
    audio.src = track.url;
    duration = 0;
    if (autoplay) {
      audio.play().then(() => { state.isPlaying = true; broadcastPresence(true); render(); })
        .catch(() => { state.isPlaying = false; showError('Could not play this track — the source may block playback.'); broadcastPresence(true); });
    } else {
      state.isPlaying = false;
      broadcastPresence(true);
    }
    render();
  }

  async function addTrack(url) {
    if (!url || !/^https?:\/\//i.test(url.trim())) { showError('Paste a valid track URL starting with http:// or https://'); return; }
    if (!dbReady) { showError('Database not configured — add your Supabase URL and key to supabase-config.js first.'); return; }
    const cleanUrl = url.trim();
    const title = guessTitle(cleanUrl);
    const host = urlHost(cleanUrl);
    const row = await createTrack(cleanUrl, title, host);
    if (!row) return;
    state.queue.push(row);
    if (state.currentIndex === -1) { state.currentIndex = 0; loadTrack(0, false); persistPosition(true); }
    render();
  }

  async function removeTrack(id) {
    const idx = state.queue.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const ok = await deleteTrack(id);
    if (!ok) return;
    state.queue.splice(idx, 1);
    if (state.currentIndex === idx) {
      audio.pause(); audio.src = ''; state.isPlaying = false;
      state.currentIndex = state.queue.length ? Math.min(idx, state.queue.length - 1) : -1;
      if (state.currentIndex !== -1) loadTrack(state.currentIndex, false);
      persistPosition(true);
    } else if (state.currentIndex > idx) { state.currentIndex--; }
    render();
  }

  function togglePlay() {
    if (followingId) return;
    if (state.currentIndex === -1) return;
    if (state.isPlaying) { audio.pause(); state.isPlaying = false; persistPosition(true); broadcastPresence(true); render(); }
    else { audio.play().then(() => { state.isPlaying = true; persistPosition(true); broadcastPresence(true); render(); }).catch(() => showError('Playback failed.')); }
  }
  function toggleLoop() { if (followingId) return; loop = !loop; render(); }
  function next() { if (followingId) return; if (state.currentIndex < state.queue.length - 1) { loadTrack(state.currentIndex + 1, true); persistPosition(true); broadcastPresence(true); } }
  function prev() { if (followingId) return; if (state.currentIndex > 0) { loadTrack(state.currentIndex - 1, true); persistPosition(true); broadcastPresence(true); } }
  function seekTo(fraction) {
    if (followingId) return;
    if (!duration) return;
    audio.currentTime = fraction * duration;
    state.currentTime = audio.currentTime;
    persistPosition(true);
    broadcastPresence(true);
    render();
  }

  function applyRemote(remote, resume) {
    if (resume) {
      const idx = state.queue.findIndex((t) => t.id === remote.current_track_id);
      if (idx !== -1) loadTrack(idx, !!remote.is_playing, remote.position_seconds || 0);
    }
    pendingRemote = null;
    render();
  }

  audio.addEventListener('timeupdate', () => {
    state.currentTime = audio.currentTime;
    if (Math.floor(audio.currentTime) % 5 === 0) {
      if (!followingId) persistPosition(false);
      broadcastPresence(false);
    }
    render();
  });
  audio.addEventListener('loadedmetadata', () => {
    duration = audio.duration;
    if (pendingSeek != null) { try { audio.currentTime = pendingSeek; } catch (e) {} pendingSeek = null; }
    if (!followingId) broadcastPresence(true);
    render();
  });
  audio.addEventListener('ended', () => {
    if (followingId) return;
    if (state.currentIndex < state.queue.length - 1) { next(); }
    else if (loop && state.queue.length > 0) { loadTrack(0, true); persistPosition(true); broadcastPresence(true); }
    else { state.isPlaying = false; persistPosition(true); render(); }
  });
  audio.addEventListener('error', () => { if (state.currentIndex !== -1) showError('This track failed to load — link may be broken or blocks playback.'); });

  window.addEventListener('online', () => { isOnline = true; render(); });
  window.addEventListener('offline', () => { isOnline = false; render(); });

  // ── Render ───────────────────────────────────────────────────────────
  function render() {
    const track = state.currentIndex !== -1 ? state.queue[state.currentIndex] : null;
    const nickEl = document.getElementById('cn-nickname-input');
    const nickVal = (nickEl && document.activeElement === nickEl) ? nickEl.value : nickname;
    const progressPct = duration ? (state.currentTime / duration) * 100 : 0;
    const bars = Array.from({ length: 40 }).map((_, i) => {
      const isActive = (i / 40) * 100 <= progressPct;
      const h = 20 + Math.round(Math.abs(Math.sin(i * 12.9)) * 80);
      return `<div class="cn-bar ${isActive ? 'active' : ''} ${state.isPlaying && isActive ? 'playing' : ''}" style="height:${h}%; animation-delay:${(i % 6) * 0.08}s"></div>`;
    }).join('');

    const syncLabel = dbReady ? 'Synced via database' : 'Database not configured';
    const followingPeer = followingId ? onlineUsers.find((u) => u.id === followingId) : null;
    const followers = onlineUsers.filter((u) => u.following_id === DEVICE_ID);

    root.innerHTML = `
      <div class="cn-wrap">
        <div class="cn-header">
          <h1 class="cn-title">Santoor<span class="dot">.</span></h1>
          <div class="cn-sync-status"><span class="cn-pulse ${state.isPlaying && dbReady ? 'live' : 'off'}"></span>${syncLabel}</div>
        </div>

        ${!dbReady ? `<div class="cn-offline-banner">Add your Supabase URL and anon key to supabase-config.js, then reload — see README.md for the 5-minute setup.</div>` : ''}
        ${!isOnline ? `<div class="cn-offline-banner">You're offline — reconnect to add tracks or sync playback.</div>` : ''}

        ${dbReady ? `
          <div class="cn-presence-row">
            <span class="cn-presence-count">🟢 ${onlineUsers.length + 1} listening now</span>
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

        ${pendingRemote ? `
          <div class="cn-banner">
            <div class="cn-banner-text">Playing on another device — at ${fmtTime(pendingRemote.position_seconds || 0)}</div>
            <div class="cn-banner-actions">
              <button class="cn-btn-small" id="cn-resume-remote">Resume here</button>
              <button class="cn-btn-small" id="cn-dismiss-remote">Dismiss</button>
            </div>
          </div>
        ` : ''}

        <div class="cn-input-row">
          <input class="cn-input" id="cn-url-input" placeholder="Paste a track URL (https://...)" ${dbReady ? '' : 'disabled'} />
          <button class="cn-add-btn" id="cn-add-btn" ${dbReady ? '' : 'disabled'}>Add</button>
        </div>
        ${errorMsg ? `<div class="cn-error">${escapeHtml(errorMsg)}</div>` : ''}

        <div class="cn-player">
          <div class="cn-now-playing">
            <div class="cn-art ${state.isPlaying ? 'spinning' : ''}"></div>
            <div class="cn-track-info">
              ${track ? `
                <div class="cn-track-title">${escapeHtml(track.title || 'Untitled track')}</div>
                <div class="cn-track-sub">${escapeHtml(track.host || '')}</div>
              ` : `<div class="cn-empty-state">${loading ? 'Loading your queue…' : 'Paste a URL above to start listening'}</div>`}
            </div>
          </div>

          <div class="cn-waveform">${bars}</div>

          <div class="cn-progress-row">
            <span class="cn-time">${fmtTime(state.currentTime)}</span>
            <div class="cn-progress-track" id="cn-progress-track">
              <div class="cn-progress-fill" style="width:${progressPct}%"></div>
              <div class="cn-progress-handle" style="left:${progressPct}%"></div>
            </div>
            <span class="cn-time">${fmtTime(duration)}</span>
          </div>

          <div class="cn-controls">
            <button class="cn-ctrl-btn" id="cn-prev" ${state.currentIndex <= 0 || followingId ? 'disabled' : ''} title="Previous">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button class="cn-ctrl-btn cn-play-btn" id="cn-play" ${state.currentIndex === -1 || followingId ? 'disabled' : ''} title="Play/Pause">
              ${state.isPlaying
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>`
                : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`}
            </button>
            <button class="cn-ctrl-btn" id="cn-next" ${state.currentIndex === -1 || state.currentIndex >= state.queue.length - 1 || followingId ? 'disabled' : ''} title="Next">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/></svg>
            </button>
            <button class="cn-ctrl-btn ${loop ? 'cn-loop-active' : ''}" id="cn-loop" ${followingId ? 'disabled' : ''} title="Loop queue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
            </button>
          </div>
        </div>

        ${dbReady && onlineUsers.length > 0 ? `
          <div class="cn-section-label">Listening now</div>
          <div class="cn-listeners">
            ${onlineUsers.map((u) => `
              <div class="cn-listener-item">
                <span class="cn-listener-dot"></span>
                <div class="cn-listener-info">
                  <div class="cn-listener-name">${escapeHtml(u.nickname || 'Listener')}</div>
                  <div class="cn-listener-status">${u.track_title ? (u.is_playing ? 'Playing — ' : 'Paused — ') + escapeHtml(u.track_title) : 'Idle'}</div>
                </div>
                <button class="cn-btn-small ${followingId === u.id ? 'cn-btn-active' : ''}" data-follow="${u.id}">
                  ${followingId === u.id ? 'Following' : 'Listen together'}
                </button>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div class="cn-section-label">Queue — ${state.queue.length} track${state.queue.length === 1 ? '' : 's'}</div>
        <div class="cn-queue">
          ${state.queue.length === 0 ? `<div class="cn-empty-queue">${loading ? 'Loading…' : 'No tracks yet'}</div>` : state.queue.map((t, i) => `
            <div class="cn-queue-item ${i === state.currentIndex ? 'active' : ''}" data-idx="${i}">
              <span class="cn-queue-idx">${(i + 1).toString().padStart(2, '0')}</span>
              <span class="cn-queue-title">${escapeHtml(t.title || 'Untitled track')}</span>
              <button class="cn-queue-remove" data-remove="${t.id}" title="Remove">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.3 5.71L12 12.01l-6.3-6.3-1.41 1.42 6.3 6.29-6.3 6.3 1.41 1.41 6.3-6.3 6.3 6.3 1.41-1.41-6.3-6.3 6.3-6.29z"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
      </div>
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
    const loopBtn = document.getElementById('cn-loop'); if (loopBtn) loopBtn.onclick = toggleLoop;

    const progressTrack = document.getElementById('cn-progress-track');
    if (progressTrack) progressTrack.onclick = (e) => { const rect = progressTrack.getBoundingClientRect(); seekTo((e.clientX - rect.left) / rect.width); };

    document.querySelectorAll('.cn-queue-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove]')) return;
        if (followingId) return;
        loadTrack(parseInt(el.getAttribute('data-idx'), 10), true);
        persistPosition(true);
        broadcastPresence(true);
      });
    });
    document.querySelectorAll('[data-remove]').forEach((el) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); removeTrack(el.getAttribute('data-remove')); });
    });

    const resumeBtn = document.getElementById('cn-resume-remote'); if (resumeBtn) resumeBtn.onclick = () => applyRemote(pendingRemote, true);
    const dismissBtn = document.getElementById('cn-dismiss-remote'); if (dismissBtn) dismissBtn.onclick = () => { pendingRemote = null; render(); };

    const nicknameInput = document.getElementById('cn-nickname-input');
    if (nicknameInput) {
      nicknameInput.onchange = () => {
        nickname = nicknameInput.value.trim() || nickname;
        saveNickname(nickname);
        broadcastPresence(true);
      };
    }
    document.querySelectorAll('[data-follow]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-follow');
        followingId === id ? stopFollowing() : startFollowing(id);
      });
    });
    const stopBtn = document.getElementById('cn-stop-following'); if (stopBtn) stopBtn.onclick = stopFollowing;
  }

  async function init() {
    render();
    dbReady = initSupabase();
    render();
    if (!dbReady) { loading = false; render(); return; }

    state.queue = await fetchTracks();
    const remoteState = await fetchPlayerState();
    if (remoteState && remoteState.current_track_id) {
      const idx = state.queue.findIndex((t) => t.id === remoteState.current_track_id);
      if (idx !== -1) loadTrack(idx, false, remoteState.position_seconds || 0);
    }
    loading = false;
    render();

    subscribeToPlayerState((remote) => { if (!followingId) { pendingRemote = remote; render(); } });
    initPresence();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch((e) => console.error('SW registration failed', e));
    }
  }

  init();
})();
