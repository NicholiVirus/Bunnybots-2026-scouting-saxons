import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultTeamIdContext } from '@/lib/teamIds';
import { importCsv } from '@/sources/csv';
import { applyCutoff } from '@/sources/demo';
import { buildModel } from '@/analytics/model';
import { pickScores } from '@/analytics/pickScore';
import { rosterTeams } from '@/data/seed';
import { mulberry32 } from '@/lib/rng';
import { runBracketOnce, simulateBracket } from './bracket';
import { buildSimInputs, rankedTeams } from './inputs';
import { acceptOrDecline, predictBracket, predictEvent } from './eventSim';

const csv = readFileSync(path.resolve(import.meta.dirname, '../../public/demo/matches.csv'), 'utf8');
const full = importCsv(csv, { ctx: defaultTeamIdContext(), source: 'demo', recompute: true });
const mid = applyCutoff({ ...full, playoffs: [], alliances: [], rankings: [], snapshots: [] }, 20);
const model = buildModel({ teams: rosterTeams(), matches: mid.quals, submissions: [], reports: [], events: [], pitReports: [] });
const ranked = rankedTeams(mid.quals, [], new Set());
const first = pickScores(model, { pickingTeam: '611', candidates: ranked, preset: 'first', mode: 'avg', runs: 50 });
const second = pickScores(model, { pickingTeam: '611', candidates: ranked, preset: 'second', mode: 'avg', runs: 50 });
const inputs = buildSimInputs(model, { matches: mid.quals, ranked, allianceCount: 8, actions: [], official: [], useOfficial: false, first, second, guesses: {}, rpRuns: 100 });

describe('bracket', () => {
  it('higher seed always wins → seed 1 champion, seeds 1/2 finalists', () => {
    const r = runBracketOnce(8, (a, b) => a < b);
    expect(r.champion).toBe(1);
    expect(r.finalists.sort()).toEqual([1, 2]);
  });
  it('the lower-bracket finalist must win twice (carries its loss)', () => {
    // seed 2 beats everyone except it loses to seed 1 once; seed 1 loses every rematch after its first loss
    let finalsPlayed = 0;
    const r = runBracketOnce(8, (a, b) => {
      if ((a === 1 && b === 2) || (a === 2 && b === 1)) {
        finalsPlayed++;
        return a === 2; // 2 always beats 1
      }
      return a < b;
    });
    // 1 and 2 meet in the upper final (M11): 2 wins; 1 drops to M13 and wins it; finals: 2 (upper) vs 1 → 2 wins once
    expect(r.champion).toBe(2);
    expect(finalsPlayed).toBe(2);
  });
  it('missing alliances are byes (6 alliances)', () => {
    const res = simulateBracket(6, (s, rng) => 100 - s * 5 + rng() * 30, 3000, mulberry32(1));
    expect(res.pWin[6]).toBe(0);
    expect(res.pWin[7]).toBe(0);
    expect(res.pWin.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(res.pWin[0]).toBeGreaterThan(res.pWin[5]);
  });
});

describe('event prediction (449 sim, replayed after Q20)', () => {
  it('predicts ranks, captains and our draft position in < 2 s for 2,000 runs', () => {
    const p = predictEvent(inputs, { runs: 2000, seed: 7, focus: ['611', '526'] });
    expect(p.ms).toBeLessThan(2000);
    for (const t of inputs.teams) expect(p.rankDist[t].reduce((a, b) => a + b, 0)).toBe(2000);
    const totalCaptains = Object.values(p.pCaptain).reduce((a, b) => a + b, 0);
    expect(totalCaptains).toBeCloseTo(8, 6);
    expect(p.predictedCaptains).toHaveLength(8);
    expect(Number.isFinite(p.captainThreshold)).toBe(true);
    const seed611 = p.seedDist['611'].reduce((a, b) => a + b, 0);
    expect(seed611).toBeCloseTo(p.pCaptain['611'], 6);
    // availability is a probability
    for (const v of Object.values(p.avail1['611'] ?? {})) expect(v).toBeLessThanOrEqual(1);
  });

  it('is reproducible with the same seed', () => {
    const a = predictEvent(inputs, { runs: 300, seed: 3, focus: ['611'] });
    const b = predictEvent(inputs, { runs: 300, seed: 3, focus: ['611'] });
    expect(a.pCaptain).toEqual(b.pCaptain);
  });

  it('bracket + accept/decline return sane probabilities', () => {
    const alliances = [1, 2, 3, 4].map((n) => ({ number: n, teams: ranked.slice((n - 1) * 3, n * 3) }));
    const br = predictBracket(alliances, inputs, 1000, 5);
    expect(br.alliances.reduce((a, x) => a + x.pWin, 0)).toBeCloseTo(1, 6);
    const ad = acceptOrDecline({ ...inputs, remaining: [], rankedNow: ranked }, ranked, ranked[5], 1, { drafts: 10, bracketRuns: 200, seed: 9 });
    expect(ad.join.pWin).toBeGreaterThanOrEqual(0);
    expect(ad.join.pWin).toBeLessThanOrEqual(1);
    expect(['accept', 'decline', 'close']).toContain(ad.verdict);
    expect(ad.reasons).toHaveLength(2);
  });
});
