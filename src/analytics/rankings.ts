/**
 * Qualification rankings computed from match results with the official rules
 * (avg RP; tiebreakers W-L record → cumulative alliance score → random).
 * Used when the API's rankings are unavailable (manual mode) and by simulations.
 */
import { outcomeFor, rankingPointsFor, type RpFlags } from '@/game/scoring';
import type { Alliance, MatchRow, RankingRow, SourceKind } from '@/data/types';
import { hashString, nowIso } from '@/lib/util';

export interface TeamRecord {
  team: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  dq: number;
  rp: number;
  cumScore: number;
  /** Matches where this team's alliance earned each bonus RP. */
  stocked: number;
  baked: number;
  dinner: number;
}

const NO_FLAGS: RpFlags = { stocked: false, baked: false, dinner: false };

export function matchFlags(m: MatchRow, side: Alliance): RpFlags {
  return m.rp?.[side] ?? m.breakdown?.[side]?.rp ?? NO_FLAGS;
}

export function emptyRecord(team: string): TeamRecord {
  return { team, played: 0, wins: 0, losses: 0, ties: 0, dq: 0, rp: 0, cumScore: 0, stocked: 0, baked: 0, dinner: 0 };
}

export function teamRecords(matches: MatchRow[]): Map<string, TeamRecord> {
  const recs = new Map<string, TeamRecord>();
  const get = (t: string) => {
    let r = recs.get(t);
    if (!r) recs.set(t, (r = emptyRecord(t)));
    return r;
  };
  for (const m of matches) {
    if (m.comp_level !== 'qm' || !m.played || m.red_score === null || m.blue_score === null) continue;
    for (const side of ['red', 'blue'] as const) {
      const mine = side === 'red' ? m.red_score : m.blue_score;
      const theirs = side === 'red' ? m.blue_score : m.red_score;
      const outcome = outcomeFor(mine, theirs);
      const flags = matchFlags(m, side);
      const rp = rankingPointsFor(outcome, flags);
      for (const t of m[side]) {
        if (!t) continue;
        const r = get(t);
        r.played++;
        r.cumScore += mine;
        const dq = (m.dq ?? []).includes(t);
        if (dq) {
          r.dq++;
          r.losses++;
          continue; // DQ: 0 match points, 0 RP
        }
        if (outcome === 'win') r.wins++;
        else if (outcome === 'loss') r.losses++;
        else r.ties++;
        r.rp += rp;
        if (flags.stocked) r.stocked++;
        if (flags.baked) r.baked++;
        if (flags.dinner) r.dinner++;
      }
    }
  }
  return recs;
}

/** Sort key per the manual: avg RP, then W-L record, then cumulative score, then random. */
export function compareRecords(a: TeamRecord, b: TeamRecord, randomSeed = 'hh'): number {
  const avg = (r: TeamRecord) => (r.played ? r.rp / r.played : 0);
  const d = avg(b) - avg(a);
  if (Math.abs(d) > 1e-9) return d;
  const wl = (r: TeamRecord) => (r.played ? (r.wins - r.losses) / r.played : 0);
  const d2 = wl(b) - wl(a);
  if (Math.abs(d2) > 1e-9) return d2;
  const d3 = b.cumScore - a.cumScore;
  if (d3 !== 0) return d3;
  return hashString(randomSeed + a.team).localeCompare(hashString(randomSeed + b.team));
}

export function computeRankings(matches: MatchRow[], teams: string[] = [], source: SourceKind = 'manual'): RankingRow[] {
  const recs = teamRecords(matches);
  for (const t of teams) if (!recs.has(t)) recs.set(t, emptyRecord(t));
  const sorted = [...recs.values()].sort((a, b) => compareRecords(a, b));
  const ts = nowIso();
  return sorted.map((r, i) => ({
    team_id: r.team,
    rank: i + 1,
    ranking_score: r.played ? r.rp / r.played : 0,
    ranking_total: r.rp,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    dq: r.dq,
    matches_played: r.played,
    avg_match: r.played ? r.cumScore / r.played : 0,
    source,
    updated_at: ts,
  }));
}
