'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { db } from '@/data/db';
import { putRow } from '@/data/repo';
import type { ScoutSubmission } from '@/data/types';
import { useMatches } from '@/data/hooks';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { accuracyBySubmission, allianceChecks } from '@/analytics/accuracy';
import { scoutKey } from '@/analytics/leaderboard';
import { displayTeam } from '@/lib/teamIds';
import { mean } from '@/lib/stats';
import { Badge, Button, Card, Segmented, cx, fmt, pct } from '@/components/ui';

export function RawDataAdmin() {
  const subs = useLiveQuery(() => db.scout_submissions.toArray(), [], []);
  const matches = useMatches() ?? [];
  const model = useAnalytics();
  const [view, setView] = useState<'all' | 'flagged' | 'discarded'>('flagged');
  const [q, setQ] = useState('');

  const checks = useMemo(() => (model ? allianceChecks(matches, model.records) : []), [model, matches]);
  const acc = useMemo(() => accuracyBySubmission(checks), [checks]);
  const flaggedSubs = useMemo(() => {
    const s = new Set<string>();
    for (const c of checks) if (c.warn) c.submissionIds.forEach((id) => s.add(id));
    for (const r of model?.records ?? []) if (r.disagree || r.flagDisagree) r.scouts.forEach((x) => s.add(x.submission.id));
    return s;
  }, [checks, model]);

  // outlier scouts: low accuracy or frequent disagreement
  const outliers = useMemo(() => {
    const by = new Map<string, { name: string; acc: number[]; disagree: number; n: number }>();
    for (const sub of subs) {
      if (sub.status !== 'submitted' || sub.discarded) continue;
      const k = scoutKey(sub.scout_id, sub.scout_name);
      const e = by.get(k) ?? { name: sub.scout_name, acc: [], disagree: 0, n: 0 };
      e.n++;
      e.acc.push(...(acc.get(sub.id) ?? []));
      if (flaggedSubs.has(sub.id)) e.disagree++;
      by.set(k, e);
    }
    return [...by.values()].filter((e) => (e.acc.length >= 3 && mean(e.acc) < 0.7) || (e.n >= 4 && e.disagree / e.n > 0.5));
  }, [subs, acc, flaggedSubs]);

  const shown = subs
    .filter((s) => s.status === 'submitted')
    .filter((s) => (view === 'discarded' ? s.discarded : view === 'flagged' ? flaggedSubs.has(s.id) && !s.discarded : true))
    .filter((s) => !q || `${s.match_key} ${s.scout_name} ${s.teams.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));

  const discard = async (s: ScoutSubmission, on: boolean) => {
    const reason = on ? prompt('Reason for discarding (shown in the audit trail):', 'outlier / wrong match') : null;
    if (on && reason === null) return;
    await putRow('scout_submissions', { ...s, discarded: on, discard_reason: on ? reason : null });
  };

  return (
    <div className="space-y-4">
      {outliers.length > 0 && (
        <Card title="Outlier scouts" className="border-warn/50">
          <ul className="space-y-1 text-sm">
            {outliers.map((o) => (
              <li key={o.name} className="text-warn">
                {o.name}: accuracy {pct(o.acc.length ? mean(o.acc) : null)} (n={o.acc.length}) · {o.disagree}/{o.n} submissions flagged
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={`Scouting submissions (${shown.length})`}>
        <div className="mb-3 flex flex-wrap gap-2">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'flagged', label: `Flagged (${flaggedSubs.size})` },
              { value: 'all', label: 'All' },
              { value: 'discarded', label: 'Discarded' },
            ]}
          />
          <input className="h-9 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-sm" placeholder="filter: match, scout, team" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="divide-y divide-line">
          {shown.slice(0, 200).map((s) => {
            const a = acc.get(s.id);
            return (
              <li key={s.id} className={cx('flex flex-wrap items-center gap-2 py-2 text-sm', s.discarded && 'opacity-50')}>
                <Link className="font-bold underline" href={`/match/?key=${encodeURIComponent(s.match_key)}`}>
                  {s.match_key}
                </Link>
                <span className={s.alliance === 'red' ? 'text-redA' : 'text-blueA'}>{s.teams.map(displayTeam).join(', ')}</span>
                <span className="text-muted">
                  {s.scout_name} · {s.source} · watched {s.robot_count}
                </span>
                {a && <Badge tone={mean(a) >= 0.8 ? 'good' : 'warn'}>acc {fmt(mean(a) * 100, 0)}%</Badge>}
                {flaggedSubs.has(s.id) && <Badge tone="warn">check</Badge>}
                {s.discarded && <Badge tone="bad">discarded: {s.discard_reason}</Badge>}
                <span className="ml-auto flex gap-1">
                  <Link href={`/scout/?edit=${s.id}`}>
                    <Button size="sm">Open</Button>
                  </Link>
                  <Button size="sm" variant={s.discarded ? 'secondary' : 'danger'} onClick={() => void discard(s, !s.discarded)}>
                    {s.discarded ? 'Restore' : 'Discard'}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">Discarded submissions are excluded from every stat. Only admins can discard (enforced by the database).</p>
      </Card>
    </div>
  );
}
