'use client';
/**
 * Live scouting session: the bundle lives in memory for instant taps and is
 * autosaved to IndexedDB on EVERY change (crash/reload safe). It is queued for
 * the server on status changes (draft → live → submitted) and after edits.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/config/defaults';
import { T_MATCH_END_MS, type Phase, type ProblemFlag } from '@/game/harvestHavoc.config';
import { db } from '@/data/db';
import { saveScoutingBundle, type ScoutingBundle } from '@/data/repo';
import type { Alliance, RobotReport, ScoutEvent, ScoutSubmission, Station } from '@/data/types';
import { getPrefs } from '@/lib/prefs';
import { nowIso, uuid } from '@/lib/util';
import { whoAmI } from '@/sync/auth';
import { makeEvent, removeLatest, type NewEvent } from './derive';

export function emptyReport(submissionId: string, team: string, station: Station): RobotReport {
  return {
    id: `${submissionId}:${team}`,
    submission_id: submissionId,
    team_id: team,
    station,
    note: '',
    driver_rating: null,
    defense_played: false,
    defense_type: null,
    defense_rating: null,
    flags: [],
    mechanisms: {},
    rank_quickness: null,
    rank_awareness: null,
    rank_defense_resistance: null,
    viewed: false,
    totals_override: null,
    updated_at: nowIso(),
  };
}

export function newDraft(matchKey: string, alliance: Alliance, teams: string[], stations: Station[]): ScoutingBundle {
  const id = uuid();
  const me = whoAmI();
  const submission: ScoutSubmission = {
    id,
    match_key: matchKey,
    alliance,
    teams,
    stations,
    robot_count: teams.length,
    scout_id: me.id,
    scout_name: me.name,
    device_id: getPrefs().deviceId,
    status: 'draft',
    started_at: null,
    submitted_at: null,
    source: 'app',
    discarded: false,
    discard_reason: null,
    app_version: APP_VERSION,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  return { submission, reports: teams.map((t, i) => emptyReport(id, t, stations[i])), events: [] };
}

/** Elapsed match time from the persisted Start timestamp (survives reloads). */
export function elapsedMs(b: ScoutingBundle | null, now = Date.now()): number {
  if (!b?.submission.started_at) return 0;
  return Math.max(0, now - b.submission.started_at);
}

export function useScoutSession(initial: ScoutingBundle | null) {
  const [bundle, setBundle] = useState<ScoutingBundle | null>(initial);
  const ref = useRef(bundle);
  ref.current = bundle;
  const [phaseOverride, setPhaseOverride] = useState<Phase | null>(null);

  useEffect(() => setBundle(initial), [initial]);

  const persist = useCallback(async (b: ScoutingBundle, push = false) => {
    await saveScoutingBundle(b, { push });
  }, []);

  const update = useCallback(
    (fn: (b: ScoutingBundle) => ScoutingBundle, push = false) => {
      const cur = ref.current;
      if (!cur) return;
      const next = fn(cur);
      ref.current = next;
      setBundle(next);
      void persist(next, push);
    },
    [persist],
  );

  const tap = useCallback(
    (e: NewEvent) =>
      update((b) => {
        const t = Math.min(elapsedMs(b), T_MATCH_END_MS + 30_000);
        return { ...b, events: [...b.events, makeEvent(b.submission.id, t, phaseOverride, e)] };
      }),
    [update, phaseOverride],
  );

  const undo = useCallback(
    (match: Partial<Pick<ScoutEvent, 'team_id' | 'action' | 'piece' | 'target' | 'detail'>>) => update((b) => ({ ...b, events: removeLatest(b.events, match) })),
    [update],
  );

  const removeAll = useCallback(
    (match: Partial<Pick<ScoutEvent, 'team_id' | 'action' | 'detail'>>) =>
      update((b) => ({
        ...b,
        events: b.events.filter((e) => !(Object.keys(match) as (keyof typeof match)[]).every((k) => e[k] === match[k])),
      })),
    [update],
  );

  const patchReport = useCallback(
    (team: string, patch: Partial<RobotReport>) =>
      update((b) => ({ ...b, reports: b.reports.map((r) => (r.team_id === team ? { ...r, ...patch, updated_at: nowIso() } : r)) })),
    [update],
  );

  const setStatus = useCallback(
    (status: ScoutSubmission['status']) =>
      update(
        (b) => ({
          ...b,
          submission: {
            ...b.submission,
            status,
            started_at: status === 'live' && !b.submission.started_at ? Date.now() : b.submission.started_at,
            submitted_at: status === 'submitted' ? nowIso() : b.submission.submitted_at,
          },
          reports:
            status === 'submitted'
              ? b.reports.map((r) => ({ ...r, flags: r.flags }))
              : b.reports,
        }),
        true,
      ),
    [update],
  );

  return { bundle, setBundle, update, tap, undo, removeAll, patchReport, setStatus, phaseOverride, setPhaseOverride };
}

/** Flags that are "on" right now for a robot (died/browned-out can be revived). */
export function activeFlags(events: readonly ScoutEvent[], team: string): Set<ProblemFlag> {
  const on = new Set<ProblemFlag>();
  for (const e of [...events].filter((x) => x.team_id === team).sort((a, b) => a.t_ms - b.t_ms)) {
    if (e.action === 'flag' && e.detail) on.add(e.detail as ProblemFlag);
    if (e.action === 'revive' && e.detail) on.delete(e.detail as ProblemFlag);
  }
  return on;
}

/** Every flag that happened at any point (for the post-match confirmation). */
export function everFlags(events: readonly ScoutEvent[], team: string): ProblemFlag[] {
  return [...new Set(events.filter((e) => e.team_id === team && e.action === 'flag' && e.detail).map((e) => e.detail as ProblemFlag))];
}

export async function findResumable(deviceId: string): Promise<ScoutingBundle | null> {
  const subs = await db.scout_submissions.filter((s) => s.device_id === deviceId && (s.status === 'live' || s.status === 'draft') && !s.deleted_at).toArray();
  const recent = subs.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!recent) return null;
  const [reports, events] = await Promise.all([
    db.robot_reports.where('submission_id').equals(recent.id).toArray(),
    db.scout_events.where('submission_id').equals(recent.id).toArray(),
  ]);
  return { submission: recent, reports, events };
}
