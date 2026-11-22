/**
 * Pure scoring helpers. Every number comes from harvestHavoc.config.ts.
 */
import {
  HARVEST_HAVOC as G,
  SHELVES,
  type Piece,
  type Shelf,
  type Target,
} from './harvestHavoc.config';

export type ShelfCounts = Record<Shelf, number>;
export interface PantryCounts {
  carrot: ShelfCounts;
  cake: ShelfCounts;
}
export interface OvenCounts {
  carrot: number;
  cake: number;
}

/**
 * One alliance's official breakdown (per 449's arena data model).
 * Arrays are indexed by driver-station slot (0 = station 1).
 */
export interface AllianceBreakdown {
  taxi: boolean[];
  pantry: PantryCounts;
  oven: OvenCounts;
  park: boolean[];
  haul: { carrot: number[]; cake: number[] };
  /** Fouls COMMITTED by this alliance (their points go to the opponent). */
  fouls: { minor: number; major: number };
  /** Ranking-point flags as reported by the field system (if any). */
  rp?: { stocked: boolean; baked: boolean; dinner: boolean } | null;
  /** Raw slot strings: "1,2,0,0,0" (1 = carrot, 2 = cake, 0 = empty). */
  slots?: { L1?: string | null; L2?: string | null; L3?: string | null; haul?: (string | null)[] } | null;
}

export const emptyShelves = (): ShelfCounts => ({ L1: 0, L2: 0, L3: 0 });
export const emptyPantry = (): PantryCounts => ({ carrot: emptyShelves(), cake: emptyShelves() });

export function emptyBreakdown(): AllianceBreakdown {
  return {
    taxi: [false, false, false],
    pantry: emptyPantry(),
    oven: { carrot: 0, cake: 0 },
    park: [false, false, false],
    haul: { carrot: [0, 0, 0], cake: [0, 0, 0] },
    fouls: { minor: 0, major: 0 },
    rp: null,
    slots: null,
  };
}

/** Points for one piece placed at a target. */
export function piecePoints(piece: Piece, target: Target): number {
  return target === 'oven' ? G.points.oven[piece] : G.points.pantry[piece][target];
}

/**
 * Pieces that COUNT on one shelf after the overflow rule (p.16): a shelf holds
 * 5; if more are scored, the 5 with the LOWEST point values are counted.
 */
export function countedOnShelf(shelf: Shelf, carrots: number, cakes: number): { carrot: number; cake: number } {
  const cap = G.pantry.shelfCapacity;
  const c = Math.max(0, carrots | 0);
  const k = Math.max(0, cakes | 0);
  if (c + k <= cap) return { carrot: c, cake: k };
  const carrotIsCheaper = G.points.pantry.carrot[shelf] <= G.points.pantry.cake[shelf];
  if (carrotIsCheaper) {
    const counted = Math.min(c, cap);
    return { carrot: counted, cake: cap - counted };
  }
  const counted = Math.min(k, cap);
  return { carrot: cap - counted, cake: counted };
}

export function countedPantry(p: PantryCounts): PantryCounts {
  const out = emptyPantry();
  for (const s of SHELVES) {
    const c = countedOnShelf(s, p.carrot[s], p.cake[s]);
    out.carrot[s] = c.carrot;
    out.cake[s] = c.cake;
  }
  return out;
}

export function shelfPoints(shelf: Shelf, carrots: number, cakes: number): number {
  const c = countedOnShelf(shelf, carrots, cakes);
  return c.carrot * G.points.pantry.carrot[shelf] + c.cake * G.points.pantry.cake[shelf];
}

export function pantryPoints(p: PantryCounts): { total: number; carrot: number; cake: number } {
  const counted = countedPantry(p);
  let carrot = 0;
  let cake = 0;
  for (const s of SHELVES) {
    carrot += counted.carrot[s] * G.points.pantry.carrot[s];
    cake += counted.cake[s] * G.points.pantry.cake[s];
  }
  return { total: carrot + cake, carrot, cake };
}

export function ovenPoints(o: OvenCounts): number {
  return o.carrot * G.points.oven.carrot + o.cake * G.points.oven.cake;
}

/**
 * Haul points for one robot. Hauls count only while PARKED, up to 3 pieces.
 * (Holding more than 3 is a G14 foul; if data ever shows it, cakes count first.)
 */
export function robotHaulPoints(parked: boolean, carrots: number, cakes: number): number {
  if (G.haul.requiresPark && !parked) return 0;
  const max = G.haul.maxPiecesPerRobot;
  const k = Math.min(Math.max(0, cakes), max);
  const c = Math.min(Math.max(0, carrots), max - k);
  return k * G.points.haul.cake + c * G.points.haul.carrot;
}

export function foulPointsFor(opponentFouls: { minor: number; major: number }): number {
  return opponentFouls.minor * G.points.foul.minor + opponentFouls.major * G.points.foul.major;
}

export interface AllianceScore {
  total: number;
  taxi: number;
  pantry: number;
  pantryCarrot: number;
  pantryCake: number;
  oven: number;
  park: number;
  haul: number;
  endgame: number;
  /** Points AWARDED to this alliance from the opponent's fouls. */
  fouls: number;
}

/** Full alliance score from its breakdown + the opponent's committed fouls. */
export function allianceScore(b: AllianceBreakdown, opponentFouls: { minor: number; major: number }): AllianceScore {
  const taxi = b.taxi.filter(Boolean).length * G.points.taxi;
  const p = pantryPoints(b.pantry);
  const oven = ovenPoints(b.oven);
  const park = b.park.filter(Boolean).length * G.points.park;
  let haul = 0;
  for (let i = 0; i < b.park.length; i++) haul += robotHaulPoints(!!b.park[i], b.haul.carrot[i] ?? 0, b.haul.cake[i] ?? 0);
  const fouls = foulPointsFor(opponentFouls);
  const endgame = park + haul;
  return {
    total: taxi + p.total + oven + endgame + fouls,
    taxi,
    pantry: p.total,
    pantryCarrot: p.carrot,
    pantryCake: p.cake,
    oven,
    park,
    haul,
    endgame,
    fouls,
  };
}

export interface RpFlags {
  stocked: boolean;
  baked: boolean;
  dinner: boolean;
}

/** Bonus-RP flags computed from the breakdown (counted pieces only). */
export function computeRpFlags(b: AllianceBreakdown): RpFlags {
  const counted = countedPantry(b.pantry);
  const stocked = SHELVES.every((s) => counted.carrot[s] + counted.cake[s] >= G.rankingPoints.stockedUp.minPiecesPerShelf);
  const baked = SHELVES.every((s) => counted.cake[s] >= G.rankingPoints.bakedUp.minCakesPerShelf);
  const score = allianceScore(b, { minor: 0, major: 0 });
  const dinner = score.endgame >= G.rankingPoints.dinner.minEndgamePoints;
  return { stocked, baked, dinner };
}

export type Outcome = 'win' | 'tie' | 'loss';

export function outcomeFor(myScore: number, oppScore: number): Outcome {
  if (myScore > oppScore) return 'win';
  if (myScore < oppScore) return 'loss';
  return 'tie';
}

/** RP earned by one alliance in a qualification match. */
export function rankingPointsFor(outcome: Outcome, flags: RpFlags): number {
  const rp = G.rankingPoints;
  const base = outcome === 'win' ? rp.win : outcome === 'tie' ? rp.tie : rp.loss;
  return (
    base +
    (flags.stocked ? rp.stockedUp.value : 0) +
    (flags.baked ? rp.bakedUp.value : 0) +
    (flags.dinner ? rp.dinner.value : 0)
  );
}

/** Parse a slot string like "1,2,0,0,0" into pieces (null = empty). */
export function parseSlots(s: string | null | undefined): (Piece | null)[] {
  if (!s) return [];
  return String(s)
    .split(',')
    .map((x) => x.trim())
    .map((x) => (x === '1' ? 'carrot' : x === '2' ? 'cake' : null));
}

/** Playoff tiebreak comparison (p.37–38). Positive = red wins. 0 = replay. */
export function playoffTiebreak(
  red: { majorFouls: number; pantry: number; oven: number },
  blue: { majorFouls: number; pantry: number; oven: number },
): number {
  if (red.majorFouls !== blue.majorFouls) return blue.majorFouls - red.majorFouls; // fewer majors wins
  if (red.pantry !== blue.pantry) return red.pantry - blue.pantry;
  if (red.oven !== blue.oven) return red.oven - blue.oven;
  return 0;
}
