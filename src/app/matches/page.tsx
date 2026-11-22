'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Handshake, Swords as Versus } from 'lucide-react';
import { useMatches } from '@/data/hooks';
import { useFlagIndex } from '@/data/scoutHooks';
import { matchStatuses, ourRelation } from '@/analytics/schedule';
import { FLAG_LABEL } from '@/game/harvestHavoc.config';
import { usePrefs } from '@/lib/prefs';
import { useAuth, can } from '@/sync/auth';
import { OUR_TEAMS } from '@/config/event';
import type { MatchRow, Alliance } from '@/data/types';
import { Badge, Empty, PageTitle, Segmented, cx } from '@/components/ui';
import { FreshnessBanner } from '@/components/FreshnessBanner';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import { RpBadges } from '@/components/RpBadges';
import { ourTeamsFor } from '@/components/OurTeamSwitch';

type Filter = 'all' | 'ours' | 'upcoming' | 'complete';

export default function MatchesPage() {
  const matches = useMatches();
  const prefs = usePrefs();
  const [level, setLevel] = useState<'qm' | 'po'>('qm');
  const [filter, setFilter] = useState<Filter>('all');
  const statuses = useMemo(() => matchStatuses(matches ?? []), [matches]);
  const ours = ourTeamsFor(prefs.ourTeam);

  const shown = (matches ?? []).filter((m) => {
    if (m.comp_level !== level) return false;
    if (filter === 'ours') return ours.some((t) => m.red.includes(t) || m.blue.includes(t));
    if (filter === 'upcoming') return !m.played;
    if (filter === 'complete') return m.played;
    return true;
  });
  const hasPlayoffs = (matches ?? []).some((m) => m.comp_level === 'po');

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle sub={<FreshnessBanner />}>Matches</PageTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <Segmented
          value={level}
          onChange={setLevel}
          options={[
            { value: 'qm', label: 'Quals' },
            { value: 'po', label: hasPlayoffs ? 'Playoffs' : 'Playoffs (—)' },
          ]}
        />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'ours', label: prefs.ourTeam === 'both' ? 'Ours' : prefs.ourTeam },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'complete', label: 'Done' },
          ]}
        />
      </div>
      {matches && shown.length === 0 && (
        <Empty title="No matches yet">An admin loads the schedule (Admin → Data sources) or turns on the results feed.</Empty>
      )}
      <ul className="space-y-2">
        {shown.map((m) => (
          <MatchRowCard key={m.key} m={m} status={statuses.get(m.key) ?? 'upcoming'} />
        ))}
      </ul>
    </div>
  );
}

function MatchRowCard({ m, status }: { m: MatchRow; status: string }) {
  const router = useRouter();
  const photos = usePhotoMap();
  const flags = useFlagIndex();
  const auth = useAuth();
  const rel = ourRelation(m, OUR_TEAMS);
  const involvesUs = OUR_TEAMS.some((t) => m.red.includes(t) || m.blue.includes(t));

  const side = (a: Alliance) => {
    const score = a === 'red' ? m.red_score : m.blue_score;
    const won = m.winner === a;
    return (
      <div className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2', a === 'red' ? 'bg-redA/10' : 'bg-blueA/10', won && 'ring-2 ring-inset', won && (a === 'red' ? 'ring-redA' : 'ring-blueA'))}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {m[a].map((t, i) => {
            const fi = flags.get(`${m.key}:${t}`);
            return (
              <span key={i} className="flex items-center gap-1">
                <TeamChip team={t} photo={photos.get(t)} size={22} />
                {fi && fi.flags.length > 0 && (
                  <span className="flex flex-wrap gap-0.5">
                    {fi.flags.map((f) => (
                      <Badge key={f} tone="bad" className="px-1 py-0 text-[10px]">
                        {FLAG_LABEL[f]}
                      </Badge>
                    ))}
                    {fi.disagree && can.admin(auth.role) && (
                      <span title={fi.byScout.map((b) => `${b.scout}: ${b.flags.join(', ') || 'none'}`).join('\n')}>
                        <AlertTriangle size={12} className="text-warn" />
                      </span>
                    )}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cx('tnum text-2xl font-bold', !won && m.played && 'opacity-60')}>{score ?? '–'}</span>
          <RpBadges m={m} side={a} />
        </div>
      </div>
    );
  };

  return (
    <li
      className={cx('cursor-pointer rounded-2xl border border-line bg-surface p-2 hover:border-saxon', involvesUs && 'ours')}
      onClick={() => router.push(`/match/?key=${encodeURIComponent(m.key)}`)}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="font-bold">{m.label}</span>
        <span className="flex items-center gap-1">
          {rel === 'partners' && (
            <Badge tone="saxon">
              <Handshake size={12} /> 611+526 partners
            </Badge>
          )}
          {rel === 'opponents' && (
            <Badge tone="warn">
              <Versus size={12} /> 611 vs 526
            </Badge>
          )}
          {(m.warnings?.length ?? 0) > 0 && (
            <span title={m.warnings!.join('\n')}>
              <Badge tone="warn">data warning</Badge>
            </span>
          )}
          <Badge tone={status === 'complete' ? 'neutral' : status === 'on_deck' ? 'saxon' : 'neutral'}>
            {status === 'complete' ? 'Complete' : status === 'on_deck' ? 'On deck' : 'Upcoming'}
          </Badge>
        </span>
      </div>
      <div className="flex gap-2">
        {side('red')}
        {side('blue')}
      </div>
    </li>
  );
}
