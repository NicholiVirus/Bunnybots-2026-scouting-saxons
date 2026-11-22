'use client';
import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { OUR_TEAMS } from '@/config/event';
import type { PickWeights } from '@/data/types';
import { WEIGHT_LABEL, DEFAULT_WEIGHTS, type PickPreset, type PickRow, type StatMode } from '@/analytics/pickScore';
import { completeDraft, type EventPrediction } from '@/selection/eventSim';
import { mulberry32 } from '@/lib/rng';
import { displayTeam } from '@/lib/teamIds';
import { Badge, Button, Card, Modal, Segmented, Spinner, cx, fmt, pct } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import type { Selection } from './useSelection';

export function Suggestions({ s, pred, busy, mode, setMode }: { s: Selection; pred: EventPrediction | null; busy: boolean; mode: StatMode; setMode: (m: StatMode) => void }) {
  const [weightsFor, setWeightsFor] = useState<PickPreset | null>(null);
  const photos = usePhotoMap();
  const dnp = new Set(s.entries.filter((e) => e.tier === 'dnp').map((e) => e.team_id));
  const gone = (t: string) => s.draft.onAlliance.has(t) || s.draft.declined.has(t);

  // Two-robot program: when BOTH 611 and 526 are (projected) captains, hide the teams the
  // other one is projected to take (deterministic draft completion by pick score).
  const hiddenFor = useMemo(() => {
    const other = OUR_TEAMS.find((t) => t !== s.pickingAs);
    if (!other || !OUR_TEAMS.includes(s.pickingAs as '611')) return new Map<string, string>();
    const a1 = s.draft.alliances.find((a) => a.captain === s.pickingAs);
    const a2 = s.draft.alliances.find((a) => a.captain === other);
    if (!a1 || !a2 || s.draft.done) return new Map<string, string>();
    const final = completeDraft(
      s.draft,
      { pickValue1: Object.fromEntries(s.first.map((r) => [r.team, r.score])), pickValue2: Object.fromEntries(s.second.map((r) => [r.team, r.score])), guesses: s.meta?.captain_guesses ?? {}, noise: 0 },
      mulberry32(1),
    );
    const theirs = final.alliances[a2.number - 1].picks.filter(Boolean) as string[];
    return new Map(theirs.map((t) => [t, other]));
  }, [s.draft, s.pickingAs, s.first, s.second, s.meta?.captain_guesses]);

  const focus = s.pickingAs;
  const a1 = pred?.avail1[focus] ?? {};
  const a2 = pred?.avail2[focus] ?? {};
  const nextBest = pred?.nextBest[focus] ?? 0;

  const list = (rows: PickRow[], preset: PickPreset) => (
    <ol className="space-y-1.5">
      {rows
        .filter((r) => !dnp.has(r.team))
        .slice(0, 16)
        .map((r, i) => {
          const taken = gone(r.team);
          const hidden = hiddenFor.get(r.team);
          const avail = preset === 'first' ? a1[r.team] : a2[r.team];
          const vona = r.score - nextBest;
          return (
            <li key={r.team} className={cx('rounded-xl border border-line p-2', taken && 'opacity-40', (OUR_TEAMS as readonly string[]).includes(r.team) && 'ours')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-center font-black tnum">{i + 1}</span>
                <span className={cx(taken && 'line-through')}>
                  <TeamChip team={r.team} photo={photos.get(r.team)} size={24} showName />
                </span>
                {taken && <Badge tone="warn">{s.draft.onAlliance.get(r.team) ? `A${s.draft.onAlliance.get(r.team)}` : 'declined'}</Badge>}
                {hidden && <Badge tone="saxon">projected to {hidden}</Badge>}
                <span className="ml-auto text-right">
                  <span className="text-lg font-black tnum">{fmt(r.score, 0)}</span>
                  <span className="block text-[10px] text-muted">pick score · n={r.n}</span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-xs text-muted">
                {r.reasons.map((x) => (
                  <span key={x}>• {x}</span>
                ))}
                {pred && avail !== undefined && (
                  <span className={cx('font-semibold', avail >= 0.7 ? 'text-good' : avail >= 0.3 ? 'text-warn' : 'text-bad')}>
                    {pct(avail)} still there at our {preset === 'first' ? '1st' : '2nd'} pick
                  </span>
                )}
                {pred && preset === 'first' && nextBest > 0 && (
                  <span title="Value over the best team likely left at our next pick">VONA {vona >= 0 ? '+' : ''}{fmt(vona, 0)}</span>
                )}
              </div>
            </li>
          );
        })}
    </ol>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'avg', label: 'Average' },
            { value: 'recent', label: 'Recent (last 3)' },
            { value: 'max', label: 'Max' },
          ]}
        />
        <span className="flex items-center gap-2 text-xs text-muted">
          {busy && <Spinner />} {pred ? `availability from ${pred.runs} simulated drafts (${pred.ms} ms)` : 'simulating…'}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="1st pick — ceiling & synergy"
          actions={
            s.canEditList && (
              <Button size="sm" variant="ghost" onClick={() => setWeightsFor('first')}>
                <SlidersHorizontal size={16} /> Weights
              </Button>
            )
          }
        >
          {list(s.first, 'first')}
        </Card>
        <Card
          title="2nd pick — floor, reliability, low fouls"
          actions={
            s.canEditList && (
              <Button size="sm" variant="ghost" onClick={() => setWeightsFor('second')}>
                <SlidersHorizontal size={16} /> Weights
              </Button>
            )
          }
        >
          {s.partners.length > 0 && <p className="mb-2 text-xs text-muted">Fit measured with {s.partners.map(displayTeam).join(' + ')} already on our alliance.</p>}
          {list(s.second, 'second')}
        </Card>
      </div>
      <WeightsModal preset={weightsFor} s={s} onClose={() => setWeightsFor(null)} />
    </div>
  );
}

function WeightsModal({ preset, s, onClose }: { preset: PickPreset | null; s: Selection; onClose: () => void }) {
  const current = preset ? s.weights[preset] : DEFAULT_WEIGHTS.first;
  const [w, setW] = useState<PickWeights>(current);
  useEffect(() => setW(current), [preset]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!preset) return null;
  return (
    <Modal open onClose={onClose} title={`${preset === 'first' ? '1st' : '2nd'}-pick weights (${displayTeam(s.pickingAs)})`}>
      <div className="space-y-2">
        {(Object.keys(WEIGHT_LABEL) as (keyof PickWeights)[]).map((k) => (
          <label key={k} className="flex items-center gap-3 text-sm">
            <span className="w-40">{WEIGHT_LABEL[k]}</span>
            <input type="range" min={0} max={50} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="flex-1 accent-[var(--saxon)]" />
            <span className="w-8 text-right tnum">{w[k]}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            await s.saveMeta(preset === 'first' ? { weights_first: w } : { weights_second: w });
            onClose();
          }}
        >
          Save for everyone
        </Button>
        <Button onClick={() => setW(DEFAULT_WEIGHTS[preset])}>Reset to default</Button>
      </div>
    </Modal>
  );
}
