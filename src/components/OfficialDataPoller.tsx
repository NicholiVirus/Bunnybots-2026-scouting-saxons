'use client';
/**
 * Event-day poller for The Bunnybots Alliance (every 30 s by default). Every
 * device polls directly (CORS is open); an admin's device also forwards
 * changes to Supabase. In the demo sandbox it loads 449's simulated event.
 */
import { useEffect, useRef } from 'react';
import { useSettings, loadTeamIdContext } from '@/data/hooks';
import { usePrefs } from '@/lib/prefs';
import { BunnybotsAllianceSource } from '@/sources/bunnybotsAlliance';
import { applyOfficialData, markOfficialSuccess, officialStore, restoreOfficialState, refreshComputedRankings } from '@/sources/apply';
import { ensureDemoLoaded } from '@/sources/demo';
import { useAuth } from '@/sync/auth';
import { db } from '@/data/db';
import { ROSTER } from '@/config/event';
import { checkFeedAgainstRoster, rosterGuardMessage } from '@/sources/rosterGuard';

export async function pollOfficialNow(base: string) {
  if (!base) return;
  officialStore.set({ polling: true, lastAttemptAt: Date.now() });
  try {
    const ctx = await loadTeamIdContext();
    const data = await new BunnybotsAllianceSource(base, ctx).fetch();
    // never let placeholder / another event's data overwrite ours
    const teams = await db.teams.toArray();
    const check = checkFeedAgainstRoster(data, teams.length ? teams.map((t) => t.id) : ROSTER.map((t) => t.id));
    if (!check.ok) {
      officialStore.set({ lastError: rosterGuardMessage(check) });
      return;
    }
    await applyOfficialData(data);
    if (!data.rankings.length) await refreshComputedRankings('api');
    await markOfficialSuccess('api', data.warnings);
  } catch (e) {
    officialStore.set({ lastError: (e as Error)?.message || String(e) });
  } finally {
    officialStore.set({ polling: false });
  }
}

export function OfficialDataPoller() {
  const settings = useSettings();
  const prefs = usePrefs();
  const auth = useAuth();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void restoreOfficialState();
  }, []);

  useEffect(() => {
    if (prefs.demo) void ensureDemoLoaded().catch((e) => officialStore.set({ lastError: String(e?.message ?? e) }));
  }, [prefs.demo]);

  const ready = auth.status === 'local' || auth.status === 'signed_in';
  const base = settings.tbaUrl;
  const live = !prefs.demo && ready && settings.dataMode === 'live' && !!base;

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (!live) return;
    const tick = () => {
      if (navigator.onLine && document.visibilityState === 'visible') void pollOfficialNow(base);
    };
    tick();
    timer.current = setInterval(tick, settings.pollIntervalSec * 1000);
    const onOnline = () => tick();
    const onVisible = () => document.visibilityState === 'visible' && tick();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer.current) clearInterval(timer.current);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live, base, settings.pollIntervalSec]);

  return null;
}
