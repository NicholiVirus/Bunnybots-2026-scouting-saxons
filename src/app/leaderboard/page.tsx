'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useMatches } from '@/data/hooks';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { accuracyBySubmission, allianceChecks } from '@/analytics/accuracy';
import { buildLeaderboard } from '@/analytics/leaderboard';
import { whoAmI } from '@/sync/auth';
import { Badge, Empty, PageTitle, Segmented, cx, pct } from '@/components/ui';

export default function LeaderboardPage() {
  const subs = useLiveQuery(() => db.scout_submissions.toArray(), [], []);
  const reports = useLiveQuery(() => db.robot_reports.toArray(), [], []);
  const pit = useLiveQuery(() => db.pit_reports.toArray(), [], []);
  const matches = useMatches() ?? [];
  const model = useAnalytics();
  const [scope, setScope] = useState<'day' | 'all'>('all');
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const rows = useMemo(() => {
    const acc = model ? accuracyBySubmission(allianceChecks(matches, model.records)) : new Map<string, number[]>();
    return buildLeaderboard(subs, reports, pit, acc, { day: scope === 'day' ? day : null });
  }, [subs, reports, pit, matches, model, scope, day]);
  const me = whoAmI();

  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle
        sub="Matches scouted, pit profiles, post-match reports and accuracy vs the official breakdown"
        actions={
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'day', label: 'Today' },
              { value: 'all', label: 'All-time' },
            ]}
          />
        }
      >
        Scout leaderboard
      </PageTitle>
      {rows.length === 0 ? (
        <Empty title="No scouting yet">Submit a match or a pit report to get on the board.</Empty>
      ) : (
        <div className="scroll-x rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="p-2">#</th>
                <th className="p-2">Scout</th>
                <th className="p-2 text-right">Matches</th>
                <th className="p-2 text-right">Robots</th>
                <th className="p-2 text-right">Pit</th>
                <th className="p-2 text-right">Reports</th>
                <th className="p-2 text-right" title="1 − |scouted − official| ÷ official, on alliances whose 3 robots were all scouted">
                  Accuracy
                </th>
                <th className="p-2 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={cx('border-b border-line last:border-0', (me.id ? r.key === me.id : r.name === me.name) && 'ours')}>
                  <td className="p-2 font-black">{i + 1}</td>
                  <td className="p-2">
                    <div className="font-semibold">{r.name}</div>
                    <div className="flex flex-wrap gap-1">
                      {r.badges.map((b) => (
                        <Badge key={b} tone="saxon">
                          {b}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-right tnum">{r.matches}</td>
                  <td className="p-2 text-right tnum">{r.robots}</td>
                  <td className="p-2 text-right tnum">{r.pit}</td>
                  <td className="p-2 text-right tnum">{r.reports}</td>
                  <td className="p-2 text-right tnum">
                    {pct(r.accuracy)} <span className="text-[10px] text-muted">n={r.accuracyN}</span>
                  </td>
                  <td className="p-2 text-right font-bold tnum">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
