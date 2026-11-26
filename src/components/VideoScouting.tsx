'use client';
/**
 * Match page: the automatic video scout next to the human scouts, robot by robot.
 * Video numbers are computed from the video's events with the same code as a scout's taps.
 */
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { SHELVES } from '@/game/harvestHavoc.config';
import type { MatchRow } from '@/data/types';
import type { TeamMatchRecord } from '@/scouting/records';
import { Badge, Card, cx } from '@/components/ui';

const fmt = (x: number) => (Math.round(x * 10) / 10).toString();

function pantryText(r: NonNullable<TeamMatchRecord['video']>): string {
  const parts: string[] = [];
  for (const s of [...SHELVES].reverse()) {
    const c = r.totals.auto.pantry.carrot[s] + r.totals.teleop.pantry.carrot[s];
    const k = r.totals.auto.pantry.cake[s] + r.totals.teleop.pantry.cake[s];
    if (c || k) parts.push(`${s} ${c}c/${k}k`);
  }
  return parts.join(' · ') || '—';
}

export function VideoScouting({ m }: { m: MatchRow }) {
  const model = useAnalytics();
  const recs = (model?.records ?? []).filter((r) => r.matchKey === m.key && r.video);
  if (!recs.length) return null;
  const order = [...m.red, ...m.blue];
  recs.sort((a, b) => order.indexOf(a.team) - order.indexOf(b.team));
  return (
    <Card title="Video scouting (automatic)">
      <p className="mb-2 text-xs text-muted">
        From the match video: robots tracked on the field, team numbers read off the bumpers, PANTRY fills credited to the robot at the
        shelf. Rows marked <Badge tone="neutral">video only</Badge> had no human scout and count in the stats from the video alone.
      </p>
      <div className="scroll-x">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-1">Team</th>
              <th className="p-1 text-right">Scouts</th>
              <th className="p-1 text-right">Video</th>
              <th className="p-1">PANTRY (carrots c / cakes k)</th>
              <th className="p-1 text-right">Oven</th>
              <th className="p-1">Taxi / park</th>
              <th className="p-1">Sure?</th>
            </tr>
          </thead>
          <tbody>
            {recs.map((r) => {
              const v = r.video!;
              const c = v.report.confidence ?? {};
              const oven = v.totals.auto.oven.carrot + v.totals.auto.oven.cake + v.totals.teleop.oven.carrot + v.totals.teleop.oven.cake;
              return (
                <tr key={r.key} className="border-b border-line">
                  <td className={cx('p-1 font-semibold', r.alliance === 'red' ? 'text-redA' : 'text-blueA')}>{r.team}</td>
                  <td className="p-1 text-right tnum">
                    {r.source === 'video' ? <Badge tone="neutral">video only</Badge> : fmt(r.points.total)}
                  </td>
                  <td className="p-1 text-right font-semibold tnum">
                    {fmt(v.points.total)}{' '}
                    {v.agrees === false && <Badge tone="warn">{`${v.diff! > 0 ? '+' : ''}${fmt(v.diff!)}`}</Badge>}
                    {v.agrees === true && <Badge tone="good">agrees</Badge>}
                  </td>
                  <td className="p-1 text-xs">{pantryText(v)}</td>
                  <td className="p-1 text-right text-xs tnum" title="estimated: the official OVEN count shared by OVEN visits">
                    {oven ? `~${oven}` : '—'}
                  </td>
                  <td className="p-1 text-xs">
                    {v.totals.auto.taxi ? 'taxi' : '—'} / {v.totals.parked ? 'park' : '—'}
                  </td>
                  <td className="p-1 text-xs text-muted">
                    {typeof c.id === 'number' ? `id ${Math.round(c.id * 100)}%` : ''}
                    {c.pantry ? ` · credit ${c.pantry}` : ''}
                    {typeof c.tracked_frac === 'number' ? ` · seen ${Math.round(c.tracked_frac * 100)}%` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
