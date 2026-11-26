/**
 * Live-feed safety check: before the results feed is written into the shared
 * database, at least half of the teams in it must be on our event roster.
 * Stops placeholder/test data (e.g. 449's practice event with teams 1–24) or
 * another event's feed from overwriting real matches and rankings.
 */
import type { OfficialData } from './DataSource';

export interface RosterCheck {
  ok: boolean;
  known: number;
  total: number;
  unknown: string[];
}

export const MIN_ROSTER_SHARE = 0.5;

export function checkFeedAgainstRoster(d: OfficialData, rosterIds: Iterable<string>): RosterCheck {
  const roster = new Set(rosterIds);
  const seen = new Set<string>();
  for (const m of [...d.quals, ...d.playoffs]) for (const t of [...m.red, ...m.blue]) if (t) seen.add(t);
  for (const r of d.rankings) seen.add(r.team_id);
  const unknown = [...seen].filter((t) => !roster.has(t)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const total = seen.size;
  const known = total - unknown.length;
  // an empty feed (schedule not posted yet) is fine
  return { ok: total === 0 || known / total >= MIN_ROSTER_SHARE, known, total, unknown };
}

export function rosterGuardMessage(c: RosterCheck): string {
  const list = c.unknown.slice(0, 8).join(', ') + (c.unknown.length > 8 ? ', …' : '');
  return `Results feed not applied: ${c.total - c.known} of ${c.total} teams in it are not on the Blair BunnyBots roster (${list}). It looks like placeholder or another event's data. The app will apply it automatically once the real schedule is posted.`;
}
