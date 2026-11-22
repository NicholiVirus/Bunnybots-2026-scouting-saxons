/** Basic statistics (pure, unit-tested). */

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  median: number;
}

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : NaN);

export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1);
}
export const stdev = (xs: readonly number[]) => Math.sqrt(variance(xs));

export function quantile(xs: readonly number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (xs: readonly number[]) => quantile(xs, 0.5);

export function summarize(xs: readonly number[]): Summary {
  if (!xs.length) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN, median: NaN };
  return { n: xs.length, mean: mean(xs), sd: stdev(xs), min: Math.min(...xs), max: Math.max(...xs), median: median(xs) };
}

/** Weighted median: the value where cumulative weight first reaches half. */
export function weightedMedian(values: readonly number[], weights: readonly number[]): number {
  if (!values.length) return NaN;
  const pairs = values.map((v, i) => [v, Math.max(0, weights[i] ?? 0)] as const).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((a, p) => a + p[1], 0);
  if (total <= 0) return median(values);
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return pairs[pairs.length - 1][0];
}

export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  let s = 0;
  let w = 0;
  values.forEach((v, i) => {
    s += v * (weights[i] ?? 0);
    w += weights[i] ?? 0;
  });
  return w > 0 ? s / w : NaN;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Least-squares slope of ys against 0..n-1 (trend per match). */
export function slope(ys: readonly number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(ys);
  let num = 0;
  let den = 0;
  ys.forEach((y, i) => {
    num += (i - xm) * (y - ym);
    den += (i - xm) ** 2;
  });
  return den ? num / den : 0;
}

/**
 * Solve (AᵀA + λI) x = Aᵀb for small dense systems (OPR). Gaussian elimination
 * with partial pivoting; λ (ridge) keeps it stable when teams have few matches.
 */
export function ridgeLeastSquares(rows: number[][], b: number[], cols: number, lambda = 0.05): number[] {
  const M = Array.from({ length: cols }, () => new Array(cols + 1).fill(0));
  rows.forEach((r, k) => {
    for (let i = 0; i < cols; i++) {
      if (!r[i]) continue;
      for (let j = 0; j < cols; j++) if (r[j]) M[i][j] += r[i] * r[j];
      M[i][cols] += r[i] * b[k];
    }
  });
  for (let i = 0; i < cols; i++) M[i][i] += lambda;
  for (let c = 0; c < cols; c++) {
    let p = c;
    for (let r = c + 1; r < cols; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    if (Math.abs(piv) < 1e-12) continue;
    for (let j = c; j <= cols; j++) M[c][j] /= piv;
    for (let r = 0; r < cols; r++) {
      if (r === c || !M[r][c]) continue;
      const f = M[r][c];
      for (let j = c; j <= cols; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row[cols]);
}
