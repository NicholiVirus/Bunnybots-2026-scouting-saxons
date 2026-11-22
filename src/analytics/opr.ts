/**
 * OPR from official alliance scores (least squares, small ridge) + component
 * OPRs from the breakdown, and exact per-robot official stats (taxi, park, haul
 * are reported per robot by the field system).
 */
import { HARVEST_HAVOC as G, SHELVES } from '@/game/harvestHavoc.config';
import { allianceScore, robotHaulPoints, type AllianceBreakdown } from '@/game/scoring';
import type { Alliance, MatchRow } from '@/data/types';
import { ridgeLeastSquares } from '@/lib/stats';

export const COMPONENTS = {
  total: 'Total score',
  noFoul: 'Score without foul points',
  pantry: 'Pantry points',
  oven: 'Oven points',
  endgame: 'Endgame points',
  taxi: 'Taxi points',
  carrotPieces: 'Pantry carrots',
  cakePieces: 'Pantry cakes',
  cakeL3: 'L3 cakes',
  ovenCarrots: 'Oven carrots (cake supply)',
  foulsGiven: 'Foul points given away',
} as const;
export type Component = keyof typeof COMPONENTS;

function componentValue(c: Component, m: MatchRow, side: Alliance): number | null {
  const mine = side === 'red' ? m.red_score : m.blue_score;
  const b = m.breakdown?.[side];
  const opp = m.breakdown?.[side === 'red' ? 'blue' : 'red'];
  if (c === 'total') return mine;
  if (!b || !opp) return null;
  const s = allianceScore(b, opp.fouls);
  switch (c) {
    case 'noFoul':
      return s.total - s.fouls;
    case 'pantry':
      return s.pantry;
    case 'oven':
      return s.oven;
    case 'endgame':
      return s.endgame;
    case 'taxi':
      return s.taxi;
    case 'carrotPieces':
      return SHELVES.reduce((a, l) => a + b.pantry.carrot[l], 0);
    case 'cakePieces':
      return SHELVES.reduce((a, l) => a + b.pantry.cake[l], 0);
    case 'cakeL3':
      return b.pantry.cake.L3;
    case 'ovenCarrots':
      return b.oven.carrot;
    case 'foulsGiven':
      return b.fouls.minor * G.points.foul.minor + b.fouls.major * G.points.foul.major;
  }
}

/** team → OPR for one component (quals only; teams without matches are absent). */
export function computeOpr(matches: MatchRow[], component: Component = 'total', lambda = 0.05): Map<string, number> {
  const played = matches.filter((m) => m.comp_level === 'qm' && m.played);
  const teams = [...new Set(played.flatMap((m) => [...m.red, ...m.blue]).filter(Boolean))];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const rows: number[][] = [];
  const b: number[] = [];
  for (const m of played) {
    for (const side of ['red', 'blue'] as const) {
      const v = componentValue(component, m, side);
      if (v === null) continue;
      const r = new Array(teams.length).fill(0);
      for (const t of m[side]) if (t && idx.has(t)) r[idx.get(t)!] = 1;
      rows.push(r);
      b.push(v);
    }
  }
  if (!rows.length) return new Map();
  const x = ridgeLeastSquares(rows, b, teams.length, lambda);
  return new Map(teams.map((t, i) => [t, x[i]]));
}

export interface OfficialRobotStats {
  matches: number;
  taxiRate: number;
  parkRate: number;
  haulPointsMean: number;
  cakeHaulRate: number;
  haulCarrotMean: number;
  haulCakeMean: number;
  /** Alliance-level foul points given away in this team's matches, ÷3 (rough share). */
  foulShare: number;
  majorFoulShare: number;
}

/** Per-robot official facts: taxi / park / haul are reported per driver-station slot. */
export function officialRobotStats(matches: MatchRow[]): Map<string, OfficialRobotStats> {
  const acc = new Map<string, { n: number; taxi: number; park: number; haul: number; cakeHaul: number; hc: number; hk: number; fouls: number; majors: number }>();
  for (const m of matches) {
    if (m.comp_level !== 'qm' || !m.played || !m.breakdown) continue;
    for (const side of ['red', 'blue'] as const) {
      const b: AllianceBreakdown = m.breakdown[side];
      m[side].forEach((t, i) => {
        if (!t) return;
        const a = acc.get(t) ?? { n: 0, taxi: 0, park: 0, haul: 0, cakeHaul: 0, hc: 0, hk: 0, fouls: 0, majors: 0 };
        a.n++;
        if (b.taxi[i]) a.taxi++;
        if (b.park[i]) a.park++;
        a.haul += robotHaulPoints(!!b.park[i], b.haul.carrot[i] ?? 0, b.haul.cake[i] ?? 0);
        if (b.park[i] && (b.haul.cake[i] ?? 0) > 0) a.cakeHaul++;
        a.hc += b.park[i] ? b.haul.carrot[i] ?? 0 : 0;
        a.hk += b.park[i] ? b.haul.cake[i] ?? 0 : 0;
        a.fouls += (b.fouls.minor * G.points.foul.minor + b.fouls.major * G.points.foul.major) / G.allianceSize;
        a.majors += b.fouls.major / G.allianceSize;
        acc.set(t, a);
      });
    }
  }
  const out = new Map<string, OfficialRobotStats>();
  for (const [t, a] of acc)
    out.set(t, {
      matches: a.n,
      taxiRate: a.taxi / a.n,
      parkRate: a.park / a.n,
      haulPointsMean: a.haul / a.n,
      cakeHaulRate: a.cakeHaul / a.n,
      haulCarrotMean: a.hc / a.n,
      haulCakeMean: a.hk / a.n,
      foulShare: a.fouls / a.n,
      majorFoulShare: a.majors / a.n,
    });
  return out;
}
