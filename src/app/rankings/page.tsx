'use client';
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useMatches } from '@/data/hooks';
import { computeRankings, teamRecords } from '@/analytics/rankings';
import { isOurTeam } from '@/config/event';
import { Badge, Empty, PageTitle, cx, pct } from '@/components/ui';
import { FreshnessBanner } from '@/components/FreshnessBanner';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import { SOURCE_LABEL } from '@/sources/DataSource';

export default function RankingsPage() {
  const official = useLiveQuery(() => db.rankings.toArray(), [], []);
  const matches = useMatches() ?? [];
  const photos = usePhotoMap();
  const records = useMemo(() => teamRecords(matches), [matches]);
  const computed = useMemo(() => computeRankings(matches).filter((r) => r.matches_played > 0), [matches]);
  const rows = official.length ? [...official].sort((a, b) => a.rank - b.rank) : computed;
  const source = official.length ? SOURCE_LABEL[official[0].source] : 'computed from match results';

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle sub={<FreshnessBanner />}>Rankings</PageTitle>
      <p className="mb-3 text-sm text-muted">
        Rank = average RP (Win 3 · Tie 1 · Stocked · Baked · Dinner). Tiebreakers: W-L record → cumulative alliance score → random. Source:{' '}
        <Badge>{source}</Badge>
      </p>
      {rows.length === 0 ? (
        <Empty title="No rankings yet">Rankings appear after the first qualification results.</Empty>
      ) : (
        <div className="scroll-x rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="p-2">#</th>
                <th className="p-2">Team</th>
                <th className="p-2 text-right">Ranking score</th>
                <th className="p-2 text-right">W-L-T</th>
                <th className="p-2 text-right">Total RP</th>
                <th className="p-2 text-right">Avg match</th>
                <th className="p-2 text-right" title="Share of this team's matches where its alliance earned the bonus RP">
                  Stocked
                </th>
                <th className="p-2 text-right">Baked</th>
                <th className="p-2 text-right">Dinner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rec = records.get(r.team_id);
                const n = rec?.played ?? 0;
                return (
                  <tr key={r.team_id} className={cx('border-b border-line last:border-0', isOurTeam(r.team_id) && 'ours')}>
                    <td className="p-2 font-bold tnum">{r.rank}</td>
                    <td className="p-2">
                      <TeamChip team={r.team_id} photo={photos.get(r.team_id)} showName />
                    </td>
                    <td className="p-2 text-right font-semibold tnum">{r.ranking_score.toFixed(2)}</td>
                    <td className="p-2 text-right tnum">
                      {r.wins}-{r.losses}-{r.ties}
                    </td>
                    <td className="p-2 text-right tnum">{r.ranking_total}</td>
                    <td className="p-2 text-right tnum">{Number(r.avg_match).toFixed(1)}</td>
                    <td className="p-2 text-right tnum">{n ? pct(rec!.stocked / n) : '—'}</td>
                    <td className="p-2 text-right tnum">{n ? pct(rec!.baked / n) : '—'}</td>
                    <td className="p-2 text-right tnum">
                      {n ? pct(rec!.dinner / n) : '—'} <span className="text-[10px] text-muted">n={n}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
