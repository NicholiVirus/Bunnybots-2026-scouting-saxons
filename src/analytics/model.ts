/**
 * The analytics model: one TeamStats per team, built from scouting records +
 * official results + pit data. Pure function → unit-testable; the React
 * provider memoizes it. Every stat carries its sample size.
 */
import { CYCLE_WEIGHT_BY_ROBOT_COUNT, DEFAULT_SETTINGS } from '@/config/defaults';
import {
  HARVEST_HAVOC as G,
  MECHANISMS,
  PIECES,
  RELIABILITY_FLAGS,
  SHELVES,
  type DefenseType,
  type Mechanism,
  type Piece,
  type ProblemFlag,
  type RobotRole,
  type Shelf,
  type Target,
} from '@/game/harvestHavoc.config';
import type { MatchRow, PitData, PitReport, RobotReport, ScoutEvent, ScoutSubmission, Team } from '@/data/types';
import { mergePit, validatePit } from '@/catalog/pit';
import { buildRecords, type TeamMatchRecord } from '@/scouting/records';
import { placedPieces } from '@/scouting/derive';
import type { Cycle } from '@/scouting/cycles';
import { mean, median, slope, stdev, summarize, weightedMean, weightedMedian, type Summary } from '@/lib/stats';
import { computeOpr, officialRobotStats, type Component, type OfficialRobotStats } from './opr';
import { teamRecords, type TeamRecord } from './rankings';
import { bradleyTerry, groupsFrom } from './driverRank';

export interface CycleStats {
  n: number;
  median: number;
  mean: number;
  fastest: number;
  sd: number;
  perMatch: number;
  byPiece: Partial<Record<Piece, { median: number; n: number }>>;
  byTarget: Partial<Record<Target | 'haul', { median: number; n: number }>>;
  pickupMedian: number | null;
  deliveryMedian: number | null;
  longGaps: number;
  oneRobotShare: number;
  confidence: 'high' | 'medium' | 'low';
  confidenceLabel: string;
}

export interface MechStat {
  worked: number;
  partial: number;
  failed: number;
  notUsed: number;
  trend: string | null;
  lastFailed: boolean;
}

export interface TeamStats {
  team: string;
  name: string;
  status: Team['status'] | null;
  pit: PitData;
  pitIssues: string[];
  pitReports: number;
  role: RobotRole | null;
  roleInferred: RobotRole | null;
  records: TeamMatchRecord[];
  n: number;
  points: Summary;
  /** Mean of matches with no died / no-show / brownout / E-stop (pairs with reliability). */
  functioningMean: number | null;
  recent3: number | null;
  byCategory: { auto: number; teleop: number; endgame: number; pantryCarrot: number; pantryCake: number; oven: number; taxi: number; park: number; haul: number };
  pieces: { carrot: Record<Shelf, number>; cake: Record<Shelf, number>; ovenCarrot: number; ovenCake: number; cakes: number; l3: number };
  reliability: number | null;
  flagCounts: Partial<Record<ProblemFlag, number>>;
  cycles: CycleStats | null;
  endgame: { parkRate: number | null; haulPoints: number | null; value: number | null; cakeHaulRate: number | null; reliablyHaulsCakes: boolean; source: 'official' | 'scouted' | null };
  cake: { ovenCarrots: number; cakesGenerated: number; feederCredit: number };
  defense: { rate: number; rating: number | null; types: Partial<Record<DefenseType, number>> };
  driver: { rating: number | null; relScore: number | null; relN: number; quickness: number | null; awareness: number | null; defenseResistance: number | null };
  fouls: { pointsPerMatch: number | null; majorsPerMatch: number | null };
  official: {
    opr: number | null;
    components: Partial<Record<Component, number>>;
    robot: OfficialRobotStats | null;
    record: TeamRecord | null;
    rank: number | null;
  };
  oprGap: number | null;
  oprGapFlag: boolean;
  rpRates: { stocked: number | null; baked: number | null; dinner: number | null; n: number };
  series: { matchKey: string; points: number }[];
  trend: 'improving' | 'declining' | 'steady' | null;
  brokeLastMatch: boolean;
  mechanisms: Partial<Record<Mechanism, MechStat>>;
  groundIntakeReliability: 'reliable' | 'inconsistent' | 'unreliable' | null;
  /** Most pieces (carrots + cakes) seen held at match end in any scouted match. */
  maxHaulObserved: number | null;
  notes: { matchKey: string; scout: string; text: string; at: string }[];
  disagreements: number;
}

export interface EventPrior {
  meanPoints: number;
  sdPoints: number;
  /** Average points per cake placed in the Pantry (credits oven feeders). */
  avgCakeValue: number;
  teamsWithData: number;
}

export interface AnalyticsModel {
  teams: Map<string, TeamStats>;
  records: TeamMatchRecord[];
  prior: EventPrior;
  matches: MatchRow[];
}

export interface ModelInput {
  teams: readonly Team[];
  matches: readonly MatchRow[];
  submissions: readonly ScoutSubmission[];
  reports: readonly RobotReport[];
  events: readonly ScoutEvent[];
  pitReports: readonly PitReport[];
  settings?: { cycleBurstWindowSec?: number; cycleOutlierCapSec?: number };
}

const isReliabilityFlag = (f: ProblemFlag) => (RELIABILITY_FLAGS as readonly string[]).includes(f);

function cycleStats(records: TeamMatchRecord[]): CycleStats | null {
  const all: { c: Cycle; w: number; one: boolean }[] = [];
  let matchesWithCycles = 0;
  let longGaps = 0;
  for (const r of records) {
    if (!r.cycles) continue;
    matchesWithCycles++;
    longGaps += r.cycles.longGaps.length;
    for (const c of r.cycles.cycles) all.push({ c, w: r.cycleWeight || CYCLE_WEIGHT_BY_ROBOT_COUNT[3], one: r.cycleRobotCount === 1 });
  }
  if (!all.length) return null;
  const secs = all.map((x) => x.c.durationMs / 1000);
  const ws = all.map((x) => x.w);
  const by = <K extends string>(keyOf: (c: Cycle) => K[]) => {
    const m: Partial<Record<K, { v: number[]; w: number[] }>> = {};
    all.forEach((x) => {
      for (const k of new Set(keyOf(x.c))) {
        const e = (m[k] ??= { v: [], w: [] });
        e.v.push(x.c.durationMs / 1000);
        e.w.push(x.w);
      }
    });
    return Object.fromEntries(Object.entries(m).map(([k, e]) => [k, { median: weightedMedian((e as { v: number[] }).v, (e as { w: number[] }).w), n: (e as { v: number[] }).v.length }]));
  };
  const pick = all.filter((x) => x.c.pickupMs !== null);
  const oneShare = all.filter((x) => x.one).length / all.length;
  const confidence = oneShare >= 0.7 ? 'high' : oneShare >= 0.35 ? 'medium' : 'low';
  return {
    n: all.length,
    median: weightedMedian(secs, ws),
    mean: weightedMean(secs, ws),
    fastest: Math.min(...secs),
    sd: stdev(secs),
    perMatch: all.length / Math.max(1, matchesWithCycles),
    byPiece: by((c) => c.pieces) as CycleStats['byPiece'],
    byTarget: by((c) => c.targets) as CycleStats['byTarget'],
    pickupMedian: pick.length ? median(pick.map((x) => x.c.pickupMs! / 1000)) : null,
    deliveryMedian: pick.length ? median(pick.map((x) => x.c.deliveryMs! / 1000)) : null,
    longGaps,
    oneRobotShare: oneShare,
    confidence,
    confidenceLabel:
      confidence === 'high'
        ? 'mostly 1-robot scouts: ±1 s'
        : confidence === 'medium'
          ? 'mixed scout coverage: ±2 s'
          : 'cycle data mostly from 3-robot scouts: ± a few seconds',
  };
}

function inferRole(s: { defenseRate: number; pieces: TeamStats['pieces']; byCategory: TeamStats['byCategory'] }): RobotRole | null {
  const pantryPieces = SHELVES.reduce((a, l) => a + s.pieces.carrot[l] + s.pieces.cake[l], 0);
  const total = pantryPieces + s.pieces.ovenCarrot + s.pieces.ovenCake;
  if (s.defenseRate >= 0.5 && total < 4) return 'defense';
  if (total <= 0) return s.defenseRate > 0 ? 'defense' : null;
  if (s.pieces.ovenCarrot / total >= 0.5) return 'oven_feeder';
  const pantryPts = s.byCategory.pantryCarrot + s.byCategory.pantryCake;
  if (pantryPts > 0 && s.byCategory.pantryCake / pantryPts >= 0.55) return 'cake_specialist';
  if (pantryPieces / total >= 0.7) return 'pantry';
  return 'hybrid';
}

function mechStats(records: TeamMatchRecord[]): Partial<Record<Mechanism, MechStat>> {
  const out: Partial<Record<Mechanism, MechStat>> = {};
  for (const mech of MECHANISMS) {
    const seq = records.flatMap((r) => (r.mechanisms[mech] ?? []).map((s) => s));
    if (!seq.length) continue;
    const st: MechStat = { worked: 0, partial: 0, failed: 0, notUsed: 0, trend: null, lastFailed: false };
    for (const s of seq) {
      if (s === 'worked') st.worked++;
      else if (s === 'partial') st.partial++;
      else if (s === 'failed') st.failed++;
      else st.notUsed++;
    }
    const used = records.map((r) => (r.mechanisms[mech] ?? []).filter((s) => s !== 'not_used')).filter((a) => a.length);
    const last4 = used.slice(-4).map((a) => (a.includes('failed') ? 'failed' : a.includes('partial') ? 'partial' : 'worked'));
    const failedRecent = last4.filter((x) => x === 'failed').length;
    if (failedRecent >= 2) st.trend = `failed ${failedRecent} of last ${last4.length}`;
    else if (last4.length >= 3 && failedRecent === 0 && st.failed > 0) st.trend = `fixed — worked last ${last4.length}`;
    st.lastFailed = last4[last4.length - 1] === 'failed';
    out[mech] = st;
  }
  return out;
}

export function buildModel(input: ModelInput): AnalyticsModel {
  const cycleOpts = {
    burstWindowMs: (input.settings?.cycleBurstWindowSec ?? DEFAULT_SETTINGS.cycleBurstWindowSec) * 1000,
    outlierCapMs: (input.settings?.cycleOutlierCapSec ?? DEFAULT_SETTINGS.cycleOutlierCapSec) * 1000,
  };
  const matches = [...input.matches];
  const records = buildRecords({
    submissions: input.submissions,
    reports: input.reports,
    events: input.events,
    matches,
    cycleOpts,
    disagreePoints: DEFAULT_SETTINGS.scoutDisagreePoints,
  });
  const recordsBy = new Map<string, TeamMatchRecord[]>();
  for (const r of records) {
    const arr = recordsBy.get(r.team) ?? [];
    arr.push(r);
    recordsBy.set(r.team, arr);
  }

  const opr = computeOpr(matches, 'total');
  const comps: Partial<Record<Component, Map<string, number>>> = {};
  for (const c of ['noFoul', 'pantry', 'oven', 'endgame', 'cakeL3', 'cakePieces', 'ovenCarrots', 'foulsGiven'] as Component[]) comps[c] = computeOpr(matches, c);
  const officialRobots = officialRobotStats(matches);
  const recs = teamRecords(matches);
  const rankOrder = [...recs.values()].sort((a, b) => b.rp / Math.max(1, b.played) - a.rp / Math.max(1, a.played));
  const rankOf = new Map(rankOrder.map((r, i) => [r.team, i + 1]));

  // event-wide cake value (credits oven feeders for cakes their partners score)
  let cakePts = 0;
  let cakeN = 0;
  for (const r of records)
    for (const s of SHELVES) {
      const k = r.totals.auto.pantry.cake[s] + r.totals.teleop.pantry.cake[s];
      cakePts += k * G.points.pantry.cake[s];
      cakeN += k;
    }
  const avgCakeValue = cakeN ? cakePts / cakeN : G.points.pantry.cake.L2;

  // driver relative scores (Bradley–Terry per category, then averaged)
  const relEntries = { q: [] as Parameters<typeof groupsFrom>[0][number][], a: [] as Parameters<typeof groupsFrom>[0][number][], d: [] as Parameters<typeof groupsFrom>[0][number][] };
  for (const r of records)
    for (const s of r.scouts) {
      if (!s.report || s.submission.teams.length < 2) continue;
      const base = { team: r.team, among: s.submission.teams, groupId: s.submission.id };
      relEntries.q.push({ ...base, rank: s.report.rank_quickness });
      relEntries.a.push({ ...base, rank: s.report.rank_awareness });
      relEntries.d.push({ ...base, rank: s.report.rank_defense_resistance });
    }
  const btQ = bradleyTerry(groupsFrom(relEntries.q));
  const btA = bradleyTerry(groupsFrom(relEntries.a));
  const btD = bradleyTerry(groupsFrom(relEntries.d));

  const pitBy = new Map<string, PitReport[]>();
  for (const p of input.pitReports) {
    if (p.deleted_at) continue;
    const arr = pitBy.get(p.team_id) ?? [];
    arr.push(p);
    pitBy.set(p.team_id, arr);
  }

  const teamIds = new Set<string>([...input.teams.filter((t) => !t.deleted_at).map((t) => t.id), ...recordsBy.keys(), ...opr.keys()]);
  const teamMeta = new Map(input.teams.map((t) => [t.id, t]));
  const out = new Map<string, TeamStats>();

  for (const team of teamIds) {
    const rs = recordsBy.get(team) ?? [];
    const pts = rs.map((r) => r.points.total);
    const avgOf = (f: (r: TeamMatchRecord) => number) => (rs.length ? mean(rs.map(f)) : 0);
    const pieces = {
      carrot: Object.fromEntries(SHELVES.map((s) => [s, avgOf((r) => r.totals.auto.pantry.carrot[s] + r.totals.teleop.pantry.carrot[s])])) as Record<Shelf, number>,
      cake: Object.fromEntries(SHELVES.map((s) => [s, avgOf((r) => r.totals.auto.pantry.cake[s] + r.totals.teleop.pantry.cake[s])])) as Record<Shelf, number>,
      ovenCarrot: avgOf((r) => r.totals.auto.oven.carrot + r.totals.teleop.oven.carrot),
      ovenCake: avgOf((r) => r.totals.auto.oven.cake + r.totals.teleop.oven.cake),
      cakes: avgOf((r) => placedPieces(r.totals).cake),
      l3: avgOf((r) => placedPieces(r.totals).byShelf.L3),
    };
    const byCategory = {
      auto: avgOf((r) => r.points.auto),
      teleop: avgOf((r) => r.points.teleop),
      endgame: avgOf((r) => r.points.endgame),
      pantryCarrot: avgOf((r) => r.points.pantryCarrot),
      pantryCake: avgOf((r) => r.points.pantryCake),
      oven: avgOf((r) => r.points.oven),
      taxi: avgOf((r) => r.points.taxi),
      park: avgOf((r) => r.points.park),
      haul: avgOf((r) => r.points.haul),
    };
    const flagCounts: Partial<Record<ProblemFlag, number>> = {};
    for (const r of rs) for (const f of r.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
    const unreliable = rs.filter((r) => r.flags.some(isReliabilityFlag)).length;
    const defenseRecs = rs.filter((r) => r.defense.played);
    const defTypes: Partial<Record<DefenseType, number>> = {};
    for (const r of defenseRecs) if (r.defense.type) defTypes[r.defense.type] = (defTypes[r.defense.type] ?? 0) + 1;
    const defRatings = defenseRecs.map((r) => r.defense.rating).filter((x): x is number => x !== null);
    const drivers = rs.map((r) => r.driverRating).filter((x): x is number => x !== null);
    const off = officialRobots.get(team) ?? null;

    // endgame: official per-robot data is exact; fall back to scouting
    const scoutPark = rs.filter((r) => r.totals.parked !== null);
    const endgameSource = off ? 'official' : scoutPark.length ? 'scouted' : null;
    const parkRate = off ? off.parkRate : scoutPark.length ? scoutPark.filter((r) => r.totals.parked).length / scoutPark.length : null;
    const haulPoints = off ? off.haulPointsMean : rs.length ? byCategory.haul : null;
    const cakeHaulRate = off ? off.cakeHaulRate : rs.length ? rs.filter((r) => r.totals.parked && r.totals.haul.cake >= 1).length / rs.length : null;

    const ovenCarrots = pieces.ovenCarrot;
    const cakesGenerated = ovenCarrots / G.cakeEconomy.ovenCarrotsPerCake;
    const series = rs.map((r) => ({ matchKey: r.matchKey, points: r.points.total }));
    const last6 = pts.slice(-6);
    const sl = slope(last6);
    const recent3 = pts.length ? mean(pts.slice(-3)) : null;
    const trend: TeamStats['trend'] =
      pts.length < 3 ? null : sl > 1.5 && (recent3 ?? 0) >= mean(pts) ? 'improving' : sl < -1.5 && (recent3 ?? 0) <= mean(pts) ? 'declining' : 'steady';
    const mechanisms = mechStats(rs);
    const last = rs[rs.length - 1];
    const brokeLastMatch =
      !!last &&
      (last.flags.some((f) => isReliabilityFlag(f) || f === 'severely_damaged' || f === 'parts_fell_off' || f === 'tipped') ||
        Object.values(last.mechanisms).some((arr) => arr?.includes('failed')));
    const gi = mechanisms.ground_intake;
    let giRel: TeamStats['groundIntakeReliability'] = null;
    if (gi && gi.worked + gi.partial + gi.failed >= 2) {
      const score = (gi.worked + gi.partial * 0.5) / (gi.worked + gi.partial + gi.failed);
      giRel = score >= 0.8 ? 'reliable' : score >= 0.5 ? 'inconsistent' : 'unreliable';
    }
    const pit = mergePit(pitBy.get(team) ?? []);
    const roleInferred = rs.length ? inferRole({ defenseRate: rs.length ? defenseRecs.length / rs.length : 0, pieces, byCategory }) : null;
    const oprV = opr.get(team) ?? null;
    const noFoul = comps.noFoul?.get(team) ?? null;
    const gap = rs.length && noFoul !== null ? mean(pts) - noFoul : null;
    const rec = recs.get(team) ?? null;
    const relScores = [btQ.get(team), btA.get(team), btD.get(team)].filter((x): x is number => x !== undefined);

    out.set(team, {
      team,
      name: teamMeta.get(team)?.name ?? '',
      status: teamMeta.get(team)?.status ?? null,
      pit,
      pitIssues: validatePit(pit),
      pitReports: pitBy.get(team)?.length ?? 0,
      role: pit.role ?? roleInferred,
      roleInferred,
      records: rs,
      n: rs.length,
      points: summarize(pts),
      functioningMean: (() => {
        const ok = rs.filter((r) => !r.flags.some(isReliabilityFlag)).map((r) => r.points.total);
        return ok.length ? mean(ok) : rs.length ? mean(pts) : null;
      })(),
      recent3,
      byCategory,
      pieces,
      reliability: rs.length ? (rs.length - unreliable) / rs.length : null,
      flagCounts,
      cycles: cycleStats(rs),
      endgame: {
        parkRate,
        haulPoints,
        value: parkRate !== null && haulPoints !== null ? G.points.park * parkRate + haulPoints : null,
        cakeHaulRate,
        reliablyHaulsCakes: (cakeHaulRate ?? 0) >= 0.6,
        source: endgameSource,
      },
      cake: { ovenCarrots, cakesGenerated, feederCredit: cakesGenerated * avgCakeValue },
      defense: { rate: rs.length ? defenseRecs.length / rs.length : 0, rating: defRatings.length ? mean(defRatings) : null, types: defTypes },
      driver: {
        rating: drivers.length ? mean(drivers) : null,
        relScore: relScores.length ? mean(relScores) : null,
        relN: relEntries.q.filter((e) => e.team === team && e.rank).length,
        quickness: btQ.get(team) ?? null,
        awareness: btA.get(team) ?? null,
        defenseResistance: btD.get(team) ?? null,
      },
      fouls: { pointsPerMatch: off ? off.foulShare : null, majorsPerMatch: off ? off.majorFoulShare : null },
      official: {
        opr: oprV,
        components: Object.fromEntries(Object.entries(comps).map(([k, m]) => [k, m?.get(team)]).filter(([, v]) => v !== undefined)) as Partial<Record<Component, number>>,
        robot: off,
        record: rec,
        rank: rankOf.get(team) ?? null,
      },
      oprGap: gap,
      oprGapFlag: gap !== null && noFoul !== null && rs.length >= 3 && Math.abs(gap) > Math.max(10, Math.abs(noFoul) * 0.25),
      rpRates: rec?.played
        ? { stocked: rec.stocked / rec.played, baked: rec.baked / rec.played, dinner: rec.dinner / rec.played, n: rec.played }
        : { stocked: null, baked: null, dinner: null, n: 0 },
      series,
      trend,
      brokeLastMatch,
      mechanisms,
      groundIntakeReliability: giRel ?? pit.groundIntakeReliability ?? null,
      maxHaulObserved: rs.length ? Math.max(...rs.map((r) => r.totals.haul.carrot + r.totals.haul.cake)) : null,
      notes: rs.flatMap((r) => r.notes.map((n) => ({ matchKey: r.matchKey, ...n }))),
      disagreements: rs.filter((r) => r.disagree || r.flagDisagree).length,
    });
  }

  const withData = [...out.values()].filter((t) => t.n > 0);
  const teamMeans = withData.map((t) => t.points.mean);
  const oprs = [...opr.values()];
  const prior: EventPrior = withData.length
    ? { meanPoints: mean(teamMeans), sdPoints: Math.max(5, mean(withData.map((t) => (t.points.n > 1 ? t.points.sd : 0))) || stdev(teamMeans) || 10), avgCakeValue, teamsWithData: withData.length }
    : { meanPoints: oprs.length ? mean(oprs) : 30, sdPoints: oprs.length > 1 ? Math.max(5, stdev(oprs)) : 12, avgCakeValue, teamsWithData: 0 };
  return { teams: out, records, prior, matches };
}

export { PIECES };
