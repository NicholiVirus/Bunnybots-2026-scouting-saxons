'use client';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import {
  DEFENSE_LABEL,
  DEFENSE_TYPES,
  FLAG_LABEL,
  MECHANISM_LABEL,
  MECHANISMS,
  MECH_STATUSES,
  PROBLEM_FLAGS,
  type MechStatus,
  type Mechanism,
  type ProblemFlag,
} from '@/game/harvestHavoc.config';
import type { RobotReport } from '@/data/types';
import type { ScoutingBundle } from '@/data/repo';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { useSettings } from '@/data/hooks';
import { computeCycles } from '@/scouting/cycles';
import { robotPoints, totalsFromEvents } from '@/scouting/derive';
import { everFlags, type useScoutSession } from '@/scouting/session';
import { displayTeam } from '@/lib/teamIds';
import { median } from '@/lib/stats';
import { Badge, Button, Card, cx, fmt, haptic } from '@/components/ui';
import { SortableList } from '@/components/SortableList';
import { TeamAvatar, usePhotoMap } from '@/components/TeamChip';

type Session = ReturnType<typeof useScoutSession>;

const STATUS_LABEL: Record<MechStatus, string> = { worked: 'Worked', partial: 'Partial', failed: 'Failed', not_used: 'Not used' };
const STATUS_TONE: Record<MechStatus, string> = {
  worked: 'border-good bg-good text-white',
  partial: 'border-warn bg-warn text-black',
  failed: 'border-bad bg-bad text-white',
  not_used: 'border-muted bg-muted text-black',
};

export function PostMatch({ s, onSubmit, resubmit }: { s: Session; onSubmit: () => void; resubmit?: boolean }) {
  const b = s.bundle as ScoutingBundle;
  const teams = b.submission.teams;
  const [active, setActive] = useState(teams[0]);
  const settings = useSettings();
  const photos = usePhotoMap();

  // confirm flags: start from everything tapped during the match (only once)
  useEffect(() => {
    for (const t of teams) {
      const r = b.reports.find((x) => x.team_id === t);
      if (r && !r.flags.length) {
        const ever = everFlags(b.events, t);
        if (ever.length) s.patchReport(t, { flags: ever });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // viewing a robot's card marks it viewed (Submit unlocks when all are viewed)
  useEffect(() => {
    const r = b.reports.find((x) => x.team_id === active);
    if (r && !r.viewed) s.patchReport(active, { viewed: true });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const summaries = useMemo(
    () =>
      Object.fromEntries(
        teams.map((t) => {
          const evs = b.events.filter((e) => e.team_id === t);
          const totals = totalsFromEvents(evs);
          const cyc = computeCycles(evs, {
            burstWindowMs: (settings.cycleBurstWindowSec ?? DEFAULT_SETTINGS.cycleBurstWindowSec) * 1000,
            outlierCapMs: (settings.cycleOutlierCapSec ?? DEFAULT_SETTINGS.cycleOutlierCapSec) * 1000,
          });
          return [t, { points: robotPoints(totals), cycles: cyc.cycles.length, median: cyc.cycles.length ? median(cyc.cycles.map((c) => c.durationMs / 1000)) : null }];
        }),
      ),
    [b.events, teams, settings.cycleBurstWindowSec, settings.cycleOutlierCapSec],
  );

  const allViewed = b.reports.every((r) => r.viewed || r.team_id === active);
  const report = b.reports.find((r) => r.team_id === active) as RobotReport;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex gap-1" role="tablist">
        {teams.map((t) => {
          const r = b.reports.find((x) => x.team_id === t);
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active === t}
              onClick={() => setActive(t)}
              className={cx('flex h-14 flex-1 items-center justify-center gap-2 rounded-xl border-2 font-black tnum', active === t ? 'border-saxon bg-saxon/15' : 'border-line bg-surface-2 text-muted')}
              data-testid={`post-tab-${t}`}
            >
              <TeamAvatar team={t} url={photos.get(t)} size={26} />
              {displayTeam(t)}
              {r?.viewed || active === t ? <CheckCircle2 size={14} className="text-good" /> : null}
            </button>
          );
        })}
      </div>

      <Card title={`Summary — ${displayTeam(active)}`}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-surface-2 p-2">
            <div className="text-xs text-muted">Points</div>
            <div className="text-2xl font-black tnum">{fmt(summaries[active]?.points.total, 0)}</div>
            <div className="text-[10px] text-muted">
              auto {summaries[active]?.points.auto} · endgame {summaries[active]?.points.endgame}
            </div>
          </div>
          <div className="rounded-xl bg-surface-2 p-2">
            <div className="text-xs text-muted">Cycles</div>
            <div className="text-2xl font-black tnum">{summaries[active]?.cycles}</div>
          </div>
          <div className="rounded-xl bg-surface-2 p-2">
            <div className="text-xs text-muted">Median cycle</div>
            <div className="text-2xl font-black tnum">{summaries[active]?.median !== null ? `${fmt(summaries[active]?.median)}s` : '—'}</div>
          </div>
        </div>
      </Card>

      <Card title="Notes (what worked / what didn't)">
        <textarea
          className="h-28 w-full rounded-xl border border-line bg-surface-2 p-3"
          placeholder="e.g. fast L3 cakes, struggled with ground intake, fed oven for partners…"
          value={report.note}
          onChange={(e) => s.patchReport(active, { note: e.target.value })}
          data-testid="note"
        />
        <div className="mt-3">
          <div className="mb-1 text-sm font-medium">Driver rating</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => {
                  haptic();
                  s.patchReport(active, { driver_rating: report.driver_rating === n ? null : n });
                }}
                className={cx('tap flex-1 rounded-xl border text-lg font-bold', report.driver_rating === n ? 'border-saxon bg-saxon text-saxon-ink' : 'border-line bg-surface-2 text-muted')}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Defense & problems (confirm)">
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            onClick={() => s.patchReport(active, { defense_played: !report.defense_played })}
            className={cx('tap rounded-xl border px-3 text-sm font-semibold', report.defense_played ? 'border-warn bg-warn text-black' : 'border-line bg-surface-2 text-muted')}
          >
            Played defense: {report.defense_played ? 'Yes' : 'No'}
          </button>
          {report.defense_played &&
            DEFENSE_TYPES.map((d) => (
              <button
                key={d}
                onClick={() => s.patchReport(active, { defense_type: report.defense_type === d ? null : d })}
                className={cx('tap rounded-xl border px-3 text-sm', report.defense_type === d ? 'border-warn bg-warn text-black' : 'border-line bg-surface-2 text-muted')}
              >
                {DEFENSE_LABEL[d]}
              </button>
            ))}
        </div>
        {report.defense_played && (
          <div className="mb-3 flex items-center gap-1 text-sm">
            <span className="mr-1 text-muted">Effectiveness</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => s.patchReport(active, { defense_rating: report.defense_rating === n ? null : n })}
                className={cx('h-10 w-10 rounded-lg border font-bold', report.defense_rating === n ? 'border-warn bg-warn text-black' : 'border-line bg-surface-2 text-muted')}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {PROBLEM_FLAGS.map((f) => {
            const on = report.flags.includes(f);
            return (
              <button
                key={f}
                onClick={() => s.patchReport(active, { flags: on ? report.flags.filter((x) => x !== f) : [...report.flags, f as ProblemFlag] })}
                className={cx('tap rounded-xl border px-3 text-sm font-semibold', on ? 'border-bad bg-bad text-white' : 'border-line bg-surface-2 text-muted')}
              >
                {FLAG_LABEL[f]}
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Mechanism report">
        <div className="space-y-2">
          {MECHANISMS.map((m: Mechanism) => {
            const cur = report.mechanisms[m];
            return (
              <div key={m} className="rounded-xl bg-surface-2 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{MECHANISM_LABEL[m]}</span>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {MECH_STATUSES.map((st) => (
                    <button
                      key={st}
                      onClick={() => {
                        const next = { ...report.mechanisms };
                        if (cur?.status === st) delete next[m];
                        else next[m] = cur?.note ? { status: st, note: cur.note } : { status: st };
                        s.patchReport(active, { mechanisms: next });
                      }}
                      className={cx('h-10 rounded-lg border text-xs font-semibold', cur?.status === st ? STATUS_TONE[st] : 'border-line bg-surface text-muted')}
                    >
                      {STATUS_LABEL[st]}
                    </button>
                  ))}
                </div>
                {cur && cur.status !== 'not_used' && cur.status !== 'worked' && (
                  <input
                    className="mt-1 h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm"
                    placeholder="one-line note"
                    value={cur.note ?? ''}
                    onChange={(e) => s.patchReport(active, { mechanisms: { ...report.mechanisms, [m]: { status: cur.status, note: e.target.value } } })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {teams.length > 1 && <RelativeRanks s={s} />}

      <div className="safe-bottom sticky bottom-20 z-10 lg:bottom-4">
        {!allViewed && (
          <p className="mb-2 flex items-center gap-1 rounded-xl bg-surface-2 p-2 text-sm text-muted">
            <Lock size={14} /> Open every robot&apos;s tab to unlock Submit.
          </p>
        )}
        <Button variant="primary" size="lg" className="h-16 w-full text-xl" disabled={!allViewed} onClick={onSubmit} data-testid="submit">
          {resubmit ? 'Save changes' : 'Submit'}
        </Button>
      </div>
    </div>
  );
}

function RelativeRanks({ s }: { s: Session }) {
  const b = s.bundle as ScoutingBundle;
  const cats = [
    { key: 'rank_quickness' as const, label: 'Driver quickness' },
    { key: 'rank_awareness' as const, label: 'Field awareness' },
    { key: 'rank_defense_resistance' as const, label: 'Defense resistance' },
  ];
  const orderFor = (k: (typeof cats)[number]['key']) =>
    [...b.reports].sort((a, z) => (a[k] ?? 99) - (z[k] ?? 99) || b.submission.teams.indexOf(a.team_id) - b.submission.teams.indexOf(z.team_id)).map((r) => r.team_id);

  // default ranks = current order so every category is always complete
  useEffect(() => {
    for (const c of cats) {
      if (b.reports.some((r) => !r[c.key])) {
        const order = orderFor(c.key);
        order.forEach((t, i) => s.patchReport(t, { [c.key]: i + 1 }));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Rank the robots you watched (drag: best on top)">
      <div className="grid gap-4 sm:grid-cols-3">
        {cats.map((c) => (
          <div key={c.key}>
            <div className="mb-1 text-sm font-medium">{c.label}</div>
            <SortableList
              items={orderFor(c.key).map((t, i) => ({
                id: t,
                content: (
                  <span className="flex items-center gap-2">
                    <Badge tone={i === 0 ? 'saxon' : 'neutral'}>{i + 1}</Badge>
                    <b className="tnum">{displayTeam(t)}</b>
                  </span>
                ),
              }))}
              onReorder={(ids) => ids.forEach((t, i) => s.patchReport(t, { [c.key]: i + 1 }))}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
