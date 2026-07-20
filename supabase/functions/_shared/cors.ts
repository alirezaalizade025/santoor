// Shared CORS + JSON response helpers for Santoor Castbox edge functions.
// Edge Functions run on Deno and are called from the browser; they must return
// permissive CORS headers or the browser blocks the response.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function handleOptions(): Response {
  return new Response('ok', { status: 204, headers: CORS_HEADERS });
}
