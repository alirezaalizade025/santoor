// Local display-name identity, persisted in localStorage.
import { store } from './store.js';

export function loadNickname() {
  try {
    const saved = localStorage.getItem('santoor:nickname');
    if (saved) return saved;
  } catch (e) {}
  const name = 'Listener-' + Math.random().toString(36).slice(2, 6);
  try { localStorage.setItem('santoor:nickname', name); } catch (e) {}
  return name;
}

export function saveNickname(name) {
  store.nickname = name;
  try { localStorage.setItem('santoor:nickname', name); } catch (e) {}
}
