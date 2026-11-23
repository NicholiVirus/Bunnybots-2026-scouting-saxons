'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { GitCompare, Wrench } from 'lucide-react';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import type { TeamStats } from '@/analytics/model';
import type { PitData } from '@/data/types';
import { DEFENSE_LABEL, FLAG_LABEL, MECHANISM_LABEL, ROLE_LABEL, type Mechanism, type ProblemFlag } from '@/game/harvestHavoc.config';
import { PIT_LABELS } from '@/catalog/pit';
import { isOurTeam } from '@/config/event';
import { displayTeam } from '@/lib/teamIds';
import { useAuth, can } from '@/sync/auth';
import { Badge, Button, Card, Empty, PageTitle, Stat, cx, fmt, pct } from '@/components/ui';
import { PhotoManager } from '@/components/PhotoManager';
import { FieldMap } from '@/components/FieldMap';
import { TeamTags } from '@/components/TeamTags';

export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <TeamInner />
    </Suspense>
  );
}

function TeamInner() {
  const id = useSearchParams().get('id') ?? '';
  const model = useAnalytics();
  const auth = useAuth();
  if (!model) return null;
  const t = model.teams.get(id);
  if (!t) return <Empty title={`Team ${id || '?'} not found`} />;
  const ours = isOurTeam(t.team);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageTitle
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {t.name}
            {t.status === 'expected' && <Badge tone="warn">expected</Badge>}
            {t.official.rank && <Badge>rank {t.official.rank}</Badge>}
          </span>
        }
        actions={
          <>
            {can.pitScout(auth.role) && (
              <Link href={`/pit/?id=${encodeURIComponent(t.team)}`}>
                <Button size="sm">
                  <Wrench size={16} /> Pit scout
                </Button>
              </Link>
            )}
            <Link href={`/compare/?teams=${encodeURIComponent(t.team)}`}>
              <Button size="sm">
                <GitCompare size={16} /> Compare
              </Button>
            </Link>
          </>
        }
      >
        <span className={cx(ours && 'text-saxon')}>{displayTeam(t.team)}</span>
      </PageTitle>
      <PhotoManager team={t.team} />
      <TeamTags t={t} max={14} />
      <KeyStats t={t} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Points per match">
          <PointsChart t={t} />
        </Card>
        <Card title="Average points by category">
          <CategoryChart t={t} />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CycleCard t={t} />
        <Architecture t={t} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <MechanismCard t={t} />
        <OfficialCard t={t} />
      </div>
      <History t={t} />
      <Notes t={t} />
    </div>
  );
}

function KeyStats({ t }: { t: TeamStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      <Stat label="Avg points (scouted)" value={t.n ? fmt(t.points.mean) : '—'} sub={t.n ? `sd ${fmt(t.points.sd)} · ${fmt(t.points.min, 0)}–${fmt(t.points.max, 0)}` : undefined} n={t.n} />
      <Stat label="Recent form (last 3)" value={fmt(t.recent3)} n={Math.min(3, t.n)} />
      <Stat label="Reliability" value={pct(t.reliability)} sub="no died/no-show/brownout/E-stop" n={t.n} />
      <Stat
        label="Median cycle"
        value={t.cycles ? `${fmt(t.cycles.median)} s` : '—'}
        sub={t.cycles ? `fastest ${fmt(t.cycles.fastest)} s · ${fmt(t.cycles.perMatch)}/match` : undefined}
        n={t.cycles?.n ?? 0}
      />
      <Stat
        label="Endgame value"
        value={fmt(t.endgame.value)}
        sub={t.endgame.parkRate !== null ? `park ${pct(t.endgame.parkRate)} · haul ${fmt(t.endgame.haulPoints)}` : undefined}
        n={t.official.robot?.matches ?? t.n}
      />
      <Stat label="OPR" value={fmt(t.official.opr)} sub={t.oprGap !== null ? `scouted − OPR: ${t.oprGap > 0 ? '+' : ''}${fmt(t.oprGap)}${t.oprGapFlag ? ' ⚠' : ''}` : undefined} n={t.official.record?.played ?? 0} />
      <Stat label="Cakes generated / match" value={fmt(t.cake.cakesGenerated)} sub={`oven carrots ${fmt(t.cake.ovenCarrots)} → +${fmt(t.cake.feederCredit)} partner pts`} n={t.n} />
      <Stat label="Driver" value={t.driver.relScore !== null ? fmt(t.driver.relScore, 0) : fmt(t.driver.rating)} sub={t.driver.relScore !== null ? `relative score (0–100) · rating ${fmt(t.driver.rating)}` : 'rating 1–5'} n={t.driver.relN || t.n} />
      <Stat label="Defense played" value={pct(t.defense.rate)} sub={t.defense.rating !== null ? `effectiveness ${fmt(t.defense.rating)}/5` : undefined} n={t.n} />
      <Stat label="Foul pts given / match" value={fmt(t.fouls.pointsPerMatch)} sub={t.fouls.majorsPerMatch !== null ? `majors ${fmt(t.fouls.majorsPerMatch, 2)}` : undefined} n={t.official.robot?.matches ?? 0} />
      <Stat label="Bonus RP rates" value={t.rpRates.n ? `${pct(t.rpRates.stocked)} / ${pct(t.rpRates.baked)} / ${pct(t.rpRates.dinner)}` : '—'} sub="Stocked / Baked / Dinner" n={t.rpRates.n} />
      <Stat label="Role" value={<span className="text-base">{t.role ? ROLE_LABEL[t.role] : '—'}</span>} sub={t.roleInferred ? `from scouting: ${ROLE_LABEL[t.roleInferred]}` : undefined} />
    </div>
  );
}

function PointsChart({ t }: { t: TeamStats }) {
  if (t.series.length < 1) return <p className="text-sm text-muted">No scouted matches yet.</p>;
  const data = t.series.map((s) => ({ match: s.matchKey, points: Math.round(s.points * 10) / 10 }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="match" stroke="var(--muted)" fontSize={11} />
          <YAxis stroke="var(--muted)" fontSize={11} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} />
          <Line type="monotone" dataKey="points" stroke="var(--saxon)" strokeWidth={2} dot />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryChart({ t }: { t: TeamStats }) {
  if (!t.n) return <p className="text-sm text-muted">No scouted matches yet.</p>;
  const c = t.byCategory;
  const data = [
    { k: 'Pantry carrots', v: c.pantryCarrot },
    { k: 'Pantry cakes', v: c.pantryCake },
    { k: 'Oven', v: c.oven },
    { k: 'Taxi', v: c.taxi },
    { k: 'Park', v: c.park },
    { k: 'Haul', v: c.haul },
  ].map((d) => ({ ...d, v: Math.round(d.v * 10) / 10 }));
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="k" stroke="var(--muted)" fontSize={10} interval={0} />
          <YAxis stroke="var(--muted)" fontSize={11} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12 }} />
          <Bar dataKey="v" fill="var(--saxon)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-muted">
        Per match: auto {fmt(c.auto)} · teleop {fmt(c.teleop)} · endgame {fmt(c.endgame)} (n={t.n})
      </p>
    </div>
  );
}

function CycleCard({ t }: { t: TeamStats }) {
  const c = t.cycles;
  return (
    <Card title="Cycle times" actions={c && <Badge tone={c.confidence === 'high' ? 'good' : c.confidence === 'medium' ? 'warn' : 'bad'}>{c.confidenceLabel}</Badge>}>
      {!c ? (
        <p className="text-sm text-muted">No timed cycles yet (needs tap scouting with the event log).</p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Median" value={`${fmt(c.median)}s`} n={c.n} />
            <Stat label="Mean" value={`${fmt(c.mean)}s`} />
            <Stat label="Consistency (sd)" value={`${fmt(c.sd)}s`} />
          </div>
          <table className="w-full">
            <tbody>
              {(['carrot', 'cake'] as const).map((p) => (
                <tr key={p} className="border-b border-line">
                  <td className="py-1 capitalize text-muted">{p}</td>
                  <td className="text-right tnum">{c.byPiece[p] ? `${fmt(c.byPiece[p]!.median)} s` : '—'}</td>
                  <td className="text-right text-xs text-muted">n={c.byPiece[p]?.n ?? 0}</td>
                </tr>
              ))}
              {(['L1', 'L2', 'L3', 'oven', 'haul'] as const).map((k) => (
                <tr key={k} className="border-b border-line">
                  <td className="py-1 text-muted">{k === 'oven' ? 'Oven' : k === 'haul' ? 'Endgame haul' : k}</td>
                  <td className="text-right tnum">{c.byTarget[k] ? `${fmt(c.byTarget[k]!.median)} s` : '—'}</td>
                  <td className="text-right text-xs text-muted">n={c.byTarget[k]?.n ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {c.pickupMedian !== null && (
            <p className="text-muted">
              Split (with intake taps): pickup {fmt(c.pickupMedian)} s · delivery {fmt(c.deliveryMedian)} s
            </p>
          )}
          {c.longGaps > 0 && <p className="text-warn">{c.longGaps} long gap(s) over the cap excluded.</p>}
        </div>
      )}
    </Card>
  );
}

function Architecture({ t }: { t: TeamStats }) {
  const p = t.pit;
  const row = (k: string, v: React.ReactNode) =>
    v === undefined || v === null || v === '' ? null : (
      <tr className="border-b border-line">
        <td className="py-1 pr-2 text-muted">{k}</td>
        <td className="py-1">{v}</td>
      </tr>
    );
  const yn = (b?: boolean) => (b === undefined ? undefined : b ? 'Yes' : 'No');
  return (
    <Card title={`Architecture (${t.pitReports} pit report${t.pitReports === 1 ? '' : 's'})`}>
      {t.pitIssues.length > 0 && (
        <ul className="mb-2 list-disc pl-5 text-sm text-bad">
          {t.pitIssues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {t.pitReports === 0 ? (
        <p className="text-sm text-muted">No pit scouting yet.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {row('Scoring mechanism', p.mechanism && PIT_LABELS.mechanism[p.mechanism])}
            {row('Pantry levels', p.levels?.join(', '))}
            {row('Oven capable', p.oven && PIT_LABELS.oven[p.oven])}
            {row('Drivetrain', p.drivetrain && PIT_LABELS.drivetrain[p.drivetrain])}
            {row('Ground intake', yn(p.groundIntake))}
            {row('Ground intake reliability', t.groundIntakeReliability && `${PIT_LABELS.reliability[t.groundIntakeReliability]}${t.mechanisms.ground_intake ? ' (from match reports)' : ''}`)}
            {row('Max haul (match reports)', t.maxHaulObserved)}
            {row('Hauls cakes', yn(p.haulsCakes))}
            {row('Auto: taxi', yn(p.autoTaxi))}
            {row('Auto: scores both preloads', yn(p.autoScoresBothPreloads))}
            {row('Auto: scores', autoScoringText(p.autoScoring))}
            {row('Auto: picks up prestaged', yn(p.autoPicksPrestaged))}
            {row('Auto description', p.autoDescription)}
            {row('Human player (1–5)', p.humanPlayerQuality)}
            {row('Weight (lb)', p.weightLb)}
            {row('Frame perimeter (in)', p.framePerimeterIn)}
            {row('Start height (in)', p.startHeightIn)}
            {row('Driver experience', p.driverExperience)}
            {row('Notes', p.notes)}
          </tbody>
        </table>
      )}
      {p.autoEnd && (
        <div className="mt-3">
          <p className="mb-1 text-sm text-muted">Auto ends here</p>
          <FieldMap value={p.autoEnd} />
        </div>
      )}
    </Card>
  );
}

function MechanismCard({ t }: { t: TeamStats }) {
  const entries = Object.entries(t.mechanisms) as [Mechanism, NonNullable<TeamStats['mechanisms'][Mechanism]>][];
  return (
    <Card title="Mechanism reliability (post-match reports)">
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No mechanism reports yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="text-left">Mechanism</th>
              <th>Worked</th>
              <th>Partial</th>
              <th>Failed</th>
              <th className="text-left">Trend</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, s]) => (
              <tr key={k} className="border-b border-line">
                <td className="py-1">{MECHANISM_LABEL[k]}</td>
                <td className="text-center tnum text-good">{s.worked}</td>
                <td className="text-center tnum text-warn">{s.partial}</td>
                <td className="text-center tnum text-bad">{s.failed}</td>
                <td className={cx('text-xs', s.trend?.startsWith('failed') ? 'text-bad' : 'text-muted')}>{s.trend ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Object.keys(t.flagCounts).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {(Object.entries(t.flagCounts) as [ProblemFlag, number][]).map(([f, n]) => (
            <Badge key={f} tone="bad">
              {FLAG_LABEL[f]} ×{n}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function OfficialCard({ t }: { t: TeamStats }) {
  const r = t.official.robot;
  const c = t.official.components;
  return (
    <Card title="Official data (field system)">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="OPR" value={fmt(t.official.opr)} />
        <Stat label="No-foul OPR" value={fmt(c.noFoul)} />
        <Stat label="Pantry OPR" value={fmt(c.pantry)} />
        <Stat label="Oven OPR" value={fmt(c.oven)} />
        <Stat label="Cake-L3 OPR" value={fmt(c.cakeL3, 2)} />
        <Stat label="Endgame OPR" value={fmt(c.endgame)} />
        <Stat label="Taxi rate" value={pct(r?.taxiRate)} n={r?.matches ?? 0} />
        <Stat label="Park rate" value={pct(r?.parkRate)} n={r?.matches ?? 0} />
      </div>
      {t.official.record && (
        <p className="mt-2 text-sm text-muted">
          Record {t.official.record.wins}-{t.official.record.losses}-{t.official.record.ties} · {t.official.record.rp} RP in {t.official.record.played} matches
        </p>
      )}
      {t.oprGapFlag && <p className="mt-2 text-sm text-warn">Scouted average and OPR disagree by {fmt(t.oprGap)} pts — check scouting accuracy.</p>}
    </Card>
  );
}

function History({ t }: { t: TeamStats }) {
  if (!t.records.length) return null;
  return (
    <Card title="Match history (scouted)">
      <div className="scroll-x">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-1">Match</th>
              <th className="p-1 text-right">Pts</th>
              <th className="p-1 text-right">Auto</th>
              <th className="p-1 text-right">Cycles</th>
              <th className="p-1">Flags</th>
              <th className="p-1">Defense</th>
              <th className="p-1">Scouts</th>
            </tr>
          </thead>
          <tbody>
            {t.records.map((r) => (
              <tr key={r.key} className="border-b border-line">
                <td className="p-1">
                  <Link className="underline" href={`/match/?key=${encodeURIComponent(r.matchKey)}`}>
                    {r.matchKey}
                  </Link>{' '}
                  <span className={r.alliance === 'red' ? 'text-redA' : 'text-blueA'}>●</span>
                </td>
                <td className="p-1 text-right font-semibold tnum">{fmt(r.points.total)}</td>
                <td className="p-1 text-right tnum">{fmt(r.points.auto)}</td>
                <td className="p-1 text-right tnum">{r.cycles ? r.cycles.cycles.length : '—'}</td>
                <td className="p-1">
                  {r.flags.map((f) => (
                    <Badge key={f} tone="bad">
                      {FLAG_LABEL[f]}
                    </Badge>
                  ))}
                  {r.disagree && <Badge tone="warn">scouts disagree</Badge>}
                </td>
                <td className="p-1 text-xs">{r.defense.played ? (r.defense.type ? DEFENSE_LABEL[r.defense.type] : 'yes') : ''}</td>
                <td className="p-1 text-xs text-muted">{r.scouts.map((s) => s.submission.scout_name).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Notes({ t }: { t: TeamStats }) {
  if (!t.notes.length) return null;
  return (
    <Card title={`Post-match notes (${t.notes.length})`}>
      <ol className="space-y-2">
        {t.notes.map((n, i) => (
          <li key={i} className="rounded-xl bg-surface-2 p-2 text-sm">
            <span className="mr-2 font-semibold">{n.matchKey}</span>
            <span className="text-muted">{n.scout}</span>
            <p>{n.text}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function autoScoringText(a: PitData['autoScoring']): string | undefined {
  if (!a) return undefined;
  const parts: string[] = [];
  for (const piece of ['carrot', 'cake'] as const)
    for (const [t, n] of Object.entries(a[piece] ?? {})) if (n) parts.push(`${n} ${piece}${n > 1 ? 's' : ''} ${t === 'oven' ? 'Oven' : t}`);
  return parts.length ? parts.join(', ') : 'Nothing';
}
