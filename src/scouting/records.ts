/**
 * Submissions → one record per (match, team). When 2+ scouts covered the same
 * robot: counts are AVERAGED, cycle timestamps come from the scout who watched
 * the FEWEST robots (most precise), and big disagreements are flagged.
 */
import { CYCLE_WEIGHT_BY_ROBOT_COUNT } from '@/config/defaults';
import { INTAKE_SOURCES, SHELVES, type DefenseType, type Mechanism, type MechStatus, type ProblemFlag } from '@/game/harvestHavoc.config';
import type { Alliance, MatchRow, RobotReport, ScoutEvent, ScoutSubmission, Station } from '@/data/types';
import { computeCycles, type CycleOptions, type CycleResult } from './cycles';
import { emptyTotals, robotPoints, totalsFromEvents, totalsFromOverride, type RobotPoints, type RobotTotals } from './derive';

export interface ScoutedRobot {
  team: string;
  submission: ScoutSubmission;
  report: RobotReport | undefined;
  events: ScoutEvent[];
  totals: RobotTotals;
  points: RobotPoints;
  cycles: CycleResult | null;
}

export interface TeamMatchRecord {
  key: string;
  team: string;
  matchKey: string;
  matchNumber: number;
  compLevel: 'qm' | 'po';
  alliance: Alliance;
  station: Station | null;
  scouts: ScoutedRobot[];
  totals: RobotTotals;
  points: RobotPoints;
  /** Cycles from the most precise scout (fewest robots watched). */
  cycles: CycleResult | null;
  cycleRobotCount: number | null;
  cycleWeight: number;
  flags: ProblemFlag[];
  flagDisagree: boolean;
  defense: { played: boolean; type: DefenseType | null; rating: number | null };
  driverRating: number | null;
  notes: { scout: string; text: string; at: string }[];
  mechanisms: Partial<Record<Mechanism, MechStatus[]>>;
  /** Relative ranks this robot got from multi-robot scouts. */
  relRanks: { among: string[]; quickness: number | null; awareness: number | null; defenseResistance: number | null }[];
  pointsSpread: number;
  disagree: boolean;
  totalsOnly: boolean;
}

export interface BuildRecordsInput {
  submissions: readonly ScoutSubmission[];
  reports: readonly RobotReport[];
  events: readonly ScoutEvent[];
  matches: readonly MatchRow[];
  cycleOpts: CycleOptions;
  disagreePoints: number;
}

function avgTotals(list: RobotTotals[]): RobotTotals {
  if (list.length === 1) return list[0];
  const n = list.length;
  const t = emptyTotals();
  const avg = (f: (x: RobotTotals) => number) => list.reduce((a, x) => a + f(x), 0) / n;
  const maj = (f: (x: RobotTotals) => boolean | null) => {
    const known = list.map(f).filter((v) => v !== null);
    return known.length ? known.filter(Boolean).length * 2 >= known.length : null;
  };
  for (const s of SHELVES) {
    t.auto.pantry.carrot[s] = avg((x) => x.auto.pantry.carrot[s]);
    t.auto.pantry.cake[s] = avg((x) => x.auto.pantry.cake[s]);
    t.teleop.pantry.carrot[s] = avg((x) => x.teleop.pantry.carrot[s]);
    t.teleop.pantry.cake[s] = avg((x) => x.teleop.pantry.cake[s]);
  }
  t.auto.oven = { carrot: avg((x) => x.auto.oven.carrot), cake: avg((x) => x.auto.oven.cake) };
  t.teleop.oven = { carrot: avg((x) => x.teleop.oven.carrot), cake: avg((x) => x.teleop.oven.cake) };
  t.auto.unknownLevelCarrots = avg((x) => x.auto.unknownLevelCarrots);
  t.auto.taxi = maj((x) => x.auto.taxi);
  t.parked = maj((x) => x.parked);
  t.haul = { carrot: avg((x) => x.haul.carrot), cake: avg((x) => x.haul.cake) };
  for (const s of INTAKE_SOURCES) t.intakes[s] = avg((x) => x.intakes[s]);
  t.drops = avg((x) => x.drops);
  t.handoffs = avg((x) => x.handoffs);
  t.flags = [...new Set(list.flatMap((x) => x.flags))];
  return t;
}

function avgPoints(list: RobotPoints[]): RobotPoints {
  if (list.length === 1) return list[0];
  const keys = Object.keys(list[0]) as (keyof RobotPoints)[];
  return Object.fromEntries(keys.map((k) => [k, list.reduce((a, p) => a + p[k], 0) / list.length])) as unknown as RobotPoints;
}

export function scoutedRobots(input: BuildRecordsInput): ScoutedRobot[] {
  const live = input.submissions.filter((s) => s.status === 'submitted' && !s.discarded && !s.deleted_at);
  const reportsBy = new Map<string, RobotReport>();
  for (const r of input.reports) reportsBy.set(`${r.submission_id}:${r.team_id}`, r);
  const eventsBy = new Map<string, ScoutEvent[]>();
  for (const e of input.events) {
    const k = `${e.submission_id}:${e.team_id}`;
    const arr = eventsBy.get(k);
    if (arr) arr.push(e);
    else eventsBy.set(k, [e]);
  }
  const out: ScoutedRobot[] = [];
  for (const s of live) {
    for (const team of s.teams) {
      const report = reportsBy.get(`${s.id}:${team}`);
      const events = eventsBy.get(`${s.id}:${team}`) ?? [];
      const totals = report?.totals_override ? totalsFromOverride(report.totals_override) : totalsFromEvents(events);
      // flags confirmed post-match (report) win over the live taps
      if (report) totals.flags = [...new Set([...report.flags])];
      out.push({
        team,
        submission: s,
        report,
        events,
        totals,
        points: robotPoints(totals),
        cycles: report?.totals_override ? null : computeCycles(events, input.cycleOpts),
      });
    }
  }
  return out;
}

export function buildRecords(input: BuildRecordsInput): TeamMatchRecord[] {
  const matchBy = new Map(input.matches.map((m) => [m.key, m]));
  const groups = new Map<string, ScoutedRobot[]>();
  for (const r of scoutedRobots(input)) {
    const key = `${r.submission.match_key}:${r.team}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const records: TeamMatchRecord[] = [];
  for (const [key, scouts] of groups) {
    const [matchKey, team] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1)];
    const m = matchBy.get(matchKey);
    const s0 = scouts[0].submission;
    const totals = avgTotals(scouts.map((s) => s.totals));
    const points = avgPoints(scouts.map((s) => s.points));
    const withCycles = scouts.filter((s) => s.cycles && s.events.length);
    const best = [...withCycles].sort(
      (a, b) =>
        a.submission.robot_count - b.submission.robot_count ||
        b.events.length - a.events.length ||
        String(a.submission.submitted_at).localeCompare(String(b.submission.submitted_at)),
    )[0];
    const flagSigs = scouts.map((s) => [...s.totals.flags].sort().join(','));
    const reports = scouts.map((s) => s.report).filter(Boolean) as RobotReport[];
    const defenseVotes = reports.filter((r) => r.defense_played).length;
    const defenseTypes = reports.map((r) => r.defense_type).filter(Boolean) as DefenseType[];
    const ratings = reports.map((r) => r.defense_rating).filter((x): x is number => x !== null && x !== undefined);
    const drivers = reports.map((r) => r.driver_rating).filter((x): x is number => x !== null && x !== undefined);
    const mech: Partial<Record<Mechanism, MechStatus[]>> = {};
    for (const r of reports)
      for (const [k, v] of Object.entries(r.mechanisms ?? {})) {
        if (!v) continue;
        (mech[k as Mechanism] ??= []).push(v.status);
      }
    const totalsList = scouts.map((s) => s.points.total);
    const spread = Math.max(...totalsList) - Math.min(...totalsList);
    const station = (scouts[0].report?.station ?? null) as Station | null;
    const alliance: Alliance = m ? (m.red.includes(team) ? 'red' : 'blue') : s0.alliance;
    records.push({
      key,
      team,
      matchKey,
      matchNumber: m?.match_number ?? (Number(matchKey.replace(/\D/g, '')) || 0),
      compLevel: m?.comp_level ?? (matchKey.startsWith('Q') ? 'qm' : 'po'),
      alliance,
      station,
      scouts,
      totals,
      points,
      cycles: best?.cycles ?? null,
      cycleRobotCount: best ? best.submission.robot_count : null,
      cycleWeight: best ? CYCLE_WEIGHT_BY_ROBOT_COUNT[best.submission.robot_count] ?? 0.35 : 0,
      flags: totals.flags,
      flagDisagree: new Set(flagSigs).size > 1,
      defense: {
        played: reports.length > 0 && defenseVotes * 2 >= reports.length && defenseVotes > 0,
        type: defenseTypes.sort((a, b) => defenseTypes.filter((x) => x === b).length - defenseTypes.filter((x) => x === a).length)[0] ?? null,
        rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      },
      driverRating: drivers.length ? drivers.reduce((a, b) => a + b, 0) / drivers.length : null,
      notes: reports
        .filter((r) => r.note?.trim())
        .map((r) => ({ scout: scouts.find((s) => s.report === r)?.submission.scout_name ?? '', text: r.note.trim(), at: r.updated_at })),
      mechanisms: mech,
      relRanks: scouts
        .filter((s) => s.submission.teams.length > 1 && s.report && (s.report.rank_quickness || s.report.rank_awareness || s.report.rank_defense_resistance))
        .map((s) => ({
          among: s.submission.teams,
          quickness: s.report!.rank_quickness,
          awareness: s.report!.rank_awareness,
          defenseResistance: s.report!.rank_defense_resistance,
        })),
      pointsSpread: spread,
      disagree: scouts.length > 1 && spread > input.disagreePoints,
      totalsOnly: scouts.every((s) => !!s.report?.totals_override),
    });
  }
  return records.sort((a, b) => (a.compLevel === b.compLevel ? a.matchNumber - b.matchNumber : a.compLevel === 'qm' ? -1 : 1));
}
