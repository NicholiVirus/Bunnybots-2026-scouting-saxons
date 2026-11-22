'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { applyFilter, sortTeams, SORT_LABEL, type SortKey, type TeamFilter } from '@/catalog/filters';
import { isOurTeam } from '@/config/event';
import { displayTeam } from '@/lib/teamIds';
import { Empty, PageTitle, Spinner, cx, fmt, pct } from '@/components/ui';
import { TeamFilters } from '@/components/TeamFilters';
import { TeamTags } from '@/components/TeamTags';
import { TeamAvatar, usePhotoMap } from '@/components/TeamChip';

export default function TeamsPage() {
  const model = useAnalytics();
  const photos = usePhotoMap();
  const [filter, setFilter] = useState<TeamFilter>({ hideWithdrawn: true });
  const [sort, setSort] = useState<SortKey>('team');
  const list = useMemo(() => (model ? sortTeams([...model.teams.values()].filter((t) => applyFilter(t, filter)), sort) : []), [model, filter, sort]);

  if (!model)
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl">
      <PageTitle
        sub={`${list.length} of ${model.teams.size} teams`}
        actions={
          <label className="flex items-center gap-2 text-sm">
            Sort
            <select className="h-10 rounded-xl border border-line bg-surface-2 px-2" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {Object.entries(SORT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        }
      >
        Team catalog
      </PageTitle>
      <div className="mb-4">
        <TeamFilters value={filter} onChange={setFilter} />
      </div>
      {list.length === 0 && <Empty title="No teams match these filters" />}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <li key={t.team}>
            <Link
              href={`/team/?id=${encodeURIComponent(t.team)}`}
              className={cx('flex gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-saxon', isOurTeam(t.team) && 'ours')}
            >
              <TeamAvatar team={t.team} url={photos.get(t.team)} size={84} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={cx('text-xl font-black tnum', isOurTeam(t.team) && 'text-saxon')}>{displayTeam(t.team)}</span>
                  <span className="truncate text-sm text-muted">{t.name}</span>
                </div>
                <div className="my-1">
                  <TeamTags t={t} max={6} />
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-xs">
                  <MiniStat label="Avg pts" value={t.n ? fmt(t.points.mean) : '—'} n={t.n} />
                  <MiniStat label="Reliable" value={pct(t.reliability)} n={t.n} />
                  <MiniStat label="Med. cycle" value={t.cycles ? `${fmt(t.cycles.median)}s` : '—'} n={t.cycles?.n ?? 0} />
                  <MiniStat label="OPR" value={fmt(t.official.opr)} n={t.official.record?.played ?? 0} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniStat({ label, value, n }: { label: string; value: string; n: number }) {
  return (
    <div className="rounded-lg bg-surface-2 px-1 py-1">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="font-bold tnum">{value}</div>
      <div className="text-[9px] text-muted">n={n}</div>
    </div>
  );
}
