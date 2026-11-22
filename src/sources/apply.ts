'use client';
/**
 * Writes official data into IndexedDB with the merge rules, and (on an admin's
 * device) forwards changes + raw snapshots to Supabase so every device — even
 * ones that can't reach 449's site — gets the same results.
 */
import { db, kvSet } from '@/data/db';
import { putRows, serverSyncActive } from '@/data/repo';
import type { MatchRow, OfficialAlliance, RankingRow, SourceKind } from '@/data/types';
import { authStore } from '@/sync/auth';
import { getSupabase } from '@/sync/supabase';
import { createStore } from '@/lib/store';
import { stableStringify } from '@/lib/util';
import { computeRankings } from '@/analytics/rankings';
import type { OfficialData } from './DataSource';
import { mergeMatch } from './normalize';

export interface OfficialState {
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  source: SourceKind | null;
  lastError: string | null;
  warnings: string[];
  polling: boolean;
}

export const officialStore = createStore<OfficialState>({
  lastSuccessAt: null,
  lastAttemptAt: null,
  source: null,
  lastError: null,
  warnings: [],
  polling: false,
});

export async function restoreOfficialState() {
  const saved = (await db.kv.get('official:state'))?.value as Partial<OfficialState> | undefined;
  if (saved) officialStore.set({ lastSuccessAt: saved.lastSuccessAt ?? null, source: saved.source ?? null });
}

export async function markOfficialSuccess(source: SourceKind, warnings: string[] = []) {
  const at = Date.now();
  officialStore.set({ lastSuccessAt: at, lastAttemptAt: at, source, lastError: null, warnings });
  await kvSet('official:state', { lastSuccessAt: at, source });
}

const canPushOfficial = () => serverSyncActive() && authStore.get().role === 'admin';

const strip = <T extends object>(r: T) => {
  const c = { ...(r as Record<string, unknown>) };
  delete c.updated_at;
  return stableStringify(c);
};

export interface ApplyResult {
  matchesChanged: number;
  rankingsChanged: boolean;
  alliancesChanged: boolean;
}

export async function applyOfficialData(d: OfficialData, opts: { push?: boolean } = {}): Promise<ApplyResult> {
  const push = opts.push ?? canPushOfficial();
  const changed: MatchRow[] = [];
  for (const incoming of [...d.quals, ...d.playoffs]) {
    const merged = mergeMatch(await db.matches.get(incoming.key), incoming);
    if (merged) changed.push(merged);
  }
  if (changed.length) await putRows('matches', changed, { sync: push });

  const rankingsChanged = d.rankings.length > 0 && (await replaceIfChanged('rankings', d.rankings, push));
  const alliancesChanged = await replaceIfChanged('official_alliances', d.alliances, push, true);

  for (const s of d.snapshots) {
    const last = await db.api_snapshots.where('endpoint').equals(s.endpoint).last();
    if (last?.hash === s.hash) continue;
    await db.api_snapshots.add(s);
    const keep = await db.api_snapshots.where('endpoint').equals(s.endpoint).primaryKeys();
    if (keep.length > 30) await db.api_snapshots.bulkDelete(keep.slice(0, keep.length - 30));
    if (push) {
      const sb = getSupabase();
      void sb?.from('api_snapshots').insert({ endpoint: s.endpoint, fetched_at: s.fetched_at, hash: s.hash, payload: s.payload });
    }
  }
  return { matchesChanged: changed.length, rankingsChanged, alliancesChanged };
}

async function replaceIfChanged(
  table: 'rankings' | 'official_alliances',
  rows: (RankingRow | OfficialAlliance)[],
  push: boolean,
  allowEmpty = false,
): Promise<boolean> {
  const existing = (await (table === 'rankings' ? db.rankings.toArray() : db.official_alliances.toArray())) as (RankingRow | OfficialAlliance)[];
  const key = (r: RankingRow | OfficialAlliance) => ('team_id' in r ? r.team_id : String(r.number));
  const a = existing.map(strip).sort().join('|');
  const b = rows.map(strip).sort().join('|');
  if (a === b) return false;
  if (!rows.length && !allowEmpty) return false;
  const incomingKeys = new Set(rows.map(key));
  const stale = existing.filter((r) => !incomingKeys.has(key(r)));
  if (stale.length) {
    if (table === 'rankings') await db.rankings.bulkDelete(stale.map((r) => (r as RankingRow).team_id));
    else await db.official_alliances.bulkDelete(stale.map((r) => (r as OfficialAlliance).number));
  }
  await putRows(table, rows, { sync: push });
  return true;
}

/** Manual mode: keep the rankings table in step with entered results. */
export async function refreshComputedRankings(source: SourceKind = 'manual') {
  const [matches, teams, current] = await Promise.all([db.matches.toArray(), db.teams.toArray(), db.rankings.toArray()]);
  if (current.some((r) => r.source === 'api')) return; // official rankings win
  const rows = computeRankings(
    matches,
    teams.filter((t) => t.status !== 'withdrawn').map((t) => t.id),
    source,
  ).filter((r) => r.matches_played > 0);
  await replaceIfChanged('rankings', rows, canPushOfficial(), true);
}
