// Castbox resolve edge function.
// Takes an RSS feed URL (returned by castbox-search) and parses it server-side
// (browser CORS would otherwise block the fetch). Returns the channel metadata
// plus a capped list of episodes with their audio enclosure URLs.
import { json, handleOptions } from '../_shared/cors.ts';

// itunes:duration may be "HH:MM:SS", "MM:SS", or a bare integer of seconds.
function normalizeDuration(raw: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return isFinite(n) ? n : null;
  }
  const parts = s.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !isFinite(n))) return null;
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 1) seconds = parts[0];
  return seconds > 0 ? seconds : null;
}

function text(node: Element | null, tag: string): string {
  const el = node?.getElementsByTagName(tag)?.[0];
  return el?.textContent?.trim() ?? '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  let feed = '';
  if (req.method === 'GET') {
    feed = new URL(req.url).searchParams.get('feed') || '';
  } else {
    try {
      const body = await req.json();
      feed = body.feed || '';
    } catch {
      feed = '';
    }
  }
  feed = (feed || '').toString().trim();
  if (!feed || !/^https?:\/\//i.test(feed)) {
    return json({ error: 'missing or invalid feed url' }, 400);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(feed, {
      headers: { 'User-Agent': 'Santoor/1.0' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return json({ error: 'feed fetch failed ' + res.status }, 502);
    }
    const xml = await res.text();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (!doc || !doc.documentElement) {
      return json({ error: 'could not parse feed xml' }, 502);
    }

    const channel = doc.getElementsByTagName('channel')[0];
    const meta = {
      title: text(channel, 'title'),
      author: text(channel, 'author') || text(channel, 'itunes:author'),
      artwork:
        channel?.getElementsByTagName('itunes:image')?.[0]?.getAttribute('href') ||
        text(channel, 'image') ||
        '',
      description: text(channel, 'description'),
    };

    const items = Array.from(doc.getElementsByTagName('item')).slice(0, 50);
    const episodes = items.map((item) => {
      const enclosure = item.getElementsByTagName('enclosure')[0];
      const url = enclosure?.getAttribute('url') || '';
      const type = enclosure?.getAttribute('type') || '';
      return {
        title: text(item, 'title'),
        url,
        type,
        durationSeconds: normalizeDuration(
          item.getElementsByTagName('itunes:duration')?.[0]?.textContent || null
        ),
        publishedAt: text(item, 'pubDate'),
      };
    }).filter((e) => e.url);

    return json({ meta, episodes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'resolve failed';
    return json({ error: msg }, 500);
  }
});
