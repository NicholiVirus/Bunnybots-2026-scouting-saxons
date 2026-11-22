/** Main-thread preparation of compact, serializable inputs for the event simulator. */
import type { MatchRow, OfficialAlliance, RankingRow, DraftAction } from '@/data/types';
import type { AnalyticsModel } from '@/analytics/model';
import { teamRecords, computeRankings } from '@/analytics/rankings';
import { allianceMuSd, winProbability } from '@/analytics/predict';
import { buildPools } from '@/analytics/strength';
import { intentFromRecord, simulateAlliance } from '@/analytics/allianceSim';
import type { PickRow } from '@/analytics/pickScore';
import { mulberry32, seedFrom } from '@/lib/rng';
import type { SimInputs, TeamRec } from './eventSim';
import type { DraftStep } from './draft';

export function rankedTeams(matches: readonly MatchRow[], official: readonly RankingRow[], withdrawn: Set<string>): string[] {
  const rows = official.length ? [...official].sort((a, b) => a.rank - b.rank) : computeRankings([...matches]).filter((r) => r.matches_played > 0);
  return rows.map((r) => r.team_id).filter((t) => !withdrawn.has(t));
}

export function draftSteps(actions: readonly DraftAction[]): DraftStep[] {
  return [...actions]
    .filter((a) => !a.deleted_at)
    .sort((a, b) => a.seq - b.seq)
    .map((a) => ({ action: a.action, alliance: a.alliance, team_id: a.team_id, payload: a.payload }));
}

export function buildSimInputs(
  model: AnalyticsModel,
  o: {
    matches: readonly MatchRow[];
    ranked: string[];
    allianceCount: number;
    actions: readonly DraftAction[];
    official: readonly OfficialAlliance[];
    useOfficial: boolean;
    first: PickRow[];
    second: PickRow[];
    guesses: Record<string, string>;
    rpRuns?: number;
  },
): SimInputs {
  const recs = teamRecords([...o.matches]);
  const records: Record<string, TeamRec> = {};
  for (const [t, r] of recs) records[t] = { played: r.played, wins: r.wins, losses: r.losses, ties: r.ties, rp: r.rp, cumScore: r.cumScore };
  const pools = buildPools(model);
  const rng = mulberry32(seedFrom(`rpodds:${o.matches.length}`));
  const remaining = o.matches
    .filter((m) => m.comp_level === 'qm' && !m.played && m.red.every(Boolean) && m.blue.every(Boolean))
    .map((m) => {
      const r = allianceMuSd(m.red, m.blue, model);
      const b = allianceMuSd(m.blue, m.red, model);
      const sr = simulateAlliance(m.red.map(pools), o.rpRuns ?? 300, rng, false);
      const sb = simulateAlliance(m.blue.map(pools), o.rpRuns ?? 300, rng, false);
      return {
        key: m.key,
        red: m.red,
        blue: m.blue,
        pRed: winProbability(r, b),
        rpRed: [sr.rp.stocked, sr.rp.baked, sr.rp.dinner] as [number, number, number],
        rpBlue: [sb.rp.stocked, sb.rp.baked, sb.rp.dinner] as [number, number, number],
        muRed: r.mu,
        muBlue: b.mu,
      };
    });
  const teams = o.ranked.length ? o.ranked : [...model.teams.keys()];
  const poolMap: SimInputs['pools'] = {};
  for (const t of teams) {
    const st = model.teams.get(t);
    if (st?.records.length) poolMap[t] = st.records.map(intentFromRecord);
  }
  return {
    teams,
    records,
    remaining,
    allianceCount: o.allianceCount,
    pickValue1: Object.fromEntries(o.first.map((r) => [r.team, r.score])),
    pickValue2: Object.fromEntries(o.second.map((r) => [r.team, r.score])),
    guesses: o.guesses,
    pools: poolMap,
    eventPool: model.records.map(intentFromRecord),
    draftSteps: draftSteps(o.actions),
    official: o.useOfficial && o.official.length ? o.official.map((a) => ({ number: a.number, captain: a.captain, first_pick: a.first_pick, second_pick: a.second_pick })) : null,
    rankedNow: remaining.length ? [] : teams,
    noise: 8,
  };
}
