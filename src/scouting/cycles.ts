/**
 * Cycle timing from the event log.
 *
 *  Cycle = time between consecutive SCORING PLACEMENTS (Pantry or Oven) by the
 *  same robot, in teleop. The first cycle starts at teleop start (0:15). The
 *  endgame haul is the last cycle (last placement → robot marked Parked holding
 *  pieces). Placements within `burstWindowMs` of each other with no intake in
 *  between are ONE delivery (robots carry up to 3 pieces); window 0 = literal.
 *  Time while the robot is Died / Browned Out / A-Stopped / E-Stopped is
 *  excluded. Cycles longer than the cap are reported as "long gaps", not stats.
 *  With Intake taps, each cycle splits into pickup (last score → last intake)
 *  and delivery (last intake → score).
 */
import { DISABLING_FLAGS, T_AUTO_END_MS, T_MATCH_END_MS, type Piece, type ProblemFlag, type Target } from '@/game/harvestHavoc.config';
import type { ScoutEvent } from '@/data/types';

export interface CycleOptions {
  burstWindowMs: number;
  outlierCapMs: number;
}

export interface Cycle {
  startMs: number;
  endMs: number;
  /** Duration with disabled time removed. */
  durationMs: number;
  pieces: Piece[];
  targets: (Target | 'haul')[];
  kind: 'placement' | 'haul';
  pickupMs: number | null;
  deliveryMs: number | null;
}

export interface CycleResult {
  cycles: Cycle[];
  longGaps: Cycle[];
  disabledMs: number;
}

/** Intervals during which the robot could not cycle. */
export function disabledIntervals(events: readonly ScoutEvent[], matchEndMs = T_MATCH_END_MS): [number, number][] {
  const sorted = [...events].sort((a, b) => a.t_ms - b.t_ms);
  const out: [number, number][] = [];
  const open: { flag: ProblemFlag; start: number }[] = [];
  for (const e of sorted) {
    if (e.action === 'flag' && e.detail && (DISABLING_FLAGS as readonly string[]).includes(e.detail)) {
      open.push({ flag: e.detail as ProblemFlag, start: e.t_ms });
    } else if (e.action === 'revive' && open.length) {
      const i = e.detail ? open.map((o) => o.flag).lastIndexOf(e.detail as ProblemFlag) : open.length - 1;
      const [o] = open.splice(i >= 0 ? i : open.length - 1, 1);
      out.push([o.start, Math.max(o.start, e.t_ms)]);
    }
  }
  for (const o of open) {
    const end = o.flag === 'a_stop' ? Math.max(o.start, T_AUTO_END_MS) : matchEndMs;
    out.push([o.start, end]);
  }
  // merge overlaps
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  return merged;
}

export function overlapMs(intervals: readonly [number, number][], a: number, b: number): number {
  let s = 0;
  for (const [x, y] of intervals) s += Math.max(0, Math.min(b, y) - Math.max(a, x));
  return s;
}

const PLACEMENT_TARGETS = new Set(['L1', 'L2', 'L3', 'oven']);

export function computeCycles(events: readonly ScoutEvent[], opts: CycleOptions): CycleResult {
  const sorted = [...events].sort((a, b) => a.t_ms - b.t_ms || a.id.localeCompare(b.id));
  const disabled = disabledIntervals(sorted);
  const placements = sorted.filter((e) => e.action === 'score' && e.target && PLACEMENT_TARGETS.has(e.target) && e.phase !== 'auto' && e.t_ms >= T_AUTO_END_MS);
  const breaks = sorted.filter((e) => e.action === 'intake' || e.action === 'drop' || e.action === 'handoff');

  // group placements into trips
  const trips: ScoutEvent[][] = [];
  for (const p of placements) {
    const trip = trips[trips.length - 1];
    const last = trip?.[trip.length - 1];
    const brokeBetween = last ? breaks.some((b) => b.t_ms > last.t_ms && b.t_ms <= p.t_ms) : true;
    if (trip && last && p.t_ms - last.t_ms <= opts.burstWindowMs && !brokeBetween) trip.push(p);
    else trips.push([p]);
  }

  const cycles: Cycle[] = [];
  const longGaps: Cycle[] = [];
  let prevEnd = T_AUTO_END_MS;
  const push = (c: Cycle) => (c.durationMs > opts.outlierCapMs ? longGaps : cycles).push(c);

  for (const trip of trips) {
    const first = trip[0];
    const end = trip[trip.length - 1].t_ms;
    const duration = end - prevEnd - overlapMs(disabled, prevEnd, end);
    const intakes = sorted.filter((e) => e.action === 'intake' && e.t_ms > prevEnd && e.t_ms <= first.t_ms);
    const lastIntake = intakes[intakes.length - 1];
    push({
      startMs: prevEnd,
      endMs: end,
      durationMs: Math.max(0, duration),
      pieces: trip.map((e) => e.piece!).filter(Boolean),
      targets: trip.map((e) => e.target as Target),
      kind: 'placement',
      pickupMs: lastIntake ? Math.max(0, lastIntake.t_ms - prevEnd - overlapMs(disabled, prevEnd, lastIntake.t_ms)) : null,
      deliveryMs: lastIntake ? Math.max(0, first.t_ms - lastIntake.t_ms - overlapMs(disabled, lastIntake.t_ms, first.t_ms)) : null,
    });
    prevEnd = end;
  }

  // endgame haul = final cycle (last placement → parked holding pieces)
  const park = sorted.filter((e) => e.action === 'park').pop();
  const hauls = sorted.filter((e) => e.action === 'haul' && e.piece);
  if (park && hauls.length && park.t_ms > prevEnd) {
    push({
      startMs: prevEnd,
      endMs: park.t_ms,
      durationMs: Math.max(0, park.t_ms - prevEnd - overlapMs(disabled, prevEnd, park.t_ms)),
      pieces: hauls.map((h) => h.piece!),
      targets: hauls.map(() => 'haul'),
      kind: 'haul',
      pickupMs: null,
      deliveryMs: null,
    });
  }

  return { cycles, longGaps, disabledMs: overlapMs(disabled, 0, T_MATCH_END_MS) };
}
