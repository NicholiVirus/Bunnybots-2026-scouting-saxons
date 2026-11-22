'use client';
import { createStore } from '@/lib/store';

export interface SyncState {
  /** Supabase configured + signed in + not demo → writes are queued for the server. */
  active: boolean;
  configured: boolean;
  online: boolean;
  pending: number;
  failed: number;
  pulling: boolean;
  pushing: boolean;
  lastPullAt: number | null;
  lastPushAt: number | null;
  realtime: 'off' | 'connecting' | 'live' | 'error';
  lastError: string | null;
}

export const syncStatus = createStore<SyncState>({
  active: false,
  configured: false,
  online: true,
  pending: 0,
  failed: 0,
  pulling: false,
  pushing: false,
  lastPullAt: null,
  lastPushAt: null,
  realtime: 'off',
  lastError: null,
});

export const useSyncStatus = () => syncStatus.use();
