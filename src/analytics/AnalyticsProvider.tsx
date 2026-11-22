'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useSettings } from '@/data/hooks';
import { buildModel, type AnalyticsModel } from './model';

const Ctx = createContext<AnalyticsModel | null>(null);

/** Builds the analytics model once for the whole app (recomputes on any data change). */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const teams = useLiveQuery(() => db.teams.toArray(), []);
  const matches = useLiveQuery(() => db.matches.toArray(), []);
  const submissions = useLiveQuery(() => db.scout_submissions.toArray(), []);
  const reports = useLiveQuery(() => db.robot_reports.toArray(), []);
  const events = useLiveQuery(() => db.scout_events.toArray(), []);
  const pitReports = useLiveQuery(() => db.pit_reports.toArray(), []);
  const settings = useSettings();
  const model = useMemo(() => {
    if (!teams || !matches || !submissions || !reports || !events || !pitReports) return null;
    return buildModel({
      teams,
      matches,
      submissions,
      reports,
      events,
      pitReports,
      settings: { cycleBurstWindowSec: settings.cycleBurstWindowSec, cycleOutlierCapSec: settings.cycleOutlierCapSec },
    });
  }, [teams, matches, submissions, reports, events, pitReports, settings.cycleBurstWindowSec, settings.cycleOutlierCapSec]);
  return <Ctx.Provider value={model}>{children}</Ctx.Provider>;
}

/** null while IndexedDB is loading. */
export function useAnalytics(): AnalyticsModel | null {
  return useContext(Ctx);
}
