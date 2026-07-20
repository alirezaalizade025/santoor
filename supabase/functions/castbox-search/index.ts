// Castbox search edge function.
// Castbox has no official public API; podcast channels are standard RSS feeds
// indexed by Podcast Index. This function proxies a keyword search there and
// returns a normalized list of channels. The Podcast Index key/secret live
// ONLY here (Supabase secrets) — never in the browser.
import { json, handleOptions } from '../_shared/cors.ts';

// Podcast Index auth: Authorization = sha1(key + secret + unixEpochSeconds).
async function podcastIndexAuth(): Promise<Record<string, string>> {
  const key = Deno.env.get('PODCASTINDEX_KEY');
  const secret = Deno.env.get('PODCASTINDEX_SECRET');
  if (!key || !secret) {
    throw new Error('PODCASTINDEX_KEY / PODCASTINDEX_SECRET secrets are not set');
  }
  const now = Math.floor(Date.now() / 1000).toString();
  const hash = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(key + secret + now)
  );
  const auth = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return {
    'X-Auth-Key': key,
    'X-Auth-Date': now,
    Authorization: auth,
    'User-Agent': 'Santoor/1.0',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  let q = '';
  if (req.method === 'GET') {
    q = new URL(req.url).searchParams.get('q') || '';
  } else {
    try {
      const body = await req.json();
      q = body.q || '';
    } catch {
      q = '';
    }
  }
  q = (q || '').toString().trim();
  if (!q) return json({ feeds: [], error: 'missing query' }, 400);

  try {
    const headers = await podcastIndexAuth();
    const url =
      'https://api.podcastindex.org/api/1.0/search/byterm?q=' +
      encodeURIComponent(q) +
      '&max=24';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return json({ feeds: [], error: 'upstream error ' + res.status }, 502);
    }
    const data = await res.json();
    const feeds = Array.isArray(data.feeds) ? data.feeds : [];
    const mapped = feeds.map((f: any) => ({
      id: String(f.id ?? ''),
      title: f.title ?? '',
      author: f.author ?? f.artist ?? '',
      artwork: f.artwork ?? f.image ?? '',
      feedUrl: f.url ?? f.feedUrl ?? '',
      description: f.description ?? '',
    }));
    return json({ feeds: mapped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'search failed';
    return json({ feeds: [], error: msg }, 500);
  }
});
