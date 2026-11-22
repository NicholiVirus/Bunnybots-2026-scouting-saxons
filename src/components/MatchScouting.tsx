'use client';
/** Scouting reports for one match (raw view; analytics merge duplicates elsewhere). */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import type { MatchRow } from '@/data/types';
import { FLAG_LABEL } from '@/game/harvestHavoc.config';
import { Badge, Card } from './ui';
import { TeamChip } from './TeamChip';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { allianceChecks } from '@/analytics/accuracy';

export function MatchScouting({ m }: { m: MatchRow }) {
  const subs = useLiveQuery(() => db.scout_submissions.where('match_key').equals(m.key).toArray(), [m.key], []);
  const reports = useLiveQuery(
    async () => {
      const ids = subs.map((s) => s.id);
      return ids.length ? db.robot_reports.where('submission_id').anyOf(ids).toArray() : [];
    },
    [subs],
    [],
  );
  const model = useAnalytics();
  const checks = model ? allianceChecks([m], model.records) : [];
  const live = subs.filter((s) => !s.discarded && s.status === 'submitted');
  if (!live.length) return null;
  const byId = new Map(live.map((s) => [s.id, s]));
  return (
    <Card title={`Scouting (${live.length} submission${live.length === 1 ? '' : 's'})`}>
      {checks.map((c) => (
        <p key={c.alliance} className={`mb-2 rounded-lg p-2 text-sm ${c.warn ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good'}`}>
          {c.alliance === 'red' ? 'Red' : 'Blue'}: scouts counted {c.scoutedPieces.toFixed(1)} scored pieces, field says {c.officialPieces} (
          {c.relDiff > 0 ? '+' : ''}
          {Math.round(c.relDiff * 100)}%){c.warn ? ' — check this match’s scouting' : ' ✓'}
        </p>
      ))}
      <ul className="space-y-2">
        {reports
          .filter((r) => byId.has(r.submission_id))
          .map((r) => {
            const s = byId.get(r.submission_id)!;
            return (
              <li key={r.id} className="rounded-xl bg-surface-2 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <TeamChip team={r.team_id} size={22} />
                  <span className="text-muted">
                    by {s.scout_name || 'unknown'} · watched {s.robot_count}
                  </span>
                  {r.driver_rating && <Badge>driver {r.driver_rating}/5</Badge>}
                  {r.defense_played && <Badge tone="warn">defense</Badge>}
                  {r.flags.map((f) => (
                    <Badge key={f} tone="bad">
                      {FLAG_LABEL[f]}
                    </Badge>
                  ))}
                </div>
                {r.note && <p className="mt-1">{r.note}</p>}
              </li>
            );
          })}
      </ul>
    </Card>
  );
}
