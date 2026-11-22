/**
 * CSV import with column mapping. The Bunnybots Alliance `?format=csv` output
 * and 449's simulated CSVs import with ZERO mapping; anything else gets an
 * auto-suggested mapping the admin can adjust.
 */
import Papa from 'papaparse';
import type { CompLevel, SourceKind } from '@/data/types';
import type { TeamIdContext } from '@/lib/teamIds';
import { emptyOfficialData, type OfficialData } from './DataSource';
import { allianceFromRaw, matchFromRaw, rankingFromRaw, type Raw } from './normalize';

export type CsvKind = 'matches' | 'rankings' | 'alliances' | 'unknown';

export function parseCsv(text: string): { headers: string[]; rows: Raw[] } {
  const res = Papa.parse<Raw>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const headers = (res.meta.fields ?? []).filter((h) => h !== '');
  // drop R's unnamed row-index column ("")
  const rows = res.data.map((r) => {
    const c = { ...r };
    delete (c as Raw)[''];
    return c;
  });
  return { headers, rows };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Target fields for match/schedule imports, with header synonyms. */
export const MATCH_FIELDS: { field: string; label: string; synonyms: string[]; required?: boolean }[] = [
  { field: 'match_number', label: 'Match number', synonyms: ['match_number', 'match', 'matchnumber', 'number', 'matchno', 'qual', 'm', '#'], required: true },
  { field: 'match_label', label: 'Label (Q12 / M4)', synonyms: ['match_label', 'label', 'name', 'matchname'] },
  { field: 'red1', label: 'Red 1', synonyms: ['red1', 'r1', 'red_1', 'redteam1', 'red 1'], required: true },
  { field: 'red2', label: 'Red 2', synonyms: ['red2', 'r2', 'red_2', 'redteam2'], required: true },
  { field: 'red3', label: 'Red 3', synonyms: ['red3', 'r3', 'red_3', 'redteam3'], required: true },
  { field: 'blue1', label: 'Blue 1', synonyms: ['blue1', 'b1', 'blue_1', 'blueteam1'], required: true },
  { field: 'blue2', label: 'Blue 2', synonyms: ['blue2', 'b2', 'blue_2', 'blueteam2'], required: true },
  { field: 'blue3', label: 'Blue 3', synonyms: ['blue3', 'b3', 'blue_3', 'blueteam3'], required: true },
  { field: 'red_score', label: 'Red score', synonyms: ['red_score', 'redscore', 'red', 'redpoints'] },
  { field: 'blue_score', label: 'Blue score', synonyms: ['blue_score', 'bluescore', 'blue', 'bluepoints'] },
  { field: 'time', label: 'Scheduled time', synonyms: ['time', 'scheduled_time', 'start', 'starttime'] },
];

export function detectKind(headers: string[]): CsvKind {
  const h = new Set(headers.map(norm));
  if ((h.has('red1') || h.has('r1')) && (h.has('blue1') || h.has('b1'))) return 'matches';
  if (h.has('rank') && (h.has('teamkey') || h.has('team') || h.has('teamid'))) return 'rankings';
  if (h.has('captain') && (h.has('firstpick') || h.has('alliance'))) return 'alliances';
  return 'unknown';
}

/** Suggest header → field mapping. Exact BA/449 headers map to themselves. */
export function autoMap(headers: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of MATCH_FIELDS) {
    const syn = f.synonyms.map(norm);
    out[f.field] = headers.find((h) => norm(h) === norm(f.field)) ?? headers.find((h) => syn.includes(norm(h))) ?? null;
  }
  return out;
}

export function isPlayoffLabel(label: unknown): boolean {
  return /^(m|f|sf|qf|e|p)\d+/i.test(String(label ?? '').trim()) || /final/i.test(String(label ?? ''));
}

export interface CsvImportOptions {
  ctx: TeamIdContext;
  source?: SourceKind;
  /** Force comp level; otherwise inferred from labels (M#/F# → playoffs). */
  compLevel?: CompLevel;
  /** Column mapping for non-standard files (field → header). */
  mapping?: Record<string, string | null>;
  /** Recompute scores from our config (for 449's simulated data). */
  recompute?: boolean;
}

export function importCsv(text: string, o: CsvImportOptions): OfficialData & { kind: CsvKind; rowsRead: number } {
  const { headers, rows } = parseCsv(text);
  const kind = detectKind(o.mapping ? ['red1', 'blue1'] : headers);
  const out = { ...emptyOfficialData(), kind, rowsRead: rows.length };
  const source = o.source ?? 'csv';

  if (kind === 'rankings') {
    for (const r of rows) {
      const row = rankingFromRaw(r, o.ctx, source);
      if (row) out.rankings.push(row);
    }
    return out;
  }
  if (kind === 'alliances') {
    rows.forEach((r, i) => {
      const a = allianceFromRaw(r, o.ctx, source, i + 1);
      if (a) out.alliances.push(a);
    });
    return out;
  }
  if (kind !== 'matches') return out;

  for (const r of rows) {
    let raw: Raw = r;
    if (o.mapping) {
      raw = { ...r };
      for (const [field, header] of Object.entries(o.mapping)) if (header) raw[field] = r[header];
    }
    const label = raw['match_label'] ?? raw['label'];
    const compLevel = o.compLevel ?? (isPlayoffLabel(label) ? 'po' : 'qm');
    const m = matchFromRaw(raw, { compLevel, source, ctx: o.ctx, recompute: o.recompute });
    if (!m) continue;
    (compLevel === 'qm' ? out.quals : out.playoffs).push(m);
    for (const w of m.warnings ?? []) out.warnings.push(`${m.label}: ${w}`);
  }
  return out;
}

/** Plain-text schedule paste: "1 611 449 321 526 3504 686" or CSV/TSV with/without header. */
export function parseSchedulePaste(text: string, ctx: TeamIdContext, compLevel: CompLevel = 'qm'): OfficialData {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return emptyOfficialData();
  const first = lines[0].split(/[\t,;]+|\s{2,}|\s/).map((s) => s.trim());
  const hasHeader = first.some((c) => /[a-z]{2,}/i.test(c) && !/^\d+b?$/i.test(c));
  if (hasHeader) return importCsv(lines.join('\n').replace(/\t/g, ','), { ctx, source: 'manual', compLevel });
  const csv = ['match_number,red1,red2,red3,blue1,blue2,blue3,time'];
  for (const l of lines) {
    const cells = l.split(/[\t,;]+|\s+/).filter(Boolean);
    if (cells.length < 7) continue;
    csv.push(cells.slice(0, 8).join(','));
  }
  return importCsv(csv.join('\n'), { ctx, source: 'manual', compLevel });
}
