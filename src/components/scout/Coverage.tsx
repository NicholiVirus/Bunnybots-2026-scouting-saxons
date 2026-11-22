'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '@/data/db';
import type { MatchRow } from '@/data/types';
import { displayTeam } from '@/lib/teamIds';
import { cx } from '@/components/ui';

const STALE_DRAFT_MS = 10 * 60_000;

/** team → scouts currently watching (drafts < 10 min old, live, or submitted). */
export function useCoverage(matchKey: string | undefined, includeId?: string, includeTeams?: string[], includeName?: string) {
  const subs = useLiveQuery(() => (matchKey ? db.scout_submissions.where('match_key').equals(matchKey).toArray() : []), [matchKey], []);
  return useMemo(() => {
    const m = new Map<string, string[]>();
    const now = Date.now();
    for (const s of subs) {
      if (s.discarded || s.deleted_at || s.id === includeId) continue;
      if (s.status === 'draft' && now - new Date(s.updated_at).getTime() > STALE_DRAFT_MS) continue;
      for (const t of s.teams) m.set(t, [...(m.get(t) ?? []), s.scout_name || 'scout']);
    }
    if (includeTeams) for (const t of includeTeams) m.set(t, [...(m.get(t) ?? []), includeName ? `${includeName} (you)` : 'you']);
    return m;
  }, [subs, includeId, includeTeams, includeName]);
}

export function CoverageBar({ match, coverage }: { match: MatchRow; coverage: Map<string, string[]> }) {
  const cell = (t: string, side: 'red' | 'blue') => {
    const who = coverage.get(t) ?? [];
    const tone = who.length === 0 ? 'bg-surface-2 text-muted border-line' : who.length === 1 ? 'bg-good/20 text-good border-good/50' : 'bg-warn/20 text-warn border-warn/50';
    return (
      <div key={t} className={cx('min-w-0 flex-1 rounded-lg border px-1 py-1 text-center', tone)} title={who.join(', ') || 'nobody'}>
        <div className={cx('text-xs font-bold tnum', side === 'red' ? 'text-redA' : 'text-blueA')}>{displayTeam(t)}</div>
        <div className="truncate text-[10px]">{who.length === 0 ? 'nobody' : who.length === 1 ? who[0] : `${who.length} scouts`}</div>
      </div>
    );
  };
  return (
    <div data-testid="coverage" className="space-y-1">
      <div className="flex gap-1">{match.red.map((t) => cell(t, 'red'))}</div>
      <div className="flex gap-1">{match.blue.map((t) => cell(t, 'blue'))}</div>
      <div className="flex gap-3 text-[10px] text-muted">
        <span>■ green = covered</span>
        <span>■ gray = nobody</span>
        <span>■ orange = 2+ scouts</span>
      </div>
    </div>
  );
}
