/**
 * Scouted vs official. Official breakdowns are per ALLIANCE (except taxi/park/
 * haul), so accuracy is measured on alliances whose 3 robots were all scouted:
 * scouted pieces (pantry + oven, all robots) vs the field's counts.
 */
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { SHELVES } from '@/game/harvestHavoc.config';
import type { Alliance, MatchRow } from '@/data/types';
import type { TeamMatchRecord } from '@/scouting/records';

export interface AllianceCheck {
  matchKey: string;
  alliance: Alliance;
  scoutedPieces: number;
  officialPieces: number;
  /** (scouted − official) / official */
  relDiff: number;
  warn: boolean;
  submissionIds: string[];
}

function officialPieces(m: MatchRow, side: Alliance): number | null {
  const b = m.breakdown?.[side];
  if (!b) return null;
  return SHELVES.reduce((a, s) => a + b.pantry.carrot[s] + b.pantry.cake[s], 0) + b.oven.carrot + b.oven.cake;
}

function scoutedPieces(r: TeamMatchRecord): number {
  const t = r.totals;
  return (
    SHELVES.reduce((a, s) => a + t.auto.pantry.carrot[s] + t.auto.pantry.cake[s] + t.teleop.pantry.carrot[s] + t.teleop.pantry.cake[s], 0) +
    t.auto.unknownLevelCarrots +
    t.auto.oven.carrot +
    t.auto.oven.cake +
    t.teleop.oven.carrot +
    t.teleop.oven.cake
  );
}

export function allianceChecks(matches: readonly MatchRow[], records: readonly TeamMatchRecord[], warnPct = DEFAULT_SETTINGS.officialMismatchWarnPct): AllianceCheck[] {
  const by = new Map<string, TeamMatchRecord>();
  for (const r of records) by.set(`${r.matchKey}:${r.team}`, r);
  const out: AllianceCheck[] = [];
  for (const m of matches) {
    if (!m.played || !m.breakdown) continue;
    for (const side of ['red', 'blue'] as const) {
      const recs = m[side].map((t) => by.get(`${m.key}:${t}`));
      if (recs.some((r) => !r)) continue; // need all 3 robots scouted
      const official = officialPieces(m, side);
      if (official === null) continue;
      const scouted = recs.reduce((a, r) => a + scoutedPieces(r!), 0);
      const rel = official > 0 ? (scouted - official) / official : scouted > 0 ? 1 : 0;
      out.push({
        matchKey: m.key,
        alliance: side,
        scoutedPieces: scouted,
        officialPieces: official,
        relDiff: rel,
        warn: Math.abs(rel) * 100 > warnPct && Math.abs(scouted - official) >= 2,
        submissionIds: [...new Set(recs.flatMap((r) => r!.scouts.map((s) => s.submission.id)))],
      });
    }
  }
  return out;
}

/** submission id → accuracy samples (1 − |relative error|, clamped to 0..1). */
export function accuracyBySubmission(checks: readonly AllianceCheck[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const c of checks) {
    const acc = Math.max(0, 1 - Math.abs(c.relDiff));
    for (const id of c.submissionIds) m.set(id, [...(m.get(id) ?? []), acc]);
  }
  return m;
}
