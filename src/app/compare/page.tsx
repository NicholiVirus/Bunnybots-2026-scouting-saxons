'use client';
import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { X } from 'lucide-react';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import type { TeamStats } from '@/analytics/model';
import { teamStrength } from '@/analytics/strength';
import { ROLE_LABEL } from '@/game/harvestHavoc.config';
import { PIT_LABELS } from '@/catalog/pit';
import { isOurTeam } from '@/config/event';
import { displayTeam, compareTeamIds } from '@/lib/teamIds';
import { Card, Empty, PageTitle, cx, fmt, pct } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import { TeamTags } from '@/components/TeamTags';

const COLORS = ['var(--saxon)', 'var(--red-alliance)', 'var(--blue-alliance)', '#22c55e'];

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <CompareInner />
    </Suspense>
  );
}

function CompareInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const model = useAnalytics();
  const photos = usePhotoMap();
  const ids = (sp.get('teams') ?? '').split(',').filter(Boolean).slice(0, 4);
  const teams = ids.map((t) => model?.teams.get(t)).filter(Boolean) as TeamStats[];
  const set = (next: string[]) => router.replace(`/compare/?teams=${next.map(encodeURIComponent).join(',')}`);
  const all = useMemo(() => (model ? [...model.teams.keys()].sort(compareTeamIds) : []), [model]);

  const chart = useMemo(() => {
    const keys = [...new Set(teams.flatMap((t) => t.series.map((s, i) => i)))].sort((a, b) => a - b);
    return keys.map((i) => Object.fromEntries([['match', `#${i + 1}`], ...teams.map((t) => [t.team, t.series[i]?.points ?? null])]));
  }, [teams]);

  if (!model) return null;
  const rows: { label: string; get: (t: TeamStats) => string; best?: (t: TeamStats) => number | null }[] = [
    { label: 'Expected points (prediction)', get: (t) => fmt(teamStrength(t, model).mu, 0), best: (t) => teamStrength(t, model).mu },
    { label: 'Avg scouted points', get: (t) => (t.n ? `${fmt(t.points.mean)} (n=${t.n})` : '—'), best: (t) => (t.n ? t.points.mean : null) },
    { label: 'Floor / ceiling', get: (t) => (t.n ? `${fmt(t.points.min, 0)} / ${fmt(t.points.max, 0)}` : '—'), best: (t) => (t.n ? t.points.min : null) },
    { label: 'Recent form (last 3)', get: (t) => fmt(t.recent3), best: (t) => t.recent3 },
    { label: 'Reliability', get: (t) => pct(t.reliability), best: (t) => t.reliability },
    { label: 'Median cycle', get: (t) => (t.cycles ? `${fmt(t.cycles.median)} s (n=${t.cycles.n})` : '—'), best: (t) => (t.cycles ? -t.cycles.median : null) },
    { label: 'Cake cycle', get: (t) => (t.cycles?.byPiece.cake ? `${fmt(t.cycles.byPiece.cake.median)} s` : '—'), best: (t) => (t.cycles?.byPiece.cake ? -t.cycles.byPiece.cake.median : null) },
    { label: 'Pantry carrots pts', get: (t) => fmt(t.byCategory.pantryCarrot), best: (t) => t.byCategory.pantryCarrot },
    { label: 'Pantry cakes pts', get: (t) => fmt(t.byCategory.pantryCake), best: (t) => t.byCategory.pantryCake },
    { label: 'L3 pieces / match', get: (t) => fmt(t.pieces.l3), best: (t) => t.pieces.l3 },
    { label: 'Oven pts', get: (t) => fmt(t.byCategory.oven), best: (t) => t.byCategory.oven },
    { label: 'Cakes generated / match', get: (t) => fmt(t.cake.cakesGenerated), best: (t) => t.cake.cakesGenerated },
    { label: 'Endgame value', get: (t) => fmt(t.endgame.value), best: (t) => t.endgame.value },
    { label: 'Hauls cakes', get: (t) => pct(t.endgame.cakeHaulRate), best: (t) => t.endgame.cakeHaulRate },
    { label: 'OPR', get: (t) => fmt(t.official.opr), best: (t) => t.official.opr },
    { label: 'Foul pts given / match', get: (t) => fmt(t.fouls.pointsPerMatch), best: (t) => (t.fouls.pointsPerMatch === null ? null : -t.fouls.pointsPerMatch) },
    { label: 'Driver (relative)', get: (t) => fmt(t.driver.relScore, 0), best: (t) => t.driver.relScore },
    { label: 'Defense played', get: (t) => pct(t.defense.rate) },
    { label: 'Role', get: (t) => (t.role ? ROLE_LABEL[t.role] : '—') },
    { label: 'Drivetrain', get: (t) => (t.pit.drivetrain ? PIT_LABELS.drivetrain[t.pit.drivetrain] : '—') },
    { label: 'Mechanism', get: (t) => (t.pit.mechanism ? PIT_LABELS.mechanism[t.pit.mechanism] : '—') },
    { label: 'Levels', get: (t) => t.pit.levels?.join(', ') ?? '—' },
    { label: 'Rank', get: (t) => (t.official.rank ? `#${t.official.rank}` : '—'), best: (t) => (t.official.rank ? -t.official.rank : null) },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageTitle sub="Head-to-head, 2–4 teams (best value per row in gold)">Compare teams</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        {ids.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-xl border border-line bg-surface px-2 py-1">
            <TeamChip team={t} photo={photos.get(t)} size={24} link={false} />
            <button aria-label={`Remove ${t}`} onClick={() => set(ids.filter((x) => x !== t))} className="text-muted hover:text-bad">
              <X size={14} />
            </button>
          </span>
        ))}
        {ids.length < 4 && (
          <select className="h-10 rounded-xl border border-line bg-surface-2 px-2" value="" onChange={(e) => e.target.value && set([...ids, e.target.value])} aria-label="Add team">
            <option value="">+ add team</option>
            {all
              .filter((t) => !ids.includes(t))
              .map((t) => (
                <option key={t} value={t}>
                  {displayTeam(t)} {model.teams.get(t)?.name}
                </option>
              ))}
          </select>
        )}
      </div>
      {teams.length < 2 ? (
        <Empty title="Pick at least two teams" />
      ) : (
        <>
          <div className="scroll-x rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="p-2" />
                  {teams.map((t) => (
                    <th key={t.team} className={cx('p-2 text-left', isOurTeam(t.team) && 'ours')}>
                      <TeamChip team={t.team} photo={photos.get(t.team)} size={40} showName />
                      <div className="mt-1">
                        <TeamTags t={t} max={4} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const vals = r.best ? teams.map((t) => r.best!(t)) : [];
                  const finite = vals.filter((v): v is number => v !== null && Number.isFinite(v));
                  const max = finite.length && new Set(finite).size > 1 ? Math.max(...finite) : null;
                  return (
                    <tr key={r.label} className="border-b border-line last:border-0">
                      <td className="p-2 text-xs text-muted">{r.label}</td>
                      {teams.map((t, i) => (
                        <td key={t.team} className={cx('p-2 tnum', max !== null && vals[i] === max && teams.length > 1 && 'font-bold text-saxon')}>
                          {r.get(t)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Card title="Points per scouted match">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ left: -20, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="match" stroke="var(--muted)" fontSize={11} />
                  <YAxis stroke="var(--muted)" fontSize={11} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} />
                  <Legend />
                  {teams.map((t, i) => (
                    <Line key={t.team} type="monotone" dataKey={t.team} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
