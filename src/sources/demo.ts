'use client';
/**
 * Demo sandbox: 449's simulated event (bundled in public/demo/, cached offline),
 * rescored with OUR config (their sim scored oven cakes at 2; the manual says 1),
 * plus synthetic scouting + pit data so every screen can be exercised before
 * Dec 12. "Show results through Q#" replays the event mid-day so predictors,
 * availability and the draft board have something to chew on.
 */
import { db, isDemoDb, kvGet, kvSet } from '@/data/db';
import { loadTeamIdContext } from '@/data/hooks';
import type { MatchRow } from '@/data/types';
import { computeRankings } from '@/analytics/rankings';
import { importCsv } from './csv';
import type { DataSource, OfficialData } from './DataSource';
import { emptyOfficialData } from './DataSource';
import { applyOfficialData, markOfficialSuccess } from './apply';

async function text(path: string) {
  const r = await fetch(path, { cache: 'force-cache' });
  if (!r.ok) throw new Error(`Missing ${path}`);
  return r.text();
}

export class DemoSource implements DataSource {
  id = 'demo' as const;
  kind = 'demo' as const;
  label = 'Demo (449 simulation)';

  async fetch(): Promise<OfficialData> {
    const ctx = await loadTeamIdContext();
    const [m, p, a, r] = await Promise.all([
      text('/demo/matches.csv'),
      text('/demo/playoffs.csv'),
      text('/demo/alliances.csv'),
      text('/demo/rankings.csv'),
    ]);
    const quals = importCsv(m, { ctx, source: 'demo', compLevel: 'qm', recompute: true });
    const playoffs = importCsv(p, { ctx, source: 'demo', compLevel: 'po', recompute: true });
    const alliances = importCsv(a, { ctx, source: 'demo' });
    // Rankings are recomputed from the RESCORED matches (449's rankings.csv used
    // their oven-cake = 2 scores, so a few W/L results flip under the real rules).
    void r;
    const rankings = computeRankings(quals.quals, [], 'demo').filter((x) => x.matches_played > 0);
    return {
      ...emptyOfficialData(),
      quals: quals.quals,
      playoffs: playoffs.playoffs,
      alliances: alliances.alliances,
      rankings,
      warnings: [...quals.warnings, ...playoffs.warnings],
    };
  }
}

/** Hide results after qual N (N = Infinity → the full event incl. playoffs). */
export function applyCutoff(d: OfficialData, cutoff: number): OfficialData {
  if (!Number.isFinite(cutoff)) return d;
  const unplay = (m: MatchRow): MatchRow =>
    m.match_number <= cutoff ? m : { ...m, played: false, red_score: null, blue_score: null, breakdown: null, rp: null, winner: null, warnings: [] };
  const quals = d.quals.map(unplay);
  return {
    ...d,
    quals,
    playoffs: [],
    alliances: [],
    rankings: computeRankings(quals, [], 'demo').filter((r) => r.matches_played > 0),
  };
}

export async function getDemoCutoff(): Promise<number> {
  const v = await kvGet<number | null>('demo:cutoff');
  return v === null || v === undefined ? Infinity : v;
}

/** Load (or reload) demo data into the demo database. */
export async function loadDemo(cutoff?: number) {
  if (!isDemoDb()) throw new Error('Demo data only loads inside the demo sandbox');
  const c = cutoff ?? (await getDemoCutoff());
  await kvSet('demo:cutoff', Number.isFinite(c) ? c : null);
  const full = await new DemoSource().fetch();
  const d = applyCutoff(full, c);
  // replace official tables wholesale (the cutoff can move backwards)
  await db.transaction('rw', db.matches, db.rankings, db.official_alliances, async () => {
    await db.matches.clear();
    await db.rankings.clear();
    await db.official_alliances.clear();
  });
  await applyOfficialData(d, { push: false });
  const { generateDemoScouting } = await import('./demoScouting');
  await generateDemoScouting(full, c);
  await markOfficialSuccess('demo', d.warnings);
  await kvSet('demo:loaded', true);
  return { warnings: d.warnings.length, quals: d.quals.length, playoffs: d.playoffs.length };
}

export async function ensureDemoLoaded() {
  if (!isDemoDb()) return;
  if (await kvGet('demo:loaded')) return;
  await loadDemo(Infinity);
}
