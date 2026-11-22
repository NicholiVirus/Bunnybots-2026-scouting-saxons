'use client';
import { useEffect, type ReactNode } from 'react';
import { ensureLocalSeed } from '@/data/seed';
import { initAuth, useAuth } from '@/sync/auth';
import { syncEngine } from '@/sync/engine';
import { isSupabaseConfigured } from '@/sync/supabase';
import { syncStatus } from '@/sync/status';
import { registerServiceWorker } from '@/lib/pwa';
import { usePrefs } from '@/lib/prefs';
import { Splash } from './Splash';
import { BackgroundServices } from './BackgroundServices';
import { AnalyticsProvider } from '@/analytics/AnalyticsProvider';

export function Providers({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const prefs = usePrefs();

  useEffect(() => {
    registerServiceWorker();
    syncStatus.set({ configured: isSupabaseConfigured(), online: navigator.onLine });
    void (async () => {
      try {
        await ensureLocalSeed();
      } finally {
        await initAuth();
      }
    })();
  }, []);

  useEffect(() => {
    if (auth.status === 'signed_in') syncEngine.start();
    else syncEngine.stop();
  }, [auth.status]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', prefs.theme !== 'light');
  }, [prefs.theme]);

  return (
    <AnalyticsProvider>
      {children}
      <BackgroundServices />
      <Splash />
    </AnalyticsProvider>
  );
}
