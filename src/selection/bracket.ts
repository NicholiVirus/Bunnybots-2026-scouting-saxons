/**
 * Double-elimination playoff bracket (up to 8 alliances; missing alliances = byes).
 * Pairings follow the standard FRC 8-alliance bracket (449's sim uses the same):
 *   M1 1v8 · M2 4v5 · M3 2v7 · M4 3v6           (upper R1)
 *   M5 L1vL2 · M6 L3vL4                         (lower R1)
 *   M7 W1vW2 · M8 W3vW4                         (upper R2)
 *   M9 L8vW5 · M10 L7vW6                        (lower R2)
 *   M11 W7vW8 (upper final) · M12 W10vW9        (lower R3)
 *   M13 L11vW12                                 (lower final)
 *   Finals: W11 vs W13 — part of the double-elim bracket, so the lower-bracket
 *   alliance carries its loss: one win crowns W11; W13 must win twice.
 */
import type { Rng } from '@/lib/rng';

type Ref = { seed: number } | { winner: number } | { loser: number };

const BRACKET: [Ref, Ref][] = [
  [{ seed: 1 }, { seed: 8 }],
  [{ seed: 4 }, { seed: 5 }],
  [{ seed: 2 }, { seed: 7 }],
  [{ seed: 3 }, { seed: 6 }],
  [{ loser: 1 }, { loser: 2 }],
  [{ loser: 3 }, { loser: 4 }],
  [{ winner: 1 }, { winner: 2 }],
  [{ winner: 3 }, { winner: 4 }],
  [{ loser: 8 }, { winner: 5 }],
  [{ loser: 7 }, { winner: 6 }],
  [{ winner: 7 }, { winner: 8 }],
  [{ winner: 10 }, { winner: 9 }],
  [{ loser: 11 }, { winner: 12 }],
];

export interface BracketResult {
  /** index = alliance seed − 1 */
  pWin: number[];
  pFinals: number[];
  runs: number;
}

/**
 * @param seeds number of alliances (≤ 8); seeds beyond it are byes
 * @param play returns true if `a` beats `b` (both seed numbers)
 */
export function runBracketOnce(seeds: number, play: (a: number, b: number) => boolean): { champion: number | null; finalists: number[] } {
  const W: (number | null)[] = [];
  const L: (number | null)[] = [];
  const resolve = (r: Ref): number | null => ('seed' in r ? (r.seed <= seeds ? r.seed : null) : 'winner' in r ? W[r.winner - 1] : L[r.loser - 1]);
  BRACKET.forEach(([ra, rb], i) => {
    const a = resolve(ra);
    const b = resolve(rb);
    if (a === null || b === null) {
      W[i] = a ?? b; // bye: automatic win
      L[i] = null;
      return;
    }
    const aWins = play(a, b);
    W[i] = aWins ? a : b;
    L[i] = aWins ? b : a;
  });
  const upper = W[10];
  const lower = W[12];
  if (upper === null || lower === null) return { champion: upper ?? lower ?? null, finalists: [upper, lower].filter((x): x is number => x !== null) };
  // lower-bracket alliance carries its loss
  if (play(upper, lower)) return { champion: upper, finalists: [upper, lower] };
  return { champion: play(upper, lower) ? upper : lower, finalists: [upper, lower] };
}

export function simulateBracket(seeds: number, sample: (seed: number, rng: Rng) => number, runs: number, rng: Rng): BracketResult {
  const win = new Array(8).fill(0);
  const fin = new Array(8).fill(0);
  const play = (a: number, b: number) => {
    const sa = sample(a, rng);
    const sb = sample(b, rng);
    return sa === sb ? rng() < 0.5 : sa > sb;
  };
  for (let i = 0; i < runs; i++) {
    const r = runBracketOnce(seeds, play);
    if (r.champion) win[r.champion - 1]++;
    for (const f of r.finalists) fin[f - 1]++;
  }
  return { pWin: win.map((x) => x / runs), pFinals: fin.map((x) => x / runs), runs };
}

/** P(a beats b) from score samples. */
export function headToHead(sa: Float64Array, sb: Float64Array, rng: Rng, n = 2000): number {
  if (!sa.length || !sb.length) return 0.5;
  let w = 0;
  for (let i = 0; i < n; i++) {
    const x = sa[Math.floor(rng() * sa.length)];
    const y = sb[Math.floor(rng() * sb.length)];
    w += x > y ? 1 : x === y ? 0.5 : 0;
  }
  return w / n;
}
