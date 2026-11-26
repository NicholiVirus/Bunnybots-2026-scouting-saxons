'use client';
/**
 * Auth + role state. With Supabase configured, the role comes from the
 * server-side profiles table (enforced by RLS); the profile is cached in
 * IndexedDB so roles still work offline. Without Supabase ("local-only mode")
 * the device runs single-user with a locally chosen role.
 */
import type { Session } from '@supabase/supabase-js';
import { db } from '@/data/db';
import type { Profile, Role } from '@/data/types';
import { createStore } from '@/lib/store';
import { getPrefs, setPrefs } from '@/lib/prefs';
import { getSupabase, isSupabaseConfigured } from './supabase';

export interface AuthState {
  status: 'loading' | 'local' | 'signed_out' | 'signed_in';
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  role: Role | null;
}

export const authStore = createStore<AuthState>({
  status: 'loading',
  userId: null,
  email: null,
  profile: null,
  role: null,
});

export const useAuth = () => authStore.use();

let started = false;

async function loadProfile(session: Session) {
  const uid = session.user.id;
  const cached = await db.profiles.get(uid);
  authStore.set({
    status: 'signed_in',
    userId: uid,
    email: session.user.email ?? null,
    profile: cached ?? null,
    role: cached?.role ?? authStore.get().role ?? 'viewer',
  });
  const sb = getSupabase();
  if (!sb) return;
  const { data, error } = await sb
    .from('profiles')
    .select('id,display_name,role,created_at,updated_at,deleted_at')
    .eq('id', uid)
    .maybeSingle();
  if (!error && data) {
    const profile = { ...(data as Profile), email: session.user.email ?? null };
    await db.profiles.put(profile);
    authStore.set({ profile, role: profile.role });
  }
}

export async function initAuth() {
  if (started) return;
  started = true;
  if (!isSupabaseConfigured()) {
    const p = getPrefs();
    authStore.set({
      status: 'local',
      userId: null,
      email: null,
      role: p.localRole,
      profile: null,
    });
    return;
  }
  const sb = getSupabase()!;
  const { data } = await sb.auth.getSession();
  if (data.session) await loadProfile(data.session);
  else authStore.set({ status: 'signed_out', role: null, userId: null, profile: null, email: null });

  sb.auth.onAuthStateChange((event, session) => {
    if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
      void loadProfile(session);
    } else if (event === 'SIGNED_OUT') {
      authStore.set({ status: 'signed_out', role: null, userId: null, profile: null, email: null });
    }
  });
}

/** Re-read the profile (e.g. after an admin changed my role). */
export async function refreshProfile() {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  if (data.session) await loadProfile(data.session);
}

/**
 * Become an Admin with the team admin passcode. The server checks the code
 * (public.claim_admin), so only a correct passcode changes the role. In
 * local-only / demo mode the device simply switches its local role.
 * Throws with a readable message on a wrong code, lockout or no connection.
 */
export async function claimAdmin(passcode: string): Promise<void> {
  const st = authStore.get();
  if (st.role === 'admin') return;
  if (st.status === 'local') {
    setPrefs({ localRole: 'admin' });
    authStore.set({ role: 'admin' });
    return;
  }
  const sb = getSupabase();
  if (!sb || st.status !== 'signed_in') throw new Error('Sign in first, then enter the passcode.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    throw new Error('You need a connection once to become admin. Try again when online.');
  const { data, error } = await sb.rpc('claim_admin', { p_passcode: passcode });
  if (error) throw new Error(/fetch|network/i.test(error.message) ? 'No connection. Try again when online.' : error.message);
  if (data !== 'admin') throw new Error('Wrong passcode. Ask the scouting lead for it.');
  await refreshProfile();
}

const redirectTo = () => `${window.location.origin}/auth/callback/`;

export async function signInWithPassword(email: string, password: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpWithPassword(email: string, password: string, displayName: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName }, emailRedirectTo: redirectTo() },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signInWithMagicLink(email: string) {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
  if (error) throw error;
}

export async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
}

// ── Permissions (UI mirror of the RLS policies) ─────────────────────────────
const RANK: Record<Role, number> = { viewer: 0, scout: 1, strategist: 2, admin: 3 };
export const atLeast = (role: Role | null, min: Role) => role !== null && RANK[role] >= RANK[min];

export const can = {
  scout: (r: Role | null) => atLeast(r, 'scout'),
  pitScout: (r: Role | null) => atLeast(r, 'scout'),
  vote: (r: Role | null) => atLeast(r, 'scout'),
  editPicklist: (r: Role | null) => atLeast(r, 'strategist'),
  editBoard: (r: Role | null) => atLeast(r, 'strategist'),
  editStrategy: (r: Role | null) => atLeast(r, 'strategist'),
  editCatalog: (r: Role | null) => atLeast(r, 'strategist'),
  importOthersQr: (r: Role | null) => atLeast(r, 'strategist'),
  manageRotation: (r: Role | null) => atLeast(r, 'strategist'),
  viewRaw: (r: Role | null) => atLeast(r, 'strategist'),
  admin: (r: Role | null) => r === 'admin',
};

/** Identity stamped on rows this device writes. */
export function whoAmI(): { id: string | null; name: string } {
  const s = authStore.get();
  const prefs = getPrefs();
  const name = s.profile?.display_name || prefs.scoutName || s.email?.split('@')[0] || 'Local device';
  return { id: s.userId, name };
}
