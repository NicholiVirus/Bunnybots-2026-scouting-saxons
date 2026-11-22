'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import type { ProblemFlag } from '@/game/harvestHavoc.config';
import { db } from './db';

export interface FlagInfo {
  flags: ProblemFlag[];
  /** Scouts disagreed about the flags for this robot in this match. */
  disagree: boolean;
  byScout: { scout: string; flags: ProblemFlag[] }[];
}

/** `${matchKey}:${team}` → problem flags reported by scouts. */
export function useFlagIndex(): Map<string, FlagInfo> {
  const subs = useLiveQuery(() => db.scout_submissions.filter((s) => s.status === 'submitted' && !s.discarded).toArray(), [], []);
  const reports = useLiveQuery(() => db.robot_reports.toArray(), [], []);
  return useMemo(() => {
    const subById = new Map(subs.map((s) => [s.id, s]));
    const m = new Map<string, FlagInfo>();
    for (const r of reports) {
      const s = subById.get(r.submission_id);
      if (!s) continue;
      const k = `${s.match_key}:${r.team_id}`;
      const e = m.get(k) ?? { flags: [], disagree: false, byScout: [] };
      e.byScout.push({ scout: s.scout_name, flags: r.flags });
      m.set(k, e);
    }
    for (const e of m.values()) {
      const all = new Set(e.byScout.flatMap((b) => b.flags));
      e.flags = [...all];
      const sig = e.byScout.map((b) => [...b.flags].sort().join(','));
      e.disagree = new Set(sig).size > 1;
    }
    return m;
  }, [subs, reports]);
}
