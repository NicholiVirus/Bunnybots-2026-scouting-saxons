/** Schedule helpers: match status, our next matches, partner/opponent detection. */
import type { Alliance, MatchRow } from '@/data/types';

export type MatchStatus = 'complete' | 'on_deck' | 'upcoming';

export function orderMatches(matches: MatchRow[]): MatchRow[] {
  return [...matches].sort((a, b) => (a.comp_level === b.comp_level ? a.match_number - b.match_number : a.comp_level === 'qm' ? -1 : 1));
}

/** "On deck" = the next two unplayed matches after the last played one. */
export function matchStatuses(matches: MatchRow[], onDeckCount = 2): Map<string, MatchStatus> {
  const ordered = orderMatches(matches);
  const out = new Map<string, MatchStatus>();
  let lastPlayed = -1;
  ordered.forEach((m, i) => {
    if (m.played) lastPlayed = i;
  });
  let deck = 0;
  ordered.forEach((m, i) => {
    if (m.played) out.set(m.key, 'complete');
    else if (i > lastPlayed && deck < onDeckCount) {
      out.set(m.key, 'on_deck');
      deck++;
    } else out.set(m.key, 'upcoming');
  });
  return out;
}

export function allianceOf(m: MatchRow, team: string): Alliance | null {
  if (m.red.includes(team)) return 'red';
  if (m.blue.includes(team)) return 'blue';
  return null;
}

export interface NextMatch {
  match: MatchRow;
  alliance: Alliance;
  /** Unplayed matches before it (0 = it's next on the field). */
  matchesAway: number;
}

export function nextMatchFor(team: string, matches: MatchRow[]): NextMatch | null {
  const ordered = orderMatches(matches).filter((m) => !m.played);
  for (let i = 0; i < ordered.length; i++) {
    const a = allianceOf(ordered[i], team);
    if (a) return { match: ordered[i], alliance: a, matchesAway: i };
  }
  return null;
}

export function remainingMatchesFor(team: string, matches: MatchRow[], compLevel: 'qm' | 'po' = 'qm'): MatchRow[] {
  return orderMatches(matches).filter((m) => !m.played && m.comp_level === compLevel && allianceOf(m, team));
}

/** 611 & 526 in the same match: together (partners) or against each other (opponents). */
export function ourRelation(m: MatchRow, ours: readonly string[]): 'partners' | 'opponents' | null {
  const sides = ours.map((t) => allianceOf(m, t)).filter(Boolean) as Alliance[];
  if (sides.length < 2) return null;
  return sides[0] === sides[1] ? 'partners' : 'opponents';
}

export function stationOf(m: MatchRow, team: string): string | null {
  const a = allianceOf(m, team);
  if (!a) return null;
  return `${a}${m[a].indexOf(team) + 1}`;
}
