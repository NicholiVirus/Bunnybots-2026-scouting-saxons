/**
 * Event-level Monte Carlo (runs in a Web Worker; pure + seeded):
 *  1. Rank & captain predictor — simulate the remaining quals (normal-model W/L +
 *     capped-sim bonus-RP odds), rank by the manual's rules, then run the draft.
 *  2. Availability — who is still there at OUR 1st/2nd pick (captains ahead pick
 *     by our pick score + noise, or the strategist's per-captain guess) + VONA.
 *  3. Bracket — P(win event) per alliance with capped-sim score samples.
 *  4. Accept / decline — join alliance X vs decline and captain at seed Y.
 * Inputs are compact & serializable so the UI thread never freezes.
 */
import { HARVEST_HAVOC as G } from '@/game/harvestHavoc.config';
import { gumbel, mulberry32, normal, type Rng } from '@/lib/rng';
import { resolveAlliance, emptyIntent, type RobotIntent } from '@/analytics/allianceSim';
import { deriveDraft, stepDraft, type DraftState, type DraftStep } from './draft';
import { simulateBracket, headToHead } from './bracket';

export interface TeamRec {
  played: number;
  wins: number;
  losses: number;
  ties: number;
  rp: number;
  cumScore: number;
}

export interface RemainingMatch {
  key: string;
  red: string[];
  blue: string[];
  /** P(red wins), and bonus-RP odds per alliance (precomputed on the main thread) */
  pRed: number;
  rpRed: [number, number, number];
  rpBlue: [number, number, number];
  muRed: number;
  muBlue: number;
}

export interface SimInputs {
  teams: string[];
  records: Record<string, TeamRec>;
  remaining: RemainingMatch[];
  allianceCount: number;
  /** generic pick preference (0–100) used by simulated captains, per round */
  pickValue1: Record<string, number>;
  pickValue2: Record<string, number>;
  /** strategist guesses: captain → team they will pick */
  guesses: Record<string, string>;
  /** bootstrap intents per team (capped sim for bracket / accept-decline) */
  pools: Record<string, RobotIntent[]>;
  eventPool: RobotIntent[];
  /** current draft (if selection has started) */
  draftSteps: DraftStep[];
  official: { number: number; captain: string | null; first_pick: string | null; second_pick: string | null }[] | null;
  /** final ranking is known (no quals left, or official rankings final) */
  rankedNow: string[];
  noise: number;
}

export interface EventPrediction {
  runs: number;
  rankDist: Record<string, number[]>;
  rankMean: Record<string, number>;
  rankRange: Record<string, [number, number]>;
  pCaptain: Record<string, number>;
  pTopSeed: Record<string, number>;
  /** focus team → P(captain of alliance k), index k−1 */
  seedDist: Record<string, number[]>;
  predictedCaptains: string[];
  expectedRanking: string[];
  /** avg RP needed at the end to be in the captain zone (median Nth-place avg RP) */
  captainThreshold: number;
  avail1: Record<string, Record<string, number>>;
  avail2: Record<string, Record<string, number>>;
  /** expected best pick value still on the board at our NEXT pick */
  nextBest: Record<string, number>;
  ms: number;
}

function rankTeams(teams: string[], rec: Record<string, TeamRec>, rng: Rng): string[] {
  const tieKey = new Map(teams.map((t) => [t, rng()]));
  const avg = (t: string) => (rec[t]?.played ? rec[t].rp / rec[t].played : 0);
  const wl = (t: string) => (rec[t]?.played ? (rec[t].wins - rec[t].losses) / rec[t].played : 0);
  return [...teams].sort(
    (a, b) => avg(b) - avg(a) || wl(b) - wl(a) || (rec[b]?.cumScore ?? 0) - (rec[a]?.cumScore ?? 0) || tieKey.get(a)! - tieKey.get(b)!,
  );
}

function cloneRecs(r: Record<string, TeamRec>): Record<string, TeamRec> {
  const out: Record<string, TeamRec> = {};
  for (const [k, v] of Object.entries(r)) out[k] = { ...v };
  return out;
}

/** Play the remaining qualification matches once. */
export function simulateQuals(inp: SimInputs, rng: Rng): Record<string, TeamRec> {
  const rec = cloneRecs(inp.records);
  const get = (t: string) => (rec[t] ??= { played: 0, wins: 0, losses: 0, ties: 0, rp: 0, cumScore: 0 });
  const RP = G.rankingPoints;
  for (const m of inp.remaining) {
    const tie = Math.abs(m.pRed - 0.5) < 0.02 && rng() < 0.03;
    const redWins = !tie && rng() < m.pRed;
    const sr = Math.max(0, normal(rng, m.muRed, 15));
    const sb = Math.max(0, normal(rng, m.muBlue, 15));
    for (const side of ['red', 'blue'] as const) {
      const won = tie ? null : side === 'red' ? redWins : !redWins;
      const odds = side === 'red' ? m.rpRed : m.rpBlue;
      const bonus = (rng() < odds[0] ? RP.stockedUp.value : 0) + (rng() < odds[1] ? RP.bakedUp.value : 0) + (rng() < odds[2] ? RP.dinner.value : 0);
      const base = won === null ? RP.tie : won ? RP.win : RP.loss;
      for (const t of m[side]) {
        if (!t) continue;
        const r = get(t);
        r.played++;
        r.rp += base + bonus;
        r.cumScore += side === 'red' ? sr : sb;
        if (won === null) r.ties++;
        else if (won) r.wins++;
        else r.losses++;
      }
    }
  }
  return rec;
}

/** Complete a draft from `state`: each captain takes its best available by value + noise. */
export function completeDraft(
  state: DraftState,
  inp: Pick<SimInputs, 'pickValue1' | 'pickValue2' | 'guesses' | 'noise'>,
  rng: Rng,
  onTurn?: (s: DraftState) => void,
  choose?: (s: DraftState) => string | null,
): DraftState {
  let s = state;
  for (let guard = 0; guard < 32 && s.turn; guard++) {
    onTurn?.(s);
    const turn = s.turn;
    const cap = s.alliances[turn.alliance - 1].captain;
    let pick: string | null = choose ? choose(s) : null;
    if (!pick && turn.round === 1 && cap && inp.guesses[cap] && s.available.includes(inp.guesses[cap])) pick = inp.guesses[cap];
    if (!pick) {
      const values = turn.round === 1 ? inp.pickValue1 : inp.pickValue2;
      let best = -Infinity;
      for (const t of s.available) {
        const v = (values[t] ?? 0) + inp.noise * gumbel(rng);
        if (v > best) {
          best = v;
          pick = t;
        }
      }
    }
    if (!pick) break;
    s = stepDraft(s, { action: 'pick', alliance: turn.alliance, team_id: pick });
  }
  return s;
}

export function predictEvent(inp: SimInputs, opts: { runs: number; seed: number; focus: string[] }): EventPrediction {
  const t0 = Date.now();
  const rng = mulberry32(opts.seed);
  const n = inp.teams.length;
  const N = inp.allianceCount;
  const rankDist: Record<string, number[]> = Object.fromEntries(inp.teams.map((t) => [t, new Array(n).fill(0)]));
  const captainCount: Record<string, number> = Object.fromEntries(inp.teams.map((t) => [t, 0]));
  const captainSeed: Record<string, number[]> = Object.fromEntries(inp.teams.map((t) => [t, new Array(N).fill(0)]));
  const seedDist: Record<string, number[]> = Object.fromEntries(opts.focus.map((t) => [t, new Array(N).fill(0)]));
  const avail1: Record<string, Record<string, number>> = Object.fromEntries(opts.focus.map((t) => [t, {}]));
  const avail2: Record<string, Record<string, number>> = Object.fromEntries(opts.focus.map((t) => [t, {}]));
  const turnsSeen1: Record<string, number> = Object.fromEntries(opts.focus.map((t) => [t, 0]));
  const turnsSeen2: Record<string, number> = Object.fromEntries(opts.focus.map((t) => [t, 0]));
  const nextBestSum: Record<string, number> = Object.fromEntries(opts.focus.map((t) => [t, 0]));
  const thresholds: number[] = [];
  const selectionStarted = inp.draftSteps.some((s) => s.action === 'pick' || s.action === 'decline') || !!inp.official?.length;

  for (let run = 0; run < opts.runs; run++) {
    let ranked: string[];
    if (selectionStarted || !inp.remaining.length) ranked = inp.rankedNow.length ? inp.rankedNow : rankTeams(inp.teams, inp.records, rng);
    else {
      const rec = simulateQuals(inp, rng);
      ranked = rankTeams(inp.teams, rec, rng);
      const nth = ranked[Math.min(N, ranked.length) - 1];
      if (nth && rec[nth]?.played) thresholds.push(rec[nth].rp / rec[nth].played);
    }
    ranked.forEach((t, i) => rankDist[t] && rankDist[t][i]++);
    const start = deriveDraft(ranked, N, selectionStarted ? inp.draftSteps : [], selectionStarted ? (inp.official as never) : null);
    const final = completeDraft(start, inp, rng, (s) => {
      for (const f of opts.focus) {
        const a = s.alliances[s.turn!.alliance - 1];
        if (a.captain !== f && a.picks[0] !== f) continue;
        const bucket = s.turn!.round === 1 ? avail1[f] : avail2[f];
        if (s.turn!.round === 1) turnsSeen1[f]++;
        else turnsSeen2[f]++;
        for (const t of s.available) bucket[t] = (bucket[t] ?? 0) + 1;
        // value of the best team still on the board when our 2nd pick arrives (for VONA)
        if (s.turn!.round === 2) nextBestSum[f] += Math.max(0, ...s.available.map((t) => inp.pickValue2[t] ?? 0));
      }
    });
    for (const a of final.alliances) {
      if (a.captain) captainCount[a.captain] = (captainCount[a.captain] ?? 0) + 1;
      if (a.captain && captainSeed[a.captain]) captainSeed[a.captain][a.number - 1]++;
      if (a.captain && seedDist[a.captain]) seedDist[a.captain][a.number - 1]++;
    }
  }

  const runs = opts.runs;
  const rankMean: Record<string, number> = {};
  const rankRange: Record<string, [number, number]> = {};
  for (const t of inp.teams) {
    const d = rankDist[t];
    let s = 0;
    let lo = -1;
    let hi = -1;
    let cum = 0;
    d.forEach((c, i) => {
      s += c * (i + 1);
      cum += c;
      if (lo < 0 && cum >= runs * 0.1) lo = i + 1;
      if (hi < 0 && cum >= runs * 0.9) hi = i + 1;
    });
    rankMean[t] = s / runs;
    rankRange[t] = [lo, hi];
  }
  const expectedRanking = [...inp.teams].sort((a, b) => rankMean[a] - rankMean[b]);
  const pCaptain = Object.fromEntries(inp.teams.map((t) => [t, captainCount[t] / runs]));
  const pTopSeed = Object.fromEntries(inp.teams.map((t) => [t, rankDist[t].slice(0, N).reduce((a, b) => a + b, 0) / runs]));
  const norm = (rec: Record<string, Record<string, number>>, seen: Record<string, number>) =>
    Object.fromEntries(Object.entries(rec).map(([f, m]) => [f, Object.fromEntries(Object.entries(m).map(([t, c]) => [t, seen[f] ? c / seen[f] : 0]))]));
  thresholds.sort((a, b) => a - b);
  return {
    runs,
    rankDist,
    rankMean,
    rankRange,
    pCaptain,
    pTopSeed,
    seedDist: Object.fromEntries(Object.entries(seedDist).map(([t, d]) => [t, d.map((c) => c / runs)])),
    // most likely captain for each seed, in seed order
    predictedCaptains: (() => {
      const used = new Set<string>();
      const out: string[] = [];
      for (let k = 0; k < N; k++) {
        const best = inp.teams.filter((t) => !used.has(t)).sort((a, b) => captainSeed[b][k] - captainSeed[a][k])[0];
        if (!best || captainSeed[best][k] === 0) break;
        used.add(best);
        out.push(best);
      }
      return out;
    })(),
    expectedRanking,
    captainThreshold: thresholds.length ? thresholds[Math.floor(thresholds.length / 2)] : NaN,
    avail1: norm(avail1, turnsSeen1),
    avail2: norm(avail2, turnsSeen2),
    nextBest: Object.fromEntries(opts.focus.map((f) => [f, turnsSeen2[f] ? nextBestSum[f] / turnsSeen2[f] : 0])),
    ms: Date.now() - t0,
  };
}

// ── Bracket / accept-decline ────────────────────────────────────────────────

function allianceSampler(teams: string[], inp: Pick<SimInputs, 'pools' | 'eventPool'>, rng: Rng, n = 800): Float64Array {
  const pools = teams.map((t) => (inp.pools[t]?.length ? inp.pools[t] : inp.eventPool));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const robots = pools.map((p) => (p.length ? p[Math.floor(rng() * p.length)] : emptyIntent()));
    out[i] = resolveAlliance(robots).total;
  }
  return out;
}

export interface BracketPrediction {
  alliances: { number: number; teams: string[]; mean: number; pWin: number; pFinals: number }[];
  h2h: number[][];
  runs: number;
}

export function predictBracket(alliances: { number: number; teams: string[] }[], inp: Pick<SimInputs, 'pools' | 'eventPool'>, runs: number, seed: number): BracketPrediction {
  const rng = mulberry32(seed);
  const samples = alliances.map((a) => allianceSampler(a.teams, inp, rng));
  const bySeed = new Map(alliances.map((a, i) => [a.number, samples[i]]));
  const res = simulateBracket(
    Math.max(...alliances.map((a) => a.number), 0),
    (s, r) => {
      const arr = bySeed.get(s);
      return arr && arr.length ? arr[Math.floor(r() * arr.length)] : 0;
    },
    runs,
    rng,
  );
  const h2h = samples.map((a) => samples.map((b) => headToHead(a, b, rng, 600)));
  return {
    alliances: alliances.map((a, i) => ({
      number: a.number,
      teams: a.teams,
      mean: samples[i].reduce((x, y) => x + y, 0) / Math.max(1, samples[i].length),
      pWin: res.pWin[a.number - 1] ?? 0,
      pFinals: res.pFinals[a.number - 1] ?? 0,
    })),
    h2h,
    runs,
  };
}

export interface AcceptDeclineResult {
  join: { pWin: number; pFinals: number; alliance: number; teams: string[] };
  decline: { pWin: number; pFinals: number; alliance: number | null; teams: string[] | null; captainOdds: number };
  verdict: 'accept' | 'decline' | 'close';
  reasons: string[];
}

export function acceptOrDecline(inp: SimInputs, ranked: string[], our: string, inviting: number, opts: { drafts: number; bracketRuns: number; seed: number }): AcceptDeclineResult {
  const rng = mulberry32(opts.seed);
  const start = deriveDraft(ranked, inp.allianceCount, inp.draftSteps, inp.official as never);
  let joinWin = 0;
  let joinFin = 0;
  let decWin = 0;
  let decFin = 0;
  let decCaptain = 0;
  let joinTeams: string[] = [];
  let decTeams: string[] | null = null;
  let decAlliance: number | null = null;
  for (let d = 0; d < opts.drafts; d++) {
    // A) accept
    const a = completeDraft(stepDraft(start, { action: 'pick', alliance: inviting, team_id: our }), inp, rng);
    const formedA = a.alliances.filter((x) => x.captain).map((x) => ({ number: x.number, teams: [x.captain!, ...x.picks.filter(Boolean)] as string[] }));
    const bA = predictBracket(formedA, inp, opts.bracketRuns, Math.floor(rng() * 1e9));
    const mine = bA.alliances.find((x) => x.number === inviting);
    joinWin += mine?.pWin ?? 0;
    joinFin += mine?.pFinals ?? 0;
    if (!joinTeams.length && mine) joinTeams = mine.teams;
    // B) decline
    const b = completeDraft(stepDraft(start, { action: 'decline', alliance: inviting, team_id: our }), inp, rng);
    const ourAlliance = b.alliances.find((x) => x.captain === our);
    if (ourAlliance) {
      decCaptain++;
      const formedB = b.alliances.filter((x) => x.captain).map((x) => ({ number: x.number, teams: [x.captain!, ...x.picks.filter(Boolean)] as string[] }));
      const bB = predictBracket(formedB, inp, opts.bracketRuns, Math.floor(rng() * 1e9));
      const m2 = bB.alliances.find((x) => x.number === ourAlliance.number);
      decWin += m2?.pWin ?? 0;
      decFin += m2?.pFinals ?? 0;
      if (!decTeams && m2) {
        decTeams = m2.teams;
        decAlliance = ourAlliance.number;
      }
    }
  }
  const D = opts.drafts;
  const join = { pWin: joinWin / D, pFinals: joinFin / D, alliance: inviting, teams: joinTeams };
  const decline = { pWin: decWin / D, pFinals: decFin / D, alliance: decAlliance, teams: decTeams, captainOdds: decCaptain / D };
  const diff = join.pWin - decline.pWin;
  const verdict: AcceptDeclineResult['verdict'] = Math.abs(diff) < 0.03 ? 'close' : diff > 0 ? 'accept' : 'decline';
  const pctS = (x: number) => `${Math.round(x * 100)}%`;
  const reasons = [
    `Join Alliance ${inviting}: P(win event) ${pctS(join.pWin)}, P(finals) ${pctS(join.pFinals)}`,
    decline.captainOdds > 0
      ? `Decline → captain of Alliance ${decAlliance ?? '?'} in ${pctS(decline.captainOdds)} of drafts: P(win) ${pctS(decline.pWin)}, P(finals) ${pctS(decline.pFinals)}`
      : `Decline → we would NOT be reached as a captain (and can't be picked again): P(win) 0%`,
  ];
  return { join, decline, verdict, reasons };
}
