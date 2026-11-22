'use client';
import type { EventPrediction } from '@/selection/eventSim';
import { displayTeam } from '@/lib/teamIds';
import { cx, pct } from '@/components/ui';
import { TeamAvatar, usePhotoMap } from '@/components/TeamChip';
import type { Selection } from './useSelection';

/** One screen for the person at the field: top 3 available, next decision. Big text, live. */
export function QuickCard({ s, pred }: { s: Selection; pred: EventPrediction | null }) {
  const photos = usePhotoMap();
  const d = s.draft;
  const ours = s.ours;
  const ourNo = ours?.number ?? null;
  const ourAlliance = ourNo ? d.alliances[ourNo - 1] : null;
  const round: 1 | 2 = ourAlliance && ourAlliance.picks[0] ? 2 : 1;
  const free = (t: string) => !d.onAlliance.has(t) && !d.declined.has(t) && t !== s.pickingAs;
  // our own list first, pick-score order as a fallback
  const tierOrder = s.entries
    .filter((e) => e.tier === (round === 1 ? 'first' : 'second'))
    .sort((a, b) => a.position - b.position)
    .map((e) => e.team_id)
    .filter(free);
  const dnp = new Set(s.entries.filter((e) => e.tier === 'dnp').map((e) => e.team_id));
  const scoreOrder = (round === 1 ? s.first : s.second).map((r) => r.team).filter((t) => free(t) && !dnp.has(t) && !tierOrder.includes(t));
  const top3 = [...tierOrder, ...scoreOrder].slice(0, 3);

  let decision: string;
  if (d.done) decision = 'Selection complete';
  else if (!ours || (ours.role !== 'captain' && ourAlliance?.captain !== s.pickingAs)) decision = ours ? `We're on Alliance ${ours.number} — captain decides` : `${displayTeam(s.pickingAs)} is not a captain — be ready to accept/decline`;
  else if (d.turn?.alliance === ourNo) decision = `OUR PICK NOW (round ${d.turn.round})`;
  else {
    // count picks until our next turn
    const order: { r: number; a: number }[] = [];
    for (let a = 1; a <= d.allianceCount; a++) order.push({ r: 1, a });
    for (let a = d.allianceCount; a >= 1; a--) order.push({ r: 2, a });
    const cur = order.findIndex((x) => x.r === d.turn?.round && x.a === d.turn?.alliance);
    const next = order.findIndex((x, i) => i > cur && x.a === ourNo);
    decision = next > 0 ? `We pick in ${next - cur} pick${next - cur === 1 ? '' : 's'} (round ${order[next].r})` : 'Waiting';
  }
  const avail = round === 1 ? pred?.avail1[s.pickingAs] : pred?.avail2[s.pickingAs];

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="quick-card">
      <div className={cx('rounded-3xl p-5 text-center', d.turn?.alliance === ourNo ? 'bg-saxon text-saxon-ink' : 'bg-surface')}>
        <div className="text-sm font-semibold uppercase opacity-80">Picking as {displayTeam(s.pickingAs)}</div>
        <div className="text-3xl font-black sm:text-5xl">{decision}</div>
      </div>
      <div className="grid gap-3">
        {top3.map((t, i) => (
          <div key={t} className="flex items-center gap-4 rounded-3xl border-2 border-line bg-surface p-4">
            <span className="text-5xl font-black text-saxon">{i + 1}</span>
            <TeamAvatar team={t} url={photos.get(t)} size={72} />
            <div className="min-w-0 flex-1">
              <div className="text-5xl font-black tnum">{displayTeam(t)}</div>
              <div className="truncate text-lg text-muted">{s.model?.teams.get(t)?.name}</div>
            </div>
            {avail?.[t] !== undefined && <div className="text-right text-sm text-muted">{pct(avail[t])} there at our pick</div>}
          </div>
        ))}
        {!top3.length && <p className="text-center text-2xl text-muted">No one left on the list.</p>}
      </div>
    </div>
  );
}
