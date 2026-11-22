'use client';
/** Everything Alliance Selection Mode needs, derived once per render. */
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useMatches, useSettings } from '@/data/hooks';
import { deleteRows, putRow } from '@/data/repo';
import type { DraftAction, PicklistEntry, PicklistMeta, PickWeights } from '@/data/types';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { DEFAULT_WEIGHTS, pickScores, type PickPreset, type StatMode } from '@/analytics/pickScore';
import { deriveDraft, allianceOfTeam, type DraftState } from '@/selection/draft';
import { draftSteps, rankedTeams } from '@/selection/inputs';
import { usePrefs } from '@/lib/prefs';
import { nowIso, uuid } from '@/lib/util';
import { useAuth, whoAmI, can } from '@/sync/auth';

export function useSelection(statMode: StatMode = 'avg') {
  const prefs = usePrefs();
  const auth = useAuth();
  const settings = useSettings();
  const model = useAnalytics();
  const matches = useMatches() ?? [];
  const actions = useLiveQuery(() => db.draft_actions.toArray(), [], []);
  const official = useLiveQuery(() => db.official_alliances.toArray(), [], []);
  const rankings = useLiveQuery(() => db.rankings.toArray(), [], []);
  const teamsRows = useLiveQuery(() => db.teams.toArray(), [], []);
  const pickingAs = prefs.pickingAs || '611';
  const entries = useLiveQuery(() => db.picklist_entries.where('picking_team').equals(pickingAs).toArray(), [pickingAs], []);
  const votes = useLiveQuery(() => db.picklist_votes.where('picking_team').equals(pickingAs).toArray(), [pickingAs], []);
  const meta = useLiveQuery(() => db.picklist_meta.get(pickingAs), [pickingAs]);

  const withdrawn = useMemo(() => new Set(teamsRows.filter((t) => t.status === 'withdrawn').map((t) => t.id)), [teamsRows]);
  const ranked = useMemo(() => rankedTeams(matches, rankings, withdrawn), [matches, rankings, withdrawn]);
  const steps = useMemo(() => draftSteps(actions), [actions]);
  const officialHasPicks = official.some((a) => a.first_pick || a.second_pick);
  const useOfficial = settings.draftSource === 'official' ? official.length > 0 : settings.draftSource === 'auto' ? officialHasPicks : false;
  const draft: DraftState = useMemo(
    () => deriveDraft(ranked, settings.allianceCount, steps, useOfficial ? official : null),
    [ranked, settings.allianceCount, steps, useOfficial, official],
  );
  const ours = allianceOfTeam(draft, pickingAs);
  /** Teams already on OUR alliance (for fit when ranking 2nd picks). */
  const ourAlliance = ours ? draft.alliances[ours.number - 1] : null;
  const partners = ourAlliance ? ([ourAlliance.captain, ...ourAlliance.picks].filter((t) => t && t !== pickingAs) as string[]) : [];

  const weights: Record<PickPreset, PickWeights> = {
    first: meta?.weights_first ?? DEFAULT_WEIGHTS.first,
    second: meta?.weights_second ?? DEFAULT_WEIGHTS.second,
  };
  const candidates = useMemo(() => ranked.filter((t) => t !== pickingAs), [ranked, pickingAs]);
  const first = useMemo(
    () => (model ? pickScores(model, { pickingTeam: pickingAs, partners: partners.length ? partners.slice(0, 0) : [], candidates, preset: 'first', mode: statMode, weights: weights.first, runs: 250 }) : []),
    [model, pickingAs, candidates, statMode, weights.first], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const second = useMemo(
    () => (model ? pickScores(model, { pickingTeam: pickingAs, partners, candidates, preset: 'second', mode: statMode, weights: weights.second, runs: 250 }) : []),
    [model, pickingAs, partners.join(), candidates, statMode, weights.second], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const locked = !!meta?.locked;
  const canEditList = can.editPicklist(auth.role) && (!locked || can.admin(auth.role));
  const canEditBoard = can.editBoard(auth.role);

  // ── writes ──
  const me = whoAmI();
  const addAction = async (a: Pick<DraftAction, 'action' | 'alliance' | 'team_id'> & { payload?: Record<string, unknown> | null }) => {
    const row: DraftAction = {
      id: uuid(),
      seq: Date.now() + Math.random() / 10,
      action: a.action,
      alliance: a.alliance,
      team_id: a.team_id,
      payload: a.payload ?? null,
      created_by: me.id,
      created_by_name: me.name,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await putRow('draft_actions', row);
  };
  const undo = async () => {
    const live = [...actions].filter((x) => !x.deleted_at).sort((a, b) => b.seq - a.seq);
    if (live[0]) await deleteRows('draft_actions', [live[0]]);
  };
  const resetBoard = async () => {
    await deleteRows(
      'draft_actions',
      actions.filter((x) => !x.deleted_at),
    );
  };

  const saveEntry = async (e: Partial<PicklistEntry> & { team_id: string }) => {
    const existing = entries.find((x) => x.team_id === e.team_id);
    const row: PicklistEntry = {
      id: `${pickingAs}:${e.team_id}`,
      picking_team: pickingAs,
      team_id: e.team_id,
      tier: e.tier ?? existing?.tier ?? 'first',
      position: e.position ?? existing?.position ?? Date.now(),
      note: e.note !== undefined ? e.note : existing?.note ?? null,
      dnp_reason: e.dnp_reason !== undefined ? e.dnp_reason : existing?.dnp_reason ?? null,
      dnp_note: e.dnp_note !== undefined ? e.dnp_note : existing?.dnp_note ?? null,
      updated_by: me.id,
      updated_at: nowIso(),
    };
    await putRow('picklist_entries', row);
  };
  const removeEntry = async (team: string) => {
    const existing = entries.find((x) => x.team_id === team);
    if (existing) await deleteRows('picklist_entries', [existing]);
  };
  const saveMeta = async (patch: Partial<PicklistMeta>) => {
    const row: PicklistMeta = {
      picking_team: pickingAs,
      locked: meta?.locked ?? false,
      locked_by: meta?.locked_by ?? null,
      locked_at: meta?.locked_at ?? null,
      weights_first: meta?.weights_first ?? null,
      weights_second: meta?.weights_second ?? null,
      captain_guesses: meta?.captain_guesses ?? null,
      updated_at: nowIso(),
      ...patch,
    };
    await putRow('picklist_meta', row);
  };

  return {
    prefs,
    auth,
    settings,
    model,
    matches,
    ranked,
    draft,
    ours,
    partners,
    pickingAs,
    entries,
    votes,
    meta,
    weights,
    first,
    second,
    locked,
    canEditList,
    canEditBoard,
    useOfficial,
    official,
    actions,
    addAction,
    undo,
    resetBoard,
    saveEntry,
    removeEntry,
    saveMeta,
  };
}

export type Selection = ReturnType<typeof useSelection>;
