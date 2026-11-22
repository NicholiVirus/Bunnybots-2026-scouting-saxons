'use client';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Trophy } from 'lucide-react';
import { OUR_TEAMS } from '@/config/event';
import { HARVEST_HAVOC as G } from '@/game/harvestHavoc.config';
import { buildPools } from '@/analytics/strength';
import { simulateAlliance } from '@/analytics/allianceSim';
import { synergy } from '@/analytics/synergy';
import { DEFAULT_SETTINGS } from '@/config/defaults';
import { completeDraft, type BracketPrediction, type SimInputs } from '@/selection/eventSim';
import { stepDraft } from '@/selection/draft';
import { runSim } from '@/selection/useSim';
import { mulberry32, seedFrom } from '@/lib/rng';
import { displayTeam } from '@/lib/teamIds';
import { Badge, Button, Card, Spinner, Stat, cx, fmt, pct } from '@/components/ui';
import type { Selection } from './useSelection';

export function Simulator({ s, inputs }: { s: Selection; inputs: SimInputs | null }) {
  const defaults = useMemo(() => {
    const avail = s.first.filter((r) => !s.draft.onAlliance.has(r.team) && !s.draft.declined.has(r.team)).map((r) => r.team);
    return [s.pickingAs, ...s.partners, ...avail].filter((t, i, a) => a.indexOf(t) === i).slice(0, 3);
  }, [s.pickingAs, s.partners, s.first, s.draft]);
  const [picked, setPicked] = useState<string[]>(defaults);
  useEffect(() => setPicked(defaults), [defaults.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [bracket, setBracket] = useState<BracketPrediction | null>(null);
  const [busy, setBusy] = useState(false);

  const sim = useMemo(() => {
    if (!s.model || picked.length === 0) return null;
    const pools = buildPools(s.model);
    return simulateAlliance(picked.map(pools), DEFAULT_SETTINGS.simRuns, mulberry32(seedFrom(`simtab:${picked.join()}`)));
  }, [s.model, picked]);
  const syn = useMemo(() => (sim && s.model ? synergy(picked.map((t) => s.model!.teams.get(t)), sim) : null), [sim, s.model, picked]);

  const other = OUR_TEAMS.find((t) => t !== s.pickingAs);
  const choose = (i: number, team: string) => setPicked((p) => Object.assign([...p], { [i]: team }).filter(Boolean));

  const runBracket = async () => {
    if (!inputs) return;
    setBusy(true);
    try {
      // Seat the simulated trio as ONE alliance: at the seed of whichever member is a
      // (projected) captain; with no captain among them, at the last seed. Then project
      // the rest of selection (captains pick by score) and play the bracket.
      const trio = picked.filter(Boolean);
      const byRank = [...trio].sort((a, b) => s.ranked.indexOf(a) - s.ranked.indexOf(b));
      const led = s.draft.alliances.find((a) => a.captain && trio.includes(a.captain));
      const seat = led?.number ?? s.draft.alliances.filter((a) => a.captain).length;
      let state = s.draft;
      if (!led) state = stepDraft(state, { action: 'captain', alliance: seat, team_id: byRank[0] });
      const cap = state.alliances[seat - 1].captain;
      for (const t of byRank) {
        if (t === cap || state.alliances[seat - 1].picks.includes(t) || state.alliances[seat - 1].picks.every(Boolean)) continue;
        state = stepDraft(state, { action: 'pick', alliance: seat, team_id: t });
      }
      const final = completeDraft(state, { ...inputs, noise: 0 }, mulberry32(7));
      const formed = final.alliances.filter((a) => a.captain).map((a) => ({ number: a.number, teams: [a.captain!, ...a.picks.filter(Boolean)] as string[] }));
      setBracket(await runSim('predictBracket', formed, inputs, DEFAULT_SETTINGS.simRuns, 99));
    } finally {
      setBusy(false);
    }
  };

  const options = s.ranked;
  return (
    <div className="space-y-4">
      <Card title="Capped alliance simulator">
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <select key={i} className="h-12 rounded-xl border border-line bg-surface-2 px-2 font-bold" value={picked[i] ?? ''} onChange={(e) => choose(i, e.target.value)} aria-label={`Robot ${i + 1}`}>
              <option value="">— robot {i + 1} —</option>
              {options.map((t) => (
                <option key={t} value={t}>
                  {displayTeam(t)} {s.model?.teams.get(t)?.name ?? ''}
                </option>
              ))}
            </select>
          ))}
        </div>
        {other && picked[0] === s.pickingAs && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setPicked([s.pickingAs, other, picked[2] ?? defaults[2]].filter(Boolean))}>
              Pick our other robot ({other})
            </Button>
            <Button size="sm" onClick={() => setPicked(defaults)}>
              Pick the best available
            </Button>
          </div>
        )}
        {sim && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Expected score" value={fmt(sim.mean, 0)} sub={`p10–p90 ${fmt(sim.p10, 0)}–${fmt(sim.p90, 0)}`} n={sim.n} />
              <Stat label="Pantry" value={fmt(sim.pantry, 0)} />
              <Stat label="Oven" value={fmt(sim.oven, 0)} />
              <Stat label="Endgame" value={fmt(sim.endgame, 1)} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-surface-2 p-2">
                Stocked <b className="block text-lg">{pct(sim.rp.stocked)}</b>
              </div>
              <div className="rounded-xl bg-surface-2 p-2">
                Baked <b className="block text-lg">{pct(sim.rp.baked)}</b>
              </div>
              <div className="rounded-xl bg-surface-2 p-2">
                Dinner <b className="block text-lg">{pct(sim.rp.dinner)}</b>
              </div>
            </div>
          </>
        )}
        {syn && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {syn.roles.map((r) => (
                <Badge key={r.team} tone="saxon">
                  {displayTeam(r.team)}: {r.label}
                </Badge>
              ))}
            </div>
            {syn.warnings.length === 0 ? (
              <p className="text-sm text-good">No synergy problems found.</p>
            ) : (
              <ul className="space-y-1">
                {syn.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 text-sm text-warn">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Uses the real limits: {G.pantry.shelfCapacity} pieces per shelf (extras cascade down), cakes only from the oven trade ({G.cakeEconomy.ovenCarrotsPerCake} carrots → 1 cake, max{' '}
          {G.supply.tradeableCakesPerAlliance} + {G.supply.prestagedCakesPerAlliance} prestaged), hauls ≤{G.haul.maxPiecesPerRobot} when parked.
        </p>
      </Card>

      <Card
        title="Head-to-head + playoff bracket"
        actions={
          <Button size="sm" variant="primary" onClick={() => void runBracket()} disabled={!inputs || busy}>
            {busy ? <Spinner /> : <Trophy size={16} />} Simulate playoffs
          </Button>
        }
      >
        {!bracket ? (
          <p className="text-sm text-muted">Projects the rest of selection (captains pick by score), puts this trio on our alliance, then plays the double-elim bracket {DEFAULT_SETTINGS.simRuns}×.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="p-1">#</th>
                  <th className="p-1">Alliance</th>
                  <th className="p-1 text-right">Exp. score</th>
                  <th className="p-1 text-right">P(finals)</th>
                  <th className="p-1 text-right">P(win event)</th>
                </tr>
              </thead>
              <tbody>
                {bracket.alliances.map((a) => {
                  const ours = picked.every((t) => !t || a.teams.includes(t));
                  return (
                    <tr key={a.number} className={cx('border-t border-line', ours && 'ours')}>
                      <td className="p-1 font-bold">{a.number}</td>
                      <td className="p-1">{a.teams.map(displayTeam).join(' · ')}</td>
                      <td className="p-1 text-right tnum">{fmt(a.mean, 0)}</td>
                      <td className="p-1 text-right tnum">{pct(a.pFinals)}</td>
                      <td className="p-1 text-right font-bold tnum">{pct(a.pWin)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(() => {
              const i = bracket.alliances.findIndex((a) => picked.every((t) => !t || a.teams.includes(t)));
              if (i < 0) return null;
              return (
                <p className="mt-2 text-xs text-muted">
                  Our head-to-head: {bracket.alliances.map((a, j) => (j === i ? null : `vs A${a.number} ${pct(bracket.h2h[i][j])}`)).filter(Boolean).join(' · ')}
                </p>
              );
            })()}
          </div>
        )}
      </Card>
    </div>
  );
}
