'use client';
import { useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { OUR_TEAMS, isOurTeam } from '@/config/event';
import { HARVEST_HAVOC as G } from '@/game/harvestHavoc.config';
import { remainingMatchesFor } from '@/analytics/schedule';
import { forecastMatch } from '@/analytics/predict';
import type { AcceptDeclineResult, EventPrediction, SimInputs } from '@/selection/eventSim';
import { runSim } from '@/selection/useSim';
import { teamRecords } from '@/analytics/rankings';
import { displayTeam } from '@/lib/teamIds';
import { Badge, Button, Card, Spinner, cx, fmt, pct } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import type { Selection } from './useSelection';

export function Predictor({ s, pred, busy }: { s: Selection; pred: EventPrediction | null; busy: boolean }) {
  const photos = usePhotoMap();
  const recs = useMemo(() => teamRecords(s.matches), [s.matches]);
  if (!pred)
    return (
      <div className="flex items-center gap-2 py-6 text-muted">
        <Spinner /> Simulating the rest of the event…
      </div>
    );
  const N = s.settings.allianceCount;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {[...new Set([...OUR_TEAMS, s.pickingAs])].map((t) => {
          const dist = pred.seedDist[t] ?? [];
          const best = dist.map((p, i) => [p, i + 1] as const).sort((a, b) => b[0] - a[0])[0];
          const rec = recs.get(t);
          const remaining = remainingMatchesFor(t, s.matches);
          const avg = rec?.played ? rec.rp / rec.played : 0;
          const totalPlayed = (rec?.played ?? 0) + remaining.length;
          const need = Number.isFinite(pred.captainThreshold) && totalPlayed ? Math.max(0, pred.captainThreshold * totalPlayed - (rec?.rp ?? 0)) : null;
          return (
            <Card key={t} className={cx(isOurTeam(t) && 'ours')}>
              <div className="flex items-center justify-between">
                <TeamChip team={t} photo={photos.get(t)} size={36} showName />
                <Badge tone="saxon">P(captain) {pct(pred.pCaptain[t])}</Badge>
              </div>
              <div className="mt-2 text-sm">
                Predicted rank <b>{fmt(pred.rankMean[t], 1)}</b> (80% range {pred.rankRange[t]?.[0]}–{pred.rankRange[t]?.[1]}) · now {fmt(avg, 2)} avg RP
              </div>
              {best && best[0] >= 0.05 ? (
                <div className="mt-1 text-sm font-semibold text-saxon">
                  {pct(best[0])}: captain of Alliance {best[1]} — we pick {ordinal(best[1])}
                </div>
              ) : (
                <div className="mt-1 text-sm text-muted">Unlikely to be a captain — prepare to be picked (see Accept / decline).</div>
              )}
              <div className="mt-2 flex h-6 overflow-hidden rounded-lg bg-surface-2 text-[10px]">
                {dist.map((p, i) => (
                  <div key={i} className="flex items-center justify-center border-r border-bg bg-saxon/80 text-saxon-ink" style={{ width: `${p * 100}%` }} title={`Alliance ${i + 1}: ${pct(p)}`}>
                    {p > 0.08 ? i + 1 : ''}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs text-muted">
                {remaining.length} qual match{remaining.length === 1 ? '' : 'es'} left: {remaining.map((m) => m.label).join(', ') || '—'}
                {need !== null && remaining.length > 0 && (
                  <>
                    {' '}
                    · needs ≈ <b className="text-fg">{fmt(need, 0)} more RP</b> (≈{fmt(need / remaining.length, 1)}/match of max {G.rankingPoints.win + 3}) to reach the top {N}
                  </>
                )}
              </div>
              {remaining.length > 0 && s.model && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {remaining.slice(0, 6).map((m) => {
                    const f = forecastMatch(m, s.model!, 300);
                    const side = m.red.includes(t) ? 'red' : 'blue';
                    const p = side === 'red' ? f.pRed : 1 - f.pRed;
                    return (
                      <li key={m.key}>
                        {m.label} ({side}) win {pct(p)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <Card title={`Predicted captains by seed (top ${N})`} actions={busy ? <Spinner /> : <span className="text-xs text-muted">{pred.runs} sims · {pred.ms} ms</span>}>
        <ol className="grid gap-1 sm:grid-cols-2">
          {pred.predictedCaptains.map((t, i) => (
            <li key={t} className={cx('flex items-center gap-2 rounded-lg px-2 py-1', isOurTeam(t) && 'ours')}>
              <span className="w-6 font-black">{i + 1}</span>
              <TeamChip team={t} photo={photos.get(t)} size={24} />
              <span className="ml-auto text-xs tnum">{pct(pred.pCaptain[t])}</span>
            </li>
          ))}
        </ol>
        {Number.isFinite(pred.captainThreshold) && (
          <p className="mt-2 text-xs text-muted">The #{N} seed typically finishes at ≈{fmt(pred.captainThreshold, 2)} avg RP.</p>
        )}
      </Card>

      <Card title="Final rank ranges (80%)">
        <ol className="space-y-0.5 text-sm">
          {pred.expectedRanking.map((t, i) => (
            <li key={t} className={cx('flex items-center gap-2 rounded px-1', isOurTeam(t) && 'ours')}>
              <span className="w-6 text-xs text-muted">{i + 1}</span>
              <span className="w-14 font-bold tnum">{displayTeam(t)}</span>
              <div className="relative h-3 flex-1 rounded bg-surface-2">
                <div
                  className="absolute h-3 rounded bg-saxon/70"
                  style={{
                    left: `${((pred.rankRange[t][0] - 1) / pred.expectedRanking.length) * 100}%`,
                    width: `${Math.max(2, ((pred.rankRange[t][1] - pred.rankRange[t][0] + 1) / pred.expectedRanking.length) * 100)}%`,
                  }}
                />
              </div>
              <span className="w-14 text-right text-xs tnum">
                {pred.rankRange[t][0]}–{pred.rankRange[t][1]}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

export function AcceptDecline({ s, inputs }: { s: Selection; inputs: SimInputs | null }) {
  const formed = s.draft.alliances.filter((a) => a.captain && a.captain !== s.pickingAs);
  const [inviting, setInviting] = useState<number>(s.draft.turn?.alliance ?? formed[0]?.number ?? 1);
  const [our, setOur] = useState<string>((OUR_TEAMS as readonly string[]).includes(s.pickingAs) ? s.pickingAs : OUR_TEAMS[0]);
  const [res, setRes] = useState<AcceptDeclineResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!inputs) return;
    setBusy(true);
    try {
      setRes(await runSim('acceptOrDecline', { ...inputs, remaining: [], rankedNow: s.ranked }, s.ranked, our, inviting, { drafts: 40, bracketRuns: 400, seed: 21 }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Accept / decline helper">
      <p className="mb-3 text-sm text-muted">
        A team that declines can&apos;t be picked later, but can still captain if its rank comes up. This compares the two futures by simulated P(win event).
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Invited robot
          <select className="mt-1 block h-12 rounded-xl border border-line bg-surface-2 px-2 font-bold" value={our} onChange={(e) => setOur(e.target.value)}>
            {[...new Set([...OUR_TEAMS, s.pickingAs])].map((t) => (
              <option key={t} value={t}>
                {displayTeam(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Invited by
          <select className="mt-1 block h-12 rounded-xl border border-line bg-surface-2 px-2 font-bold" value={inviting} onChange={(e) => setInviting(Number(e.target.value))}>
            {s.draft.alliances
              .filter((a) => a.captain)
              .map((a) => (
                <option key={a.number} value={a.number}>
                  Alliance {a.number} ({displayTeam(a.captain)})
                </option>
              ))}
          </select>
        </label>
        <Button variant="primary" size="lg" onClick={() => void run()} disabled={busy || !inputs}>
          {busy ? <Spinner /> : <HelpCircle size={18} />} Should we accept?
        </Button>
      </div>
      {res && (
        <div className="mt-4 rounded-2xl border-2 p-4 text-center" style={{ borderColor: res.verdict === 'accept' ? 'var(--good)' : res.verdict === 'decline' ? 'var(--bad)' : 'var(--warn)' }} data-testid="verdict">
          <div className="text-3xl font-black">{res.verdict === 'accept' ? 'ACCEPT' : res.verdict === 'decline' ? 'DECLINE' : 'TOO CLOSE TO CALL'}</div>
          <ul className="mt-2 space-y-1 text-left text-sm">
            {res.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
