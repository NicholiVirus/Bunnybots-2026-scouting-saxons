/** Scout leaderboard: volume + quality (accuracy vs the field system), with badges. */
import type { PitReport, RobotReport, ScoutSubmission } from '@/data/types';
import { mean } from '@/lib/stats';

export interface ScoutRow {
  key: string;
  name: string;
  matches: number;
  robots: number;
  multiRobot: number;
  pit: number;
  reports: number;
  notes: number;
  accuracy: number | null;
  accuracyN: number;
  points: number;
  badges: string[];
}

export function scoutKey(id: string | null, name: string) {
  return id ?? `name:${(name || 'unknown').trim().toLowerCase()}`;
}

export function buildLeaderboard(
  subs: readonly ScoutSubmission[],
  reports: readonly RobotReport[],
  pit: readonly PitReport[],
  accuracy: Map<string, number[]>,
  opts: { day?: string | null } = {},
): ScoutRow[] {
  const inDay = (iso: string | null | undefined) => {
    if (!opts.day) return true;
    if (!iso) return false;
    const d = new Date(iso);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return local === opts.day;
  };
  const rows = new Map<string, ScoutRow & { acc: number[] }>();
  const get = (id: string | null, name: string) => {
    const k = scoutKey(id, name);
    let r = rows.get(k);
    if (!r) {
      r = { key: k, name: name || 'unknown', matches: 0, robots: 0, multiRobot: 0, pit: 0, reports: 0, notes: 0, accuracy: null, accuracyN: 0, points: 0, badges: [], acc: [] };
      rows.set(k, r);
    }
    if (name && r.name === 'unknown') r.name = name;
    return r;
  };
  const repBySub = new Map<string, RobotReport[]>();
  for (const r of reports) repBySub.set(r.submission_id, [...(repBySub.get(r.submission_id) ?? []), r]);
  for (const s of subs) {
    if (s.status !== 'submitted' || s.discarded || s.deleted_at || !inDay(s.submitted_at)) continue;
    const r = get(s.scout_id, s.scout_name);
    r.matches++;
    r.robots += s.teams.length;
    if (s.teams.length > 1) r.multiRobot++;
    const reps = repBySub.get(s.id) ?? [];
    r.reports += reps.filter((x) => Object.keys(x.mechanisms ?? {}).length > 0 || x.note?.trim()).length;
    r.notes += reps.filter((x) => x.note?.trim()).length;
    r.acc.push(...(accuracy.get(s.id) ?? []));
  }
  for (const p of pit) {
    if (p.deleted_at || !inDay(p.created_at)) continue;
    get(p.author_id, p.author_name).pit++;
  }
  const out: ScoutRow[] = [];
  for (const r of rows.values()) {
    const accuracy = r.acc.length ? mean(r.acc) : null;
    const badges: string[] = [];
    for (const [n, label] of [
      [50, '🏆 50 matches'],
      [25, '🥇 25 matches'],
      [10, '🥈 10 matches'],
    ] as const) {
      if (r.matches >= n) {
        badges.push(label);
        break;
      }
    }
    if (r.pit >= 10) badges.push('🔧 Pit master');
    if (r.multiRobot >= 10) badges.push('👀 Triple vision');
    if (r.notes >= 25) badges.push('📝 Note taker');
    if (accuracy !== null && r.acc.length >= 5 && accuracy >= 0.9) badges.push('🎯 Sharpshooter');
    // points: volume + quality bonus
    const points = r.matches * 10 + r.robots * 3 + r.pit * 8 + r.notes * 2 + (accuracy !== null ? Math.round(accuracy * 50) : 0);
    out.push({ key: r.key, name: r.name, matches: r.matches, robots: r.robots, multiRobot: r.multiRobot, pit: r.pit, reports: r.reports, notes: r.notes, accuracy, accuracyN: r.acc.length, points, badges });
  }
  return out.sort((a, b) => b.points - a.points || b.matches - a.matches);
}
