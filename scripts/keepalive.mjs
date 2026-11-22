#!/usr/bin/env node
/**
 * Calls the public `keepalive()` RPC (returns the server time, touches no data)
 * so a Supabase Free project never pauses. Used by .github/workflows/keepalive.yml.
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run keepalive
 */
const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (repository secrets for the GitHub Action).');
  process.exit(1);
}
const res = await fetch(`${url}/rest/v1/rpc/keepalive`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
});
const body = await res.text();
if (!res.ok) {
  console.error(`Keepalive failed: HTTP ${res.status} ${body}`);
  console.error('If the project is already paused: Supabase dashboard → your project → "Restore project" (see README).');
  process.exit(1);
}
console.log(`Supabase is awake: ${body}`);
