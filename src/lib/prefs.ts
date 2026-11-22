'use client';
/**
 * Per-DEVICE preferences in localStorage (synchronous, survives reloads, never
 * synced): picking-as team, "our team" filter, scout name, splash toggle, etc.
 */
import { useSyncExternalStore } from 'react';
import { uuid } from './util';

export interface Prefs {
  deviceId: string;
  scoutName: string;
  /** "Our team" filter for every our-team view. */
  ourTeam: '611' | '526' | 'both';
  /** Alliance Selection Mode: which team's picklist / fit profile is active. */
  pickingAs: string;
  splashEnabled: boolean;
  haptics: boolean;
  theme: 'dark' | 'light';
  /** Demo sandbox (separate local database, never syncs). */
  demo: boolean;
  /** Optional Supabase override (advanced; lets one build point at any project). */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Role used when no Supabase project is configured (single-device mode). */
  localRole: 'admin' | 'strategist' | 'scout' | 'viewer';
  installDismissed: boolean;
  matchesFilter: string;
}

const DEFAULTS: Prefs = {
  deviceId: '',
  scoutName: '',
  ourTeam: 'both',
  pickingAs: '611',
  splashEnabled: true,
  haptics: true,
  theme: 'dark',
  demo: false,
  supabaseUrl: '',
  supabaseAnonKey: '',
  localRole: 'admin',
  installDismissed: false,
  matchesFilter: 'all',
};

const KEY = 'hh:prefs:v1';
const listeners = new Set<() => void>();
let cache: Prefs | null = null;

function load(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    stored = {};
  }
  cache = { ...DEFAULTS, ...stored };
  if (!cache.deviceId) {
    cache.deviceId = uuid();
    persist();
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota — prefs just won't persist */
  }
}

export function getPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  return load();
}

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...getPrefs(), ...patch };
  persist();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, () => DEFAULTS);
}
