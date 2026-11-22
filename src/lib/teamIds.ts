/**
 * Team id normalization. Team ids are STRINGS ("449b"). The field system encodes
 * B robots as "9" + number (449b → 9449). Every importer runs ids through here.
 */
import { DEFAULT_ALIASES, ROSTER } from '@/config/event';

export interface TeamIdContext {
  known: ReadonlySet<string>;
  aliases: Readonly<Record<string, string>>;
}

export const defaultTeamIdContext = (): TeamIdContext => ({
  known: new Set(ROSTER.map((t) => t.id)),
  aliases: DEFAULT_ALIASES,
});

/** Lowercase, trimmed token without "frc" prefix or CSV float noise ("449.0"). */
export function cleanTeamToken(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s || s === 'na' || s === 'null' || s === 'undefined' || s === '0' || s === '-' || s === '–') return null;
  s = s.replace(/^frc/, '').replace(/\s+/g, '');
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s || null;
}

/**
 * Map any incoming team token to our canonical id.
 * Order: exact roster id → alias map → "9"+n heuristic (only if `${n}b` is a known team) → raw.
 * (So 9033 Ocebots stays 9033, while 9449 becomes 449b.)
 */
export function normalizeTeamId(raw: unknown, ctx: TeamIdContext = defaultTeamIdContext()): string | null {
  const s = cleanTeamToken(raw);
  if (!s) return null;
  if (ctx.known.has(s)) return s;
  const alias = ctx.aliases[s];
  if (alias) return alias;
  const m = /^9(\d+)$/.exec(s);
  if (m && ctx.known.has(`${m[1]}b`)) return `${m[1]}b`;
  return s;
}

/** Numeric part of a team id ("449b" → 449). */
export function teamNumber(id: string): number {
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Sort: by number, then B robots after the A robot. */
export function compareTeamIds(a: string, b: string): number {
  const d = teamNumber(a) - teamNumber(b);
  return d !== 0 ? d : a.localeCompare(b);
}

/** Display: "449b" → "449B". */
export const displayTeam = (id: string | null | undefined) => (id ? id.replace(/b$/i, 'B') : '—');
