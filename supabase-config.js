// ── Supabase configuration ──────────────────────────────────────────────
// Get these from your Supabase project:
//   Project Settings → API → Project URL, and the "anon public" key.
// Both values are safe to expose in client-side code — the anon key is
// meant to be public; access is controlled by Row Level Security policies
// on the database side (see supabase-setup.sql).

window.SUPABASE_CONFIG = {
  url: "",
  anonKey: ""
};
