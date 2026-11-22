/**
 * Match predictions: win probability (normal model) + bonus-RP odds (capped
 * Monte Carlo). P(red) = Φ((μ_red − μ_blue) / √(σ²_red + σ²_blue)).
 */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import type { MatchRow } from '@/data/types';
import { normalCdf } from '@/lib/stats';
import { mulberry32, seedFrom } from '@/lib/rng';
import type { AnalyticsModel } from './model';
import { simulateAlliance, type SimSummary } from './allianceSim';
import { buildPools, teamStrength, type Strength } from './strength';

export interface AllianceForecast {
  teams: string[];
  mu: number;
  sd: number;
  strengths: Strength[];
  sim: SimSummary;
}

export interface MatchForecast {
  pRed: number;
  red: AllianceForecast;
  blue: AllianceForecast;
  /** Teams in this match with < 2 scouted matches (prediction leans on priors). */
  lowData: string[];
  explanation: string;
}

export function allianceMuSd(teams: string[], opponents: string[], model: AnalyticsModel) {
  const strengths = teams.filter(Boolean).map((t) => teamStrength(model.teams.get(t), model));
  const opp = opponents.filter(Boolean).map((t) => teamStrength(model.teams.get(t), model));
  const mu = strengths.reduce((a, s) => a + s.mu, 0) + opp.reduce((a, s) => a + s.foulsGiven, 0);
  const variance = strengths.reduce((a, s) => a + s.variance, 0);
  return { mu, sd: Math.sqrt(variance), strengths };
}

export function winProbability(red: { mu: number; sd: number }, blue: { mu: number; sd: number }): number {
  const denom = Math.sqrt(red.sd ** 2 + blue.sd ** 2) || 1;
  return normalCdf((red.mu - blue.mu) / denom);
}

export function forecastMatch(m: Pick<MatchRow, 'key' | 'red' | 'blue'>, model: AnalyticsModel, runs: number = DEFAULT_SETTINGS.simRuns): MatchForecast {
  const pools = buildPools(model);
  const rng = mulberry32(seedFrom(`forecast:${m.key}:${m.red.join()}:${m.blue.join()}`));
  const r = allianceMuSd(m.red, m.blue, model);
  const b = allianceMuSd(m.blue, m.red, model);
  const red: AllianceForecast = { teams: m.red, ...r, sim: simulateAlliance(m.red.filter(Boolean).map(pools), runs, rng) };
  const blue: AllianceForecast = { teams: m.blue, ...b, sim: simulateAlliance(m.blue.filter(Boolean).map(pools), runs, rng) };
  const pRed = winProbability(red, blue);
  const lowData = [...m.red, ...m.blue].filter((t) => t && (model.teams.get(t)?.n ?? 0) < 2);
  return { pRed, red, blue, lowData, explanation: explain(pRed, red, blue, model) };
}

function explain(pRed: number, red: AllianceForecast, blue: AllianceForecast, model: AnalyticsModel): string {
  const fav = pRed >= 0.5 ? red : blue;
  const dog = pRed >= 0.5 ? blue : red;
  const favName = pRed >= 0.5 ? 'Red' : 'Blue';
  const p = Math.max(pRed, 1 - pRed);
  const top = [...fav.strengths].sort((a, b) => b.mu - a.mu)[0];
  const parts: string[] = [];
  if (p < 0.58) parts.push(`Toss-up (${Math.round(p * 100)}%)`);
  else parts.push(`${favName} favored ${Math.round(p * 100)}% (${fav.mu.toFixed(0)} vs ${dog.mu.toFixed(0)} pts)`);
  if (top) parts.push(`biggest contributor ${top.team} (~${top.mu.toFixed(0)})`);
  for (const [name, a] of [
    ['Red', red],
    ['Blue', blue],
  ] as const) {
    if (a.sim.cakeShort > 1) parts.push(`${name} is short on cakes (needs an oven feeder)`);
    if (a.sim.overflow > 1.5) parts.push(`${name} overfills shelves`);
  }
  const lowData = [...red.teams, ...blue.teams].filter((t) => t && (model.teams.get(t)?.n ?? 0) < 2);
  if (lowData.length) parts.push(`estimate — little data on ${lowData.join(', ')}`);
  return parts.join(' · ');
}
