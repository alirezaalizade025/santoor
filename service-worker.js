// Santoor service worker
// Caches the app shell so the app opens offline. Supabase API calls and
// audio streams are cross-origin and always pass straight through to the
// network — we never try to cache or intercept them.

const CACHE_NAME = 'santoor-shell-v25';
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './js/store.js',
  './js/util.js',
  './js/identity.js',
  './js/supabase.js',
  './js/presence.js',
  './js/player.js',
  './js/mediaSession.js',
  './js/waveform.js',
  './js/render.js',
  './supabase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }

  // Network-first: always serve the latest same-origin file when online, so a
  // code change is never hidden behind a stale cached module. Falls back to the
  // current cache only when offline. (Supabase/audio are cross-origin and skip this.)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request, { cacheName: CACHE_NAME }))
  );
});
