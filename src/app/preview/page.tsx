'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { Handshake, Swords as Versus } from 'lucide-react';
import { db } from '@/data/db';
import { useMatches } from '@/data/hooks';
import { putRow } from '@/data/repo';
import type { Alliance, MatchRow } from '@/data/types';
import { useAnalytics } from '@/analytics/AnalyticsProvider';
import { forecastMatch, type AllianceForecast } from '@/analytics/predict';
import { nextMatchFor, orderMatches, ourRelation } from '@/analytics/schedule';
import type { TeamStats } from '@/analytics/model';
import { FLAG_LABEL, type ProblemFlag } from '@/game/harvestHavoc.config';
import { OUR_TEAMS } from '@/config/event';
import { usePrefs } from '@/lib/prefs';
import { displayTeam } from '@/lib/teamIds';
import { useAuth, can, whoAmI } from '@/sync/auth';
import { Badge, Button, Card, Empty, N, PageTitle, cx, fmt, pct } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import { TeamTags } from '@/components/TeamTags';
import { NextMatchCards } from '@/components/NextMatchCards';
import { ourTeamsFor } from '@/components/OurTeamSwitch';

export default function PreviewPage() {
  return (
    <Suspense fallback={null}>
      <PreviewInner />
    </Suspense>
  );
}

function PreviewInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const matches = useMatches() ?? [];
  const prefs = usePrefs();
  const model = useAnalytics();
  const ordered = useMemo(() => orderMatches(matches), [matches]);
  const ours = ourTeamsFor(prefs.ourTeam);
  const fallbackKey = useMemo(() => {
    const nexts = ours.map((t) => nextMatchFor(t, matches)).filter(Boolean);
    nexts.sort((a, b) => a!.matchesAway - b!.matchesAway);
    return nexts[0]?.match.key ?? ordered.find((m) => !m.played)?.key ?? ordered[0]?.key;
  }, [ours.join(), matches, ordered]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = sp.get('key') ?? fallbackKey;
  const m = ordered.find((x) => x.key === key);
  const forecast = useMemo(() => (m && model ? forecastMatch(m, model) : null), [m, model]);

  const go = (k: string) => router.replace(`/preview/?key=${encodeURIComponent(k)}`);
  if (!ordered.length) return <Empty title="No schedule yet" />;
  if (!m || !model || !forecast) return null;
  const rel = ourRelation(m, OUR_TEAMS);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageTitle
        sub={m.played ? `Played ${m.red_score}–${m.blue_score}` : 'Upcoming'}
        actions={
          <select className="h-10 rounded-xl border border-line bg-surface-2 px-2" value={m.key} onChange={(e) => go(e.target.value)} aria-label="Match">
            {ordered.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
                {x.played ? ' ✓' : ''}
              </option>
            ))}
          </select>
        }
      >
        Preview {m.label}
      </PageTitle>
      <NextMatchCards activeKey={m.key} onPick={go} />
      {rel === 'partners' && (
        <p className="flex items-center gap-2 rounded-xl bg-saxon/15 p-3 text-sm font-semibold text-saxon">
          <Handshake size={16} /> 611 and 526 are PARTNERS this match — plan together.
        </p>
      )}
      {rel === 'opponents' && (
        <p className="flex items-center gap-2 rounded-xl bg-warn/15 p-3 text-sm font-semibold text-warn">
          <Versus size={16} /> Heads-up: 611 and 526 are OPPONENTS this match.
        </p>
      )}
      <WinCard forecast={forecast} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AllianceColumn m={m} side="red" f={forecast.red} model={model.teams} />
        <AllianceColumn m={m} side="blue" f={forecast.blue} model={model.teams} />
      </div>
      <StrategyNotes m={m} />
    </div>
  );
}

function WinCard({ forecast }: { forecast: ReturnType<typeof forecastMatch> }) {
  const p = forecast.pRed;
  return (
    <Card title="Win probability (estimate)">
      <div className="flex h-10 overflow-hidden rounded-xl text-sm font-bold text-white">
        <div className="flex items-center justify-start bg-redA px-3" style={{ width: `${Math.max(8, p * 100)}%` }}>
          {Math.round(p * 100)}%
        </div>
        <div className="flex flex-1 items-center justify-end bg-blueA px-3">{Math.round((1 - p) * 100)}%</div>
      </div>
      <p className="mt-2 text-sm">{forecast.explanation}</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        {(['red', 'blue'] as const).map((side) => {
          const a = side === 'red' ? forecast.red : forecast.blue;
          return (
            <div key={side} className={cx('rounded-xl p-2', side === 'red' ? 'bg-redA/10' : 'bg-blueA/10')}>
              <div className="mb-1 font-semibold">
                {side === 'red' ? 'Red' : 'Blue'}: {a.mu.toFixed(0)} ± {a.sd.toFixed(0)} pts
              </div>
              <div className="grid grid-cols-3 gap-1 text-center text-xs">
                <RpOdd label="Stocked" p={a.sim.rp.stocked} />
                <RpOdd label="Baked" p={a.sim.rp.baked} />
                <RpOdd label="Dinner" p={a.sim.rp.dinner} />
              </div>
              <div className="mt-1 text-[11px] text-muted">
                capped sim: {a.sim.mean.toFixed(0)} pts (p10–p90 {a.sim.p10.toFixed(0)}–{a.sim.p90.toFixed(0)}) · n={a.sim.n} runs
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RpOdd({ label, p }: { label: string; p: number }) {
  return (
    <div className="rounded-lg bg-surface p-1">
      <div className="text-muted">{label}</div>
      <div className={cx('text-lg font-black tnum', p >= 0.6 ? 'text-good' : p >= 0.3 ? 'text-warn' : 'text-bad')}>{pct(p)}</div>
    </div>
  );
}

function AllianceColumn({ m, side, f, model }: { m: MatchRow; side: Alliance; f: AllianceForecast; model: Map<string, TeamStats> }) {
  const photos = usePhotoMap();
  return (
    <div className="space-y-2">
      <h2 className={cx('text-lg font-bold uppercase', side === 'red' ? 'text-redA' : 'text-blueA')}>{side}</h2>
      {m[side].map((team, i) => {
        const t = model.get(team);
        const s = f.strengths.find((x) => x.team === team);
        return (
          <Card key={team + i} className={cx((OUR_TEAMS as readonly string[]).includes(team) && 'ours')}>
            <div className="flex items-start gap-3">
              <TeamChip team={team} photo={photos.get(team)} size={56} showName />
            </div>
            {t && (
              <>
                <div className="my-2">
                  <TeamTags t={t} max={7} />
                </div>
                <div className="grid grid-cols-4 gap-1 text-center text-xs">
                  <Mini label="Expected" value={fmt(s?.mu, 0)} sub={s?.source} />
                  <Mini label="Avg (scouted)" value={t.n ? fmt(t.points.mean) : '—'} sub={`n=${t.n}`} />
                  <Mini label="Reliable" value={pct(t.reliability)} sub={`n=${t.n}`} />
                  <Mini label="Med. cycle" value={t.cycles ? `${fmt(t.cycles.median)}s` : '—'} sub={`n=${t.cycles?.n ?? 0}`} />
                </div>
                <div className="mt-2 text-xs text-muted">
                  Bonus RP when on an alliance: S {pct(t.rpRates.stocked)} · B {pct(t.rpRates.baked)} · D {pct(t.rpRates.dinner)}
                  <N n={t.rpRates.n} />
                </div>
                {Object.keys(t.flagCounts).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(Object.entries(t.flagCounts) as [ProblemFlag, number][]).map(([fl, n]) => (
                      <Badge key={fl} tone="bad">
                        {FLAG_LABEL[fl]} ×{n}
                      </Badge>
                    ))}
                  </div>
                )}
                {t.notes.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {t.notes.slice(-3).map((n, k) => (
                      <li key={k} className="rounded-lg bg-surface-2 p-1.5">
                        <b>{n.matchKey}</b> {n.text}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-1">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="font-bold tnum">{value}</div>
      {sub && <div className="text-[9px] text-muted">{sub}</div>}
    </div>
  );
}

function StrategyNotes({ m }: { m: MatchRow }) {
  const auth = useAuth();
  const note = useLiveQuery(() => db.strategy_notes.get(m.key), [m.key]);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const editable = can.editStrategy(auth.role);
  useEffect(() => {
    setText(note?.note ?? '');
    setPlan(note?.plan ?? {});
    setSaved(false);
  }, [note?.updated_at, m.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // plan roles for the alliance that has one of our robots (red if neither)
  const isOurs = (x: string) => (OUR_TEAMS as readonly string[]).includes(x);
  const ourSide = m.red.some(isOurs) ? m.red : m.blue.some(isOurs) ? m.blue : m.red;
  return (
    <Card title="Match strategy" actions={note && <span className="text-xs text-muted">by {note.updated_by_name}</span>}>
      {!editable && !note && <p className="text-sm text-muted">No plan yet (strategists write it here).</p>}
      {(editable || note) && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {ourSide.map((t) => (
              <label key={t} className="text-sm">
                <span className="font-bold">{displayTeam(t)}</span>
                <input
                  className="mt-1 h-10 w-full rounded-lg border border-line bg-surface-2 px-2"
                  placeholder="role: L3 cakes / oven feeder / haul…"
                  value={plan[t] ?? ''}
                  disabled={!editable}
                  onChange={(e) => {
                    setPlan({ ...plan, [t]: e.target.value });
                    setSaved(false);
                  }}
                />
              </label>
            ))}
          </div>
          <textarea
            className="h-24 w-full rounded-xl border border-line bg-surface-2 p-2 text-sm"
            placeholder="Who scores L3 cakes, who feeds the oven, who hauls, defense plan…"
            value={text}
            disabled={!editable}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(false);
            }}
          />
          {editable && (
            <Button
              variant="primary"
              onClick={async () => {
                const me = whoAmI();
                await putRow('strategy_notes', { match_key: m.key, note: text, plan, updated_by: me.id, updated_by_name: me.name });
                setSaved(true);
              }}
            >
              {saved ? 'Saved ✓' : 'Save plan'}
            </Button>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        <Link className="underline" href={`/match/?key=${encodeURIComponent(m.key)}`}>
          Match details
        </Link>
      </p>
    </Card>
  );
}
