/**
 * Team strength for predictions: expected points μ and variance σ².
 *  - scouted mean, blended toward a fallback with weight n / (n + k): teams with
 *    < 2 matches lean on the event prior / OPR (label: "estimate");
 *  - fallback = no-foul OPR if available, else a CYCLE-IMPLIED estimate
 *    (teleop seconds ÷ median cycle × points per delivery), else the event prior;
 *  - scaled by reliability (blended toward 90%).
 */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { HARVEST_HAVOC as G, T_AUTO_END_MS, T_ENDGAME_START_MS } from '@/game/harvestHavoc.config';
import type { AnalyticsModel, TeamStats } from './model';
import { intentFromRecord, type TeamPool } from './allianceSim';

export interface Strength {
  team: string;
  mu: number;
  variance: number;
  /** points per match this team's fouls hand to opponents */
  foulsGiven: number;
  n: number;
  source: 'scouted' | 'blended' | 'opr' | 'cycles' | 'prior';
}

const RELIABILITY_PRIOR = 0.9;

/** Points per match implied by cycle speed (helps when a team has 1–2 matches). */
export function cycleImpliedPoints(t: TeamStats): number | null {
  if (!t.cycles || t.cycles.median <= 0 || !t.n) return null;
  const teleopScoringSec = (T_ENDGAME_START_MS - T_AUTO_END_MS) / 1000 + 10; // most of endgame too
  const deliveries = teleopScoringSec / t.cycles.median;
  const placed = t.pieces.ovenCarrot + t.pieces.ovenCake + t.pieces.cakes + Object.values(t.pieces.carrot).reduce((a, b) => a + b, 0);
  const placementPts = t.byCategory.pantryCarrot + t.byCategory.pantryCake + t.byCategory.oven;
  const perPiece = placed > 0 ? placementPts / placed : G.points.pantry.carrot.L2;
  const piecesPerDelivery = t.cycles.perMatch > 0 ? Math.max(1, placed / t.cycles.perMatch) : 1;
  return deliveries * piecesPerDelivery * perPiece + t.byCategory.auto + (t.endgame.value ?? t.byCategory.endgame);
}

export function teamStrength(t: TeamStats | undefined, model: AnalyticsModel, k = DEFAULT_SETTINGS.priorMatches): Strength {
  const prior = model.prior;
  if (!t) return { team: '?', mu: prior.meanPoints, variance: prior.sdPoints ** 2, foulsGiven: 0, n: 0, source: 'prior' };
  const opr = t.official.components.noFoul ?? t.official.opr ?? null;
  const oprN = t.official.record?.played ?? 0;
  const cycleEst = t.n > 0 && t.n < 3 ? cycleImpliedPoints(t) : null;
  let fallback = prior.meanPoints;
  let fbSource: Strength['source'] = 'prior';
  if (opr !== null && oprN >= 2) {
    fallback = Math.max(0, opr);
    fbSource = 'opr';
  } else if (cycleEst !== null) {
    fallback = cycleEst;
    fbSource = 'cycles';
  }
  const n = t.n;
  const w = n / (n + k);
  // scouted part = functioning mean × (shrunk) reliability; fallback already includes failures
  const rel = t.reliability === null ? RELIABILITY_PRIOR : (t.reliability * n + RELIABILITY_PRIOR * k) / (n + k);
  const scouted = n ? (t.functioningMean ?? t.points.mean) * rel : fallback;
  const mu0 = w * scouted + (1 - w) * fallback;
  const sampleVar = n >= 2 ? t.points.sd ** 2 : prior.sdPoints ** 2;
  const variance = w * sampleVar + (1 - w) * prior.sdPoints ** 2;
  return {
    team: t.team,
    mu: mu0,
    variance,
    foulsGiven: t.fouls.pointsPerMatch ?? 0,
    n,
    source: n >= 4 ? 'scouted' : n > 0 ? 'blended' : fbSource,
  };
}

/** Bootstrap pools for the capped simulation (own records, else the event pool). */
export function buildPools(model: AnalyticsModel): (team: string) => TeamPool {
  const eventPool = model.records.map(intentFromRecord);
  const cache = new Map<string, TeamPool>();
  return (team: string) => {
    let p = cache.get(team);
    if (!p) {
      const t = model.teams.get(team);
      const own = (t?.records ?? []).map(intentFromRecord);
      p = { team, intents: own.length ? own : eventPool, borrowed: !own.length, reliability: t?.reliability ?? RELIABILITY_PRIOR };
      cache.set(team, p);
    }
    return p;
  };
}
