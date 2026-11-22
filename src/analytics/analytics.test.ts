import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalCdf, ridgeLeastSquares, weightedMedian, summarize } from '@/lib/stats';
import { mulberry32 } from '@/lib/rng';
import { defaultTeamIdContext } from '@/lib/teamIds';
import { importCsv } from '@/sources/csv';
import { emptyIntent, resolveAlliance, simulateAlliance, type RobotIntent } from './allianceSim';
import { winProbability } from './predict';
import { bradleyTerry } from './driverRank';
import { computeOpr } from './opr';
import { buildModel } from './model';
import { teamStrength } from './strength';
import { pickScores } from './pickScore';
import { rosterTeams } from '@/data/seed';

const intent = (p: Partial<RobotIntent> & { carrot?: Partial<RobotIntent['pantry']['carrot']>; cake?: Partial<RobotIntent['pantry']['cake']> }): RobotIntent => {
  const i = emptyIntent();
  Object.assign(i.pantry.carrot, p.carrot ?? {});
  Object.assign(i.pantry.cake, p.cake ?? {});
  if (p.oven) i.oven = p.oven;
  if (p.taxi !== undefined) i.taxi = p.taxi;
  if (p.park !== undefined) i.park = p.park;
  if (p.haul) i.haul = p.haul;
  return i;
};

describe('stats helpers', () => {
  it('normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });
  it('weighted median prefers heavily weighted values', () => {
    expect(weightedMedian([5, 10, 30], [1, 1, 1])).toBe(10);
    expect(weightedMedian([5, 10, 30], [0.35, 0.35, 1])).toBe(30);
  });
  it('least squares recovers exact contributions', () => {
    // teams a=10, b=20, c=30; alliances of 2
    const rows = [
      [1, 1, 0],
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ];
    const b = [30, 50, 40, 30];
    const x = ridgeLeastSquares(rows, b, 3, 1e-9);
    expect(x[0]).toBeCloseTo(10, 4);
    expect(x[1]).toBeCloseTo(20, 4);
    expect(x[2]).toBeCloseTo(30, 4);
  });
});

describe('capped alliance score (hand-computed)', () => {
  it('two L3-cake robots fight over 5 L3 slots; extras cascade down', () => {
    // 2 oven feeders give 1 + floor(21/3)=7 → 8 cakes available
    const a = intent({ cake: { L3: 4 } });
    const b = intent({ cake: { L3: 4 } });
    const feeder = intent({ oven: { carrot: 21, cake: 0 } });
    const r = resolveAlliance([a, b, feeder]);
    expect(r.cakesAvailable).toBe(8);
    expect(r.counted.cake).toEqual({ L3: 5, L2: 3, L1: 0 });
    expect(r.overflow).toBe(3);
    expect(r.pantry).toBe(5 * 12 + 3 * 10);
    expect(r.oven).toBe(21 * 2);
    expect(r.total).toBe(60 + 30 + 42);
  });

  it('no cake source: only the 1 prestaged cake exists; the rest become carrots', () => {
    const r = resolveAlliance([intent({ cake: { L3: 3 } }), intent({ cake: { L1: 2 } }), emptyIntent()]);
    expect(r.cakesAvailable).toBe(1);
    expect(r.cakeShort).toBe(4);
    // cheapest uses dropped first: both L1 cakes and 2 of the L3 cakes → carrots
    expect(r.counted.cake).toEqual({ L1: 0, L2: 0, L3: 1 });
    expect(r.counted.carrot).toEqual({ L1: 2, L2: 0, L3: 2 });
    expect(r.pantry).toBe(12 + 2 * 5 + 2 * 3);
    expect(r.rp.baked).toBe(false);
  });

  it('caps the traded cakes at 9 (+1 prestaged)', () => {
    const r = resolveAlliance([intent({ oven: { carrot: 60, cake: 0 } }), emptyIntent(), emptyIntent()]);
    expect(r.cakesAvailable).toBe(10);
  });

  it('endgame: parks + hauls; Dinner needs ≥ 10', () => {
    const p = (haul: RobotIntent['haul']) => intent({ park: true, haul });
    const r = resolveAlliance([p({ carrot: 0, cake: 1 }), p({ carrot: 1, cake: 0 }), p({ carrot: 0, cake: 0 })]);
    // cakes: 1 prestaged covers the one hauled cake
    expect(r.endgame).toBe(6 + 3 + 1);
    expect(r.rp.dinner).toBe(true);
    const notParked = resolveAlliance([intent({ park: false, haul: { carrot: 3, cake: 0 } }), emptyIntent(), emptyIntent()]);
    expect(notParked.haul).toBe(0);
  });

  it('Stocked and Baked use counted pieces', () => {
    const r = resolveAlliance([
      intent({ carrot: { L1: 2, L2: 2, L3: 2 }, cake: { L1: 1, L2: 1, L3: 1 } }),
      intent({ oven: { carrot: 6, cake: 0 } }),
      emptyIntent(),
    ]);
    expect(r.rp).toMatchObject({ stocked: true, baked: true });
  });

  it('Monte Carlo is reproducible with a seed', () => {
    const pools = [
      { team: 'a', intents: [intent({ carrot: { L1: 3 } }), intent({ carrot: { L2: 5 } })], borrowed: false, reliability: 1 },
      { team: 'b', intents: [intent({ cake: { L3: 2 } })], borrowed: false, reliability: 1 },
      { team: 'c', intents: [intent({ oven: { carrot: 9, cake: 0 } })], borrowed: false, reliability: 1 },
    ];
    const x = simulateAlliance(pools, 2000, mulberry32(42));
    const y = simulateAlliance(pools, 2000, mulberry32(42));
    expect(x.mean).toBe(y.mean);
    expect(x.rp.stocked).toBe(0);
    expect(x.mean).toBeGreaterThan(40);
  });
});

describe('win probability', () => {
  it('Φ((μr − μb)/√(σr² + σb²))', () => {
    expect(winProbability({ mu: 100, sd: 15 }, { mu: 100, sd: 15 })).toBeCloseTo(0.5, 6);
    const p = winProbability({ mu: 120, sd: 15 }, { mu: 100, sd: 20 });
    expect(p).toBeCloseTo(normalCdf(20 / 25), 6);
    expect(winProbability({ mu: 80, sd: 10 }, { mu: 100, sd: 10 })).toBeLessThan(0.1);
  });
});

describe('driver rankings (Bradley–Terry)', () => {
  it('orders a consistent ranking and keeps scores in 0–100', () => {
    const s = bradleyTerry([{ order: ['a', 'b', 'c'] }, { order: ['a', 'b'] }, { order: ['b', 'c'] }, { order: ['a', 'c'] }]);
    expect(s.get('a')!).toBeGreaterThan(s.get('b')!);
    expect(s.get('b')!).toBeGreaterThan(s.get('c')!);
    for (const v of s.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('model on 449 simulated data', () => {
  const csv = readFileSync(path.resolve(import.meta.dirname, '../../public/demo/matches.csv'), 'utf8');
  const quals = importCsv(csv, { ctx: defaultTeamIdContext(), source: 'demo', recompute: true }).quals;
  const model = buildModel({ teams: rosterTeams(), matches: quals, submissions: [], reports: [], events: [], pitReports: [] });

  it('computes OPR for all 24 teams that played', () => {
    const opr = computeOpr(quals);
    expect(opr.size).toBe(24);
    const sumOpr = [...opr.values()].reduce((a, b) => a + b, 0);
    const avgAlliance = quals.reduce((a, m) => a + m.red_score! + m.blue_score!, 0) / (quals.length * 2);
    expect(sumOpr / 8).toBeCloseTo(avgAlliance, -1); // 24 teams ÷ 3 per alliance
  });

  it('teams without scouting fall back to OPR (labelled), never NaN', () => {
    const s = teamStrength(model.teams.get('3504'), model);
    expect(s.source).toBe('opr');
    expect(Number.isFinite(s.mu)).toBe(true);
    const unknown = teamStrength(model.teams.get('2537b'), model); // expected team, no matches
    expect(unknown.source).toBe('prior');
  });

  it('pick scores rank and explain', () => {
    const rows = pickScores(model, { pickingTeam: '611', candidates: ['3504', '449', '9033', '526'], preset: 'first', mode: 'avg' });
    expect(rows).toHaveLength(4);
    expect(rows[0].score).toBeGreaterThanOrEqual(rows[3].score);
    for (const r of rows) expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('summaries carry sample sizes', () => {
    expect(summarize([1, 2, 3]).n).toBe(3);
  });
});
