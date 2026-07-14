// Small pure helpers + the only place that sets a transient error toast.
// showError triggers a re-render via the imported render().
import { store } from './store.js';
import { render } from './render.js';

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

export function urlHost(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown source'; }
}

export function guessTitle(url) {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || 'Untitled track');
    return last.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ');
  } catch (e) { return 'Untitled track'; }
}

export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

export function showError(msg) {
  store.errorMsg = msg;
  render();
  setTimeout(() => { store.errorMsg = ''; render(); }, 5000);
}
