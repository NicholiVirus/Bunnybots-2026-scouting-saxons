/**
 * Event log → totals → points. Every tap is an event; totals are DERIVED, so
 * [ − ] simply deletes the latest matching event (true undo).
 */
import {
  HARVEST_HAVOC as G,
  INTAKE_SOURCES,
  SHELVES,
  type IntakeSource,
  type Phase,
  type Piece,
  type ProblemFlag,
  type Shelf,
  phaseAt,
} from '@/game/harvestHavoc.config';
import { emptyPantry, piecePoints, robotHaulPoints, type OvenCounts, type PantryCounts } from '@/game/scoring';
import type { EventAction, EventTarget, ScoutEvent, TotalsOverride } from '@/data/types';
import { uuid } from '@/lib/util';

export interface RobotTotals {
  auto: { pantry: PantryCounts; oven: OvenCounts; taxi: boolean | null; unknownLevelCarrots: number };
  /** teleop + endgame placements */
  teleop: { pantry: PantryCounts; oven: OvenCounts };
  parked: boolean | null;
  haul: { carrot: number; cake: number };
  intakes: Record<IntakeSource, number>;
  drops: number;
  handoffs: number;
  flags: ProblemFlag[];
}

export const emptyTotals = (): RobotTotals => ({
  auto: { pantry: emptyPantry(), oven: { carrot: 0, cake: 0 }, taxi: null, unknownLevelCarrots: 0 },
  teleop: { pantry: emptyPantry(), oven: { carrot: 0, cake: 0 } },
  parked: null,
  haul: { carrot: 0, cake: 0 },
  intakes: Object.fromEntries(INTAKE_SOURCES.map((s) => [s, 0])) as Record<IntakeSource, number>,
  drops: 0,
  handoffs: 0,
  flags: [],
});

const sortEv = (a: ScoutEvent, b: ScoutEvent) => a.t_ms - b.t_ms || a.id.localeCompare(b.id);

export function totalsFromEvents(events: readonly ScoutEvent[]): RobotTotals {
  const t = emptyTotals();
  t.auto.taxi = false;
  t.parked = false;
  const flags = new Set<ProblemFlag>();
  for (const e of [...events].sort(sortEv)) {
    switch (e.action) {
      case 'score': {
        if (!e.piece || !e.target) break;
        const bucket = e.phase === 'auto' ? t.auto : t.teleop;
        if (e.target === 'oven') bucket.oven[e.piece]++;
        else if (e.target !== 'haul') bucket.pantry[e.piece][e.target as Shelf]++;
        break;
      }
      case 'taxi':
        t.auto.taxi = true;
        break;
      case 'park':
        t.parked = true;
        break;
      case 'haul':
        if (e.piece) t.haul[e.piece]++;
        break;
      case 'intake':
        if (e.detail && (INTAKE_SOURCES as readonly string[]).includes(e.detail)) t.intakes[e.detail as IntakeSource]++;
        break;
      case 'drop':
        t.drops++;
        break;
      case 'handoff':
        t.handoffs++;
        break;
      case 'flag':
        if (e.detail) flags.add(e.detail as ProblemFlag);
        break;
      default:
        break;
    }
  }
  // haul is capped at 3 pieces combined (G14 / Harvest Haul rule)
  const over = t.haul.carrot + t.haul.cake - G.haul.maxPiecesPerRobot;
  if (over > 0) t.haul.carrot = Math.max(0, t.haul.carrot - over);
  t.flags = [...flags];
  return t;
}

/** 449 QRScout imports: totals only (auto pantry has no level → counted as unknown). */
export function totalsFromOverride(o: TotalsOverride): RobotTotals {
  const t = emptyTotals();
  t.auto.unknownLevelCarrots = o.auto.pantryCarrotUnknownLevel;
  t.auto.oven.carrot = o.auto.ovenCarrot;
  t.auto.taxi = o.taxi;
  for (const s of SHELVES) {
    t.teleop.pantry.carrot[s] = o.teleop.carrot[s] ?? 0;
    t.teleop.pantry.cake[s] = o.teleop.cake[s] ?? 0;
  }
  t.teleop.oven = { carrot: o.teleop.ovenCarrot, cake: o.teleop.ovenCake };
  t.parked = o.parked;
  t.haul = { carrot: o.haul.carrot, cake: o.haul.cake };
  for (const [k, v] of Object.entries(o.intake)) if (v) t.intakes[k as IntakeSource] = v;
  return t;
}

/** Auto carrots with no level (QRScout "autoPantry") are valued at L2 — 449's own convention. */
export const UNKNOWN_LEVEL_ASSUMED: Shelf = 'L2';

export interface RobotPoints {
  auto: number;
  teleop: number;
  endgame: number;
  total: number;
  pantryCarrot: number;
  pantryCake: number;
  oven: number;
  taxi: number;
  park: number;
  haul: number;
}

/** Per-robot points (no alliance shelf cap — that's an alliance-level effect). */
export function robotPoints(t: RobotTotals): RobotPoints {
  let pantryCarrot = 0;
  let pantryCake = 0;
  let autoPts = 0;
  for (const s of SHELVES) {
    const ac = t.auto.pantry.carrot[s] * piecePoints('carrot', s);
    const ak = t.auto.pantry.cake[s] * piecePoints('cake', s);
    const tc = t.teleop.pantry.carrot[s] * piecePoints('carrot', s);
    const tk = t.teleop.pantry.cake[s] * piecePoints('cake', s);
    pantryCarrot += ac + tc;
    pantryCake += ak + tk;
    autoPts += ac + ak;
  }
  const unknown = t.auto.unknownLevelCarrots * piecePoints('carrot', UNKNOWN_LEVEL_ASSUMED);
  pantryCarrot += unknown;
  autoPts += unknown;
  const autoOven = t.auto.oven.carrot * piecePoints('carrot', 'oven') + t.auto.oven.cake * piecePoints('cake', 'oven');
  const teleOven = t.teleop.oven.carrot * piecePoints('carrot', 'oven') + t.teleop.oven.cake * piecePoints('cake', 'oven');
  const taxi = t.auto.taxi ? G.points.taxi : 0;
  autoPts += autoOven + taxi;
  const park = t.parked ? G.points.park : 0;
  const haul = robotHaulPoints(!!t.parked, t.haul.carrot, t.haul.cake);
  const teleop = pantryCarrot + pantryCake - (autoPts - autoOven - taxi) + teleOven;
  const endgame = park + haul;
  return {
    auto: autoPts,
    teleop,
    endgame,
    total: autoPts + teleop + endgame,
    pantryCarrot,
    pantryCake,
    oven: autoOven + teleOven,
    taxi,
    park,
    haul,
  };
}

export function placedPieces(t: RobotTotals): { carrot: number; cake: number; byShelf: Record<Shelf, number> } {
  let carrot = t.auto.unknownLevelCarrots;
  let cake = 0;
  const byShelf: Record<Shelf, number> = { L1: 0, L2: 0, L3: 0 };
  for (const s of SHELVES) {
    const c = t.auto.pantry.carrot[s] + t.teleop.pantry.carrot[s];
    const k = t.auto.pantry.cake[s] + t.teleop.pantry.cake[s];
    carrot += c;
    cake += k;
    byShelf[s] = c + k;
  }
  return { carrot, cake, byShelf };
}

// ── Event-log editing (used by the live scouting screen) ────────────────────

export interface NewEvent {
  team_id: string;
  action: EventAction;
  piece?: Piece | null;
  target?: EventTarget | null;
  detail?: string | null;
}

export function makeEvent(submissionId: string, tMs: number, phaseOverride: Phase | null, e: NewEvent): ScoutEvent {
  const t = Math.max(0, Math.round(tMs));
  return {
    id: uuid(),
    submission_id: submissionId,
    team_id: e.team_id,
    t_ms: t,
    phase: phaseOverride ?? phaseAt(t),
    action: e.action,
    piece: e.piece ?? null,
    target: e.target ?? null,
    detail: e.detail ?? null,
  };
}

/** [ − ]: remove that robot's MOST RECENT matching event (true undo). */
export function removeLatest(events: readonly ScoutEvent[], match: Partial<Pick<ScoutEvent, 'team_id' | 'action' | 'piece' | 'target' | 'detail' | 'phase'>>): ScoutEvent[] {
  let idx = -1;
  let best = -Infinity;
  events.forEach((e, i) => {
    const ok = (Object.keys(match) as (keyof typeof match)[]).every((k) => match[k] === undefined || e[k] === match[k]);
    if (ok && (e.t_ms > best || (e.t_ms === best && i > idx))) {
      best = e.t_ms;
      idx = i;
    }
  });
  if (idx < 0) return [...events];
  return events.filter((_, i) => i !== idx);
}

export function countMatching(events: readonly ScoutEvent[], match: Partial<ScoutEvent>): number {
  return events.filter((e) => (Object.keys(match) as (keyof ScoutEvent)[]).every((k) => match[k] === undefined || e[k] === match[k])).length;
}
