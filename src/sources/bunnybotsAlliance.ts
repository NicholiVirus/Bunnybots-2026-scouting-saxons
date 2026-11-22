/**
 * The Bunnybots Alliance API client (449's TBA-style site). No key; CORS is open
 * (Access-Control-Allow-Origin: *), so browsers call it directly.
 *
 *   /api/matches/qualification[?slots=true]   /api/matches/playoff
 *   /api/rankings   /api/alliances   /api/teams
 * Path-less fallback for hosts that only route "/": /?api=matches/qualification
 */
import type { TeamIdContext } from '@/lib/teamIds';
import { hashString, nowIso, stableStringify } from '@/lib/util';
import type { DataSource, OfficialData } from './DataSource';
import { allianceFromRaw, matchFromRaw, rankingFromRaw, type Raw } from './normalize';

const TIMEOUT_MS = 8000;

export function cleanBaseUrl(base: string): string {
  let b = base.trim();
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
  return b.replace(/\/+$/, '').replace(/\/api$/i, '');
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** GET one endpoint, trying the path form first, then the path-less form. */
export async function fetchEndpoint(base: string, endpoint: string, query: Record<string, string> = {}, fetchImpl: typeof fetch = fetch) {
  const b = cleanBaseUrl(base);
  const qs = new URLSearchParams(query).toString();
  const pathUrl = `${b}/api/${endpoint}${qs ? `?${qs}` : ''}`;
  try {
    return { data: await getJson(pathUrl, fetchImpl), url: pathUrl };
  } catch (e) {
    const fallback = `${b}/?${new URLSearchParams({ api: endpoint, ...query }).toString()}`;
    try {
      return { data: await getJson(fallback, fetchImpl), url: fallback };
    } catch {
      throw e;
    }
  }
}

const asArray = (d: unknown): Raw[] => (Array.isArray(d) ? (d as Raw[]) : d && typeof d === 'object' && Array.isArray((d as Raw).Rankings) ? ((d as Raw).Rankings as Raw[]) : []);

export class BunnybotsAllianceSource implements DataSource {
  id = 'bunnybots-alliance' as const;
  kind = 'api' as const;
  label = 'Bunnybots Alliance';
  constructor(
    private base: string,
    private ctx: TeamIdContext,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  async fetch(): Promise<OfficialData> {
    const fetched_at = nowIso();
    const [q, p, r, a] = await Promise.allSettled([
      fetchEndpoint(this.base, 'matches/qualification', { slots: 'true' }, this.fetchImpl),
      fetchEndpoint(this.base, 'matches/playoff', { slots: 'true' }, this.fetchImpl),
      fetchEndpoint(this.base, 'rankings', {}, this.fetchImpl),
      fetchEndpoint(this.base, 'alliances', {}, this.fetchImpl),
    ]);
    if (q.status === 'rejected') throw q.reason; // quals are required; the rest are best-effort
    const out: OfficialData = { quals: [], playoffs: [], rankings: [], alliances: [], snapshots: [], warnings: [] };
    const snap = (endpoint: string, data: unknown) => {
      out.snapshots.push({ endpoint, fetched_at, hash: hashString(stableStringify(data)), payload: data });
    };

    snap('matches/qualification', q.value.data);
    for (const raw of asArray(q.value.data)) {
      const m = matchFromRaw(raw, { compLevel: 'qm', source: 'api', ctx: this.ctx });
      if (m) out.quals.push(m);
    }
    if (p.status === 'fulfilled') {
      snap('matches/playoff', p.value.data);
      for (const raw of asArray(p.value.data)) {
        const m = matchFromRaw(raw, { compLevel: 'po', source: 'api', ctx: this.ctx });
        if (m) out.playoffs.push(m);
      }
    } else out.warnings.push(`Playoffs unavailable: ${(p.reason as Error)?.message ?? p.reason}`);
    if (r.status === 'fulfilled') {
      snap('rankings', r.value.data);
      for (const raw of asArray(r.value.data)) {
        const row = rankingFromRaw(raw, this.ctx, 'api');
        if (row) out.rankings.push(row);
      }
    } else out.warnings.push(`Rankings unavailable: ${(r.reason as Error)?.message ?? r.reason}`);
    if (a.status === 'fulfilled') {
      snap('alliances', a.value.data);
      asArray(a.value.data).forEach((raw, i) => {
        const al = allianceFromRaw(raw, this.ctx, 'api', i + 1);
        if (al) out.alliances.push(al);
      });
    }
    for (const m of [...out.quals, ...out.playoffs]) for (const w of m.warnings ?? []) out.warnings.push(`${m.label}: ${w}`);
    return out;
  }
}
