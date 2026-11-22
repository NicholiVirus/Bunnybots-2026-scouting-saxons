'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Handshake, Swords as Versus } from 'lucide-react';
import { useMatches } from '@/data/hooks';
import { nextMatchFor, ourRelation } from '@/analytics/schedule';
import { OUR_TEAMS } from '@/config/event';
import { usePrefs } from '@/lib/prefs';
import { Badge, cx } from './ui';
import { ourTeamsFor } from './OurTeamSwitch';

/** "611: Q14 in ~3 matches" cards for each of our robots (respects the 611/526/Both filter). */
export function NextMatchCards({ activeKey, onPick }: { activeKey?: string; onPick?: (key: string) => void }) {
  const matches = useMatches() ?? [];
  const prefs = usePrefs();
  const ours = ourTeamsFor(prefs.ourTeam);
  const cards = useMemo(() => ours.map((t) => ({ team: t, next: nextMatchFor(t, matches) })), [ours.join(), matches]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cx('grid gap-2', cards.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {cards.map(({ team, next }) => {
        if (!next)
          return (
            <div key={team} className="rounded-2xl border border-line bg-surface p-3">
              <div className="text-lg font-black text-saxon">{team}</div>
              <div className="text-sm text-muted">No upcoming matches</div>
            </div>
          );
        const rel = ourRelation(next.match, OUR_TEAMS);
        const body = (
          <div className={cx('rounded-2xl border-2 bg-surface p-3', activeKey === next.match.key ? 'border-saxon' : 'border-line')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-black text-saxon">{team}</span>
              <span className={cx('text-xs font-bold uppercase', next.alliance === 'red' ? 'text-redA' : 'text-blueA')}>{next.alliance}</span>
            </div>
            <div className="text-2xl font-black">{next.match.label}</div>
            <div className="text-sm text-muted">{next.matchesAway === 0 ? 'next on the field' : `in ~${next.matchesAway} match${next.matchesAway === 1 ? '' : 'es'}`}</div>
            {rel === 'partners' && (
              <Badge tone="saxon" className="mt-1">
                <Handshake size={12} /> with {team === '611' ? '526' : '611'}
              </Badge>
            )}
            {rel === 'opponents' && (
              <Badge tone="warn" className="mt-1">
                <Versus size={12} /> vs {team === '611' ? '526' : '611'}
              </Badge>
            )}
          </div>
        );
        return onPick ? (
          <button key={team} className="text-left" onClick={() => onPick(next.match.key)}>
            {body}
          </button>
        ) : (
          <Link key={team} href={`/preview/?key=${encodeURIComponent(next.match.key)}`}>
            {body}
          </Link>
        );
      })}
    </div>
  );
}
