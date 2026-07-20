// Castbox tab logic: search, resolve RSS to episodes, persist selected channels,
// and bridge selections into the existing queue/player. Playback itself is
// delegated to player.js (addTrack / loadTrack) — no new audio engine.
import { store } from './store.js';
import { render } from './render.js';
import { callCastboxSearch, callCastboxResolve, fetchCastboxChannels, saveCastboxChannel, deleteCastboxChannel } from './supabase.js';
import { addTrack, loadTrack } from './player.js';

export function switchTab(tab) {
  if (store.activeTab === tab) return;
  store.activeTab = tab;
  render();
}

async function ensureChannelsLoaded() {
  if (store.castboxChannels.length === 0 && store.dbReady) {
    store.castboxChannels = await fetchCastboxChannels();
  }
}

export async function initCastbox() {
  store.castboxChannels = await fetchCastboxChannels();
}

export async function searchCastbox(q) {
  store.castboxQuery = q;
  const term = (q || '').trim();
  if (!term) { store.castboxResults = []; render(); return; }
  store.castboxLoading = true;
  render();
  const res = await callCastboxSearch(term);
  store.castboxResults = res.feeds || [];
  store.castboxLoading = false;
  render();
}

export async function addCastboxChannel(meta) {
  if (!store.dbReady) return;
  // De-dupe by feed URL so repeated "Add" doesn't create duplicate rows.
  const feedUrl = meta.feedUrl || meta.rss_url;
  if (store.castboxChannels.some((c) => c.rss_url === feedUrl)) {
    store.castboxOpenChannel = store.castboxChannels.find((c) => c.rss_url === feedUrl).id;
    render();
    return;
  }
  const row = await saveCastboxChannel(meta);
  if (row) {
    store.castboxChannels.push(row);
    store.castboxOpenChannel = row.id;
    render();
  }
}

export async function openCastboxChannel(id) {
  const ch = store.castboxChannels.find((c) => c.id === id);
  if (!ch) return;
  if (store.castboxOpenChannel === id) { store.castboxOpenChannel = null; render(); return; }
  store.castboxOpenChannel = id;
  if (!store.castboxEpisodes[id]) {
    store.castboxLoading = true;
    render();
    const res = await callCastboxResolve(ch.rss_url);
    store.castboxEpisodes[id] = res.episodes || [];
    store.castboxLoading = false;
  }
  render();
}

export async function playCastboxEpisode(channelId, index) {
  const eps = store.castboxEpisodes[channelId] || [];
  const ep = eps[index];
  if (!ep || !ep.url) return;
  const ch = store.castboxChannels.find((c) => c.id === channelId);
  const host = ch ? (ch.title || ch.author || '') : '';
  // Reuse the existing add flow: inserts into the active playlist's queue and
  // (since the queue may have been empty) starts playback at the new track.
  await addTrack(ep.url);
  // addTrack sets currentIndex to the new track if the queue was empty; if not,
  // jump to it and play so the selection is immediate.
  const idx = store.queue.findIndex((t) => t.url === ep.url);
  if (idx !== -1) loadTrack(idx, true);
}

export async function addCastboxEpisodeToQueue(channelId, index) {
  const eps = store.castboxEpisodes[channelId] || [];
  const ep = eps[index];
  if (!ep || !ep.url) return;
  await addTrack(ep.url);
}

export async function removeCastboxChannel(id) {
  const ok = await deleteCastboxChannel(id);
  if (ok) {
    store.castboxChannels = store.castboxChannels.filter((c) => c.id !== id);
    if (store.castboxOpenChannel === id) store.castboxOpenChannel = null;
    render();
  }
}

// Realtime handlers (called from app.js). INSERT: append if new. DELETE: drop
// by id. Idempotent — ignore rows we already have.
export function onCastboxChannelInserted(row) {
  if (!row) return;
  if (store.castboxChannels.some((c) => c.id === row.id)) return;
  store.castboxChannels.push(row);
  render();
}
export function onCastboxChannelDeleted(id) {
  if (!id) return;
  store.castboxChannels = store.castboxChannels.filter((c) => c.id !== id);
  if (store.castboxOpenChannel === id) store.castboxOpenChannel = null;
  render();
}

export { ensureChannelsLoaded };
