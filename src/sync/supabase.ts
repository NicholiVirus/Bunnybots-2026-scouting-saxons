'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPrefs } from '@/lib/prefs';

let client: SupabaseClient | null | undefined;

/** URL + anon key from build env, overridable per device (Settings → Advanced). */
export function supabaseConfig(): { url: string; key: string } | null {
  if (typeof window === 'undefined') return null;
  const p = getPrefs();
  const url = (p.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = (p.supabaseAnonKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  return url && key ? { url, key } : null;
}

/** True when this device talks to a Supabase project (demo sandbox never does). */
export function isSupabaseConfigured(): boolean {
  return !!supabaseConfig() && !getPrefs().demo;
}

export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (client !== undefined) return client;
  const cfg = isSupabaseConfigured() ? supabaseConfig() : null;
  client = cfg
    ? createClient(cfg.url, cfg.key, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'hh-auth',
        },
        realtime: { params: { eventsPerSecond: 20 } },
      })
    : null;
  return client;
}

/** Public URL for a file in a public bucket. */
export function publicStorageUrl(bucket: string, path: string): string | null {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  return `${cfg.url.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export type SbError = { message: string; code?: string; status?: number };

/** Only an explicit `false` means offline (some runtimes don't implement navigator.onLine). */
export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function classifyError(err: SbError | null | undefined, status?: number): 'network' | 'auth' | 'denied' | 'invalid' | 'server' {
  if (!err) return 'server';
  const msg = String(err.message || '');
  const code = String(err.code || '');
  const st = status ?? err.status ?? 0;
  if (isOffline() || st === 0 || /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i.test(msg))
    return 'network';
  if (st === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(msg)) return 'auth';
  if (st === 403 || code === '42501' || /row-level security|permission denied|only an admin/i.test(msg)) return 'denied';
  if (st >= 500) return 'server';
  return 'invalid';
}
