/**
 * Pick score: weighted, normalized blend of expected contribution, reliability,
 * consistency, FIT with the picking robot (capped-simulation gain: does this
 * team fill our L3 / cake / haul / oven gaps?), defense, driver, floor, fouls,
 * endgame and cycle speed. Separate presets for 1st picks (ceiling + synergy)
 * and 2nd picks (floor + reliability + low fouls). Strategists edit weights.
 */
import type { PickWeights } from '@/data/types';
import { mulberry32, seedFrom } from '@/lib/rng';
import { quantile } from '@/lib/stats';
import type { AnalyticsModel, TeamStats } from './model';
import { simulateAlliance, type TeamPool } from './allianceSim';
import { buildPools, teamStrength } from './strength';

export type PickPreset = 'first' | 'second';
export type StatMode = 'avg' | 'recent' | 'max';

export const WEIGHT_LABEL: Record<keyof PickWeights, string> = {
  contribution: 'Expected points',
  reliability: 'Reliability',
  consistency: 'Consistency',
  fit: 'Fit with our robot',
  defense: 'Defense',
  driver: 'Driver',
  floor: 'Floor (worst games)',
  fouls: 'Low fouls',
  endgame: 'Endgame',
  cycle: 'Cycle speed',
};

export const DEFAULT_WEIGHTS: Record<PickPreset, PickWeights> = {
  first: { contribution: 30, fit: 25, cycle: 10, driver: 10, reliability: 10, consistency: 5, endgame: 5, defense: 5, floor: 0, fouls: 0 },
  second: { contribution: 5, fit: 10, cycle: 0, driver: 5, reliability: 25, consistency: 10, endgame: 15, defense: 10, floor: 15, fouls: 15 },
};

export interface PickRow {
  team: string;
  score: number;
  norm: Record<keyof PickWeights, number>;
  raw: {
    contribution: number;
    reliability: number | null;
    consistency: number | null;
    fitGain: number;
    defense: number;
    driver: number | null;
    floor: number | null;
    fouls: number | null;
    endgame: number | null;
    cycle: number | null;
  };
  reasons: string[];
  n: number;
}

function contributionFor(t: TeamStats | undefined, mode: StatMode, model: AnalyticsModel): number {
  const base = teamStrength(t, model).mu;
  if (!t || !t.n) return base;
  if (mode === 'recent' && t.recent3 !== null) return t.recent3;
  if (mode === 'max') return t.points.max;
  return base;
}

/** Percentile rank in [0, 1]; missing values get `missing`. Higher is better. */
function rankNorm(values: (number | null)[], missing = 0.4): number[] {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length <= 1) return values.map((v) => (v === null ? missing : 0.5));
  const sorted = [...present].sort((a, b) => a - b);
  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return missing;
    const lo = sorted.findIndex((x) => x >= v);
    let hi = lo;
    while (hi + 1 < sorted.length && sorted[hi + 1] === v) hi++;
    return ((lo + hi) / 2) / (sorted.length - 1);
  });
}

export interface PickOptions {
  pickingTeam: string | null;
  /** Already on our alliance (e.g. our 1st pick when ranking 2nd picks). */
  partners?: string[];
  candidates: string[];
  preset: PickPreset;
  mode: StatMode;
  weights?: PickWeights;
  runs?: number;
}

/** Capped-sim gain of adding `team` vs a median "replacement" robot. */
export function fitGains(model: AnalyticsModel, alliance: string[], candidates: string[], runs = 400): Map<string, number> {
  const pools = buildPools(model);
  const eventPool: TeamPool = { team: 'replacement', intents: model.records.length ? pools('__none__').intents : [], borrowed: true, reliability: 0.9 };
  const base = alliance.map(pools);
  const out = new Map<string, number>();
  const seed = seedFrom(`fit:${alliance.join()}`);
  const fillers = Math.max(0, 2 - alliance.length); // alliances have 3 robots
  const baseline = simulateAlliance([...base, eventPool, ...Array(fillers).fill(eventPool)].slice(0, 3), runs, mulberry32(seed), false).mean;
  for (const c of candidates) {
    const withC = simulateAlliance([...base, pools(c), ...Array(fillers).fill(eventPool)].slice(0, 3), runs, mulberry32(seed), false).mean;
    out.set(c, withC - baseline);
  }
  return out;
}

export function pickScores(model: AnalyticsModel, o: PickOptions): PickRow[] {
  const weights = o.weights ?? DEFAULT_WEIGHTS[o.preset];
  const teams = o.candidates.map((c) => model.teams.get(c));
  const alliance = [o.pickingTeam, ...(o.partners ?? [])].filter(Boolean) as string[];
  const gains = alliance.length ? fitGains(model, alliance, o.candidates, o.runs ?? 400) : new Map<string, number>();

  const raw = teams.map((t, i) => {
    const pts = t?.records.map((r) => r.points.total) ?? [];
    return {
      contribution: contributionFor(t, o.mode, model),
      reliability: t?.reliability ?? null,
      consistency: t && t.n >= 2 && t.points.mean > 0 ? 1 - Math.min(1, t.points.sd / t.points.mean) : null,
      fitGain: gains.get(o.candidates[i]) ?? 0,
      defense: t ? t.defense.rate * ((t.defense.rating ?? 3) / 5) : 0,
      driver: t ? (t.driver.relScore !== null ? t.driver.relScore / 100 : t.driver.rating !== null ? t.driver.rating / 5 : null) : null,
      floor: pts.length ? (pts.length <= 4 ? Math.min(...pts) : quantile(pts, 0.2)) : null,
      fouls: t?.fouls.pointsPerMatch ?? null,
      endgame: t?.endgame.value ?? null,
      cycle: t?.cycles?.median ?? null,
    };
  });

  const norm = {
    contribution: rankNorm(raw.map((r) => r.contribution)),
    reliability: rankNorm(raw.map((r) => r.reliability)),
    consistency: rankNorm(raw.map((r) => r.consistency)),
    fit: alliance.length ? rankNorm(raw.map((r) => r.fitGain)) : raw.map(() => 0.5),
    defense: rankNorm(raw.map((r) => r.defense), 0.3),
    driver: rankNorm(raw.map((r) => r.driver)),
    floor: rankNorm(raw.map((r) => r.floor)),
    fouls: rankNorm(raw.map((r) => (r.fouls === null ? null : -r.fouls))),
    endgame: rankNorm(raw.map((r) => r.endgame)),
    cycle: rankNorm(raw.map((r) => (r.cycle === null ? null : -r.cycle))),
  };
  const keys = Object.keys(weights) as (keyof PickWeights)[];
  const wsum = keys.reduce((a, k) => a + Math.max(0, weights[k]), 0) || 1;

  return o.candidates
    .map((team, i) => {
      const n = Object.fromEntries(keys.map((k) => [k, norm[k][i]])) as Record<keyof PickWeights, number>;
      const contrib = keys.map((k) => [k, (Math.max(0, weights[k]) * n[k]) / wsum] as const).sort((a, b) => b[1] - a[1]);
      const r = raw[i];
      const why = (k: keyof PickWeights): string | null => {
        switch (k) {
          case 'fit':
            return alliance.length ? `fit: ${r.fitGain >= 0 ? '+' : ''}${r.fitGain.toFixed(1)} pts with ${alliance.join('+')}` : null;
          case 'contribution':
            return `${r.contribution.toFixed(0)} pts/match (${o.mode})`;
          case 'cycle':
            return r.cycle !== null ? `fast cycles (${r.cycle.toFixed(1)} s median)` : null;
          case 'reliability':
            return r.reliability !== null ? `reliable (${Math.round(r.reliability * 100)}%)` : null;
          case 'floor':
            return r.floor !== null ? `high floor (${r.floor.toFixed(0)} pts worst)` : null;
          case 'fouls':
            return r.fouls !== null ? `low fouls (${r.fouls.toFixed(1)} pts/match given)` : null;
          case 'endgame':
            return r.endgame !== null ? `endgame ${r.endgame.toFixed(1)} pts` : null;
          case 'defense':
            return r.defense > 0 ? 'plays defense' : null;
          case 'driver':
            return r.driver !== null ? 'strong driver' : null;
          case 'consistency':
            return r.consistency !== null ? 'consistent' : null;
        }
      };
      return {
        team,
        score: Math.round(contrib.reduce((a, [, v]) => a + v, 0) * 1000) / 10,
        norm: n,
        raw: r,
        reasons: contrib
          .filter(([k]) => n[k] >= 0.6)
          .map(([k]) => why(k))
          .filter((x): x is string => !!x)
          .slice(0, 3),
        n: teams[i]?.n ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);
}
