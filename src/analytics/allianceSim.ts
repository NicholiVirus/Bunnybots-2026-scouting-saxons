/**
 * CAPPED alliance simulation — the real Harvest Havoc constraints, not a sum:
 *  - each shelf counts at most 5 pieces; when robots want more, the most valuable
 *    stay and the rest cascade down a shelf (L3 → L2 → L1 → Oven), i.e. two
 *    L3-cake robots fight over the same 5 L3 slots;
 *  - cakes are scarce: 1 prestaged + 1 per 3 OVEN carrots (max 9 traded); oven
 *    cakes recycle. Robots that can't get a cake place a carrot instead
 *    (cheapest cake uses are dropped first);
 *  - hauls ≤ 3 pieces per robot and only count when parked.
 * Robots are sampled from their own past matches (bootstrap), so correlations
 * within a robot's match are preserved. Seeded RNG → reproducible.
 */
import { HARVEST_HAVOC as G, SHELVES, type Piece, type Shelf } from '@/game/harvestHavoc.config';
import { robotHaulPoints, type RpFlags } from '@/game/scoring';
import type { Rng } from '@/lib/rng';
import type { TeamMatchRecord } from '@/scouting/records';

/** What one robot TRIES to do in a match. */
export interface RobotIntent {
  pantry: { carrot: Record<Shelf, number>; cake: Record<Shelf, number> };
  oven: { carrot: number; cake: number };
  taxi: boolean;
  park: boolean;
  haul: { carrot: number; cake: number };
}

export function intentFromRecord(r: TeamMatchRecord): RobotIntent {
  const t = r.totals;
  const rnd = (x: number) => Math.round(x);
  const carrot = Object.fromEntries(SHELVES.map((s) => [s, rnd(t.auto.pantry.carrot[s] + t.teleop.pantry.carrot[s] + (s === 'L2' ? t.auto.unknownLevelCarrots : 0))])) as Record<Shelf, number>;
  const cake = Object.fromEntries(SHELVES.map((s) => [s, rnd(t.auto.pantry.cake[s] + t.teleop.pantry.cake[s])])) as Record<Shelf, number>;
  return {
    pantry: { carrot, cake },
    oven: { carrot: rnd(t.auto.oven.carrot + t.teleop.oven.carrot), cake: rnd(t.auto.oven.cake + t.teleop.oven.cake) },
    taxi: !!t.auto.taxi,
    park: !!t.parked,
    haul: { carrot: rnd(t.haul.carrot), cake: rnd(t.haul.cake) },
  };
}

export const emptyIntent = (): RobotIntent => ({
  pantry: { carrot: { L1: 0, L2: 0, L3: 0 }, cake: { L1: 0, L2: 0, L3: 0 } },
  oven: { carrot: 0, cake: 0 },
  taxi: false,
  park: false,
  haul: { carrot: 0, cake: 0 },
});

export interface AllianceResult {
  total: number;
  pantry: number;
  oven: number;
  taxi: number;
  park: number;
  haul: number;
  endgame: number;
  rp: RpFlags;
  /** Pieces that had to move down a shelf (or to the Oven) because of the 5/shelf cap. */
  overflow: number;
  /** Cake placements that couldn't happen for lack of cakes. */
  cakeShort: number;
  cakesAvailable: number;
  counted: { carrot: Record<Shelf, number>; cake: Record<Shelf, number> };
}

const ORDER_DOWN: Shelf[] = ['L3', 'L2', 'L1'];

/** Resolve three robots' intents into one alliance result under the real caps. */
export function resolveAlliance(robots: RobotIntent[]): AllianceResult {
  const cap = G.pantry.shelfCapacity;
  const want = { carrot: { L1: 0, L2: 0, L3: 0 } as Record<Shelf, number>, cake: { L1: 0, L2: 0, L3: 0 } as Record<Shelf, number> };
  let ovenCarrot = 0;
  let ovenCake = 0;
  let taxi = 0;
  for (const r of robots) {
    for (const s of SHELVES) {
      want.carrot[s] += r.pantry.carrot[s];
      want.cake[s] += r.pantry.cake[s];
    }
    ovenCarrot += r.oven.carrot;
    ovenCake += r.oven.cake;
    if (r.taxi) taxi++;
  }

  // ── cake supply (oven carrots → traded cakes; oven cakes recycle) ──
  const traded = Math.min(G.supply.tradeableCakesPerAlliance, Math.floor(ovenCarrot / G.cakeEconomy.ovenCarrotsPerCake));
  const cakesAvailable = G.supply.prestagedCakesPerAlliance + traded;
  const hauls = robots.map((r) => ({ carrot: r.haul.carrot, cake: r.haul.cake, park: r.park }));
  let demand = SHELVES.reduce((a, s) => a + want.cake[s], 0) + hauls.reduce((a, h) => a + (h.park ? h.cake : 0), 0);
  let short = 0;
  if (demand > cakesAvailable) {
    let excess = demand - cakesAvailable;
    // drop the cheapest cake uses first: haul (3) < L1 (8) < L2 (10) < L3 (12)
    for (const h of hauls) {
      while (excess > 0 && h.park && h.cake > 0) {
        h.cake--;
        h.carrot++;
        excess--;
        short++;
      }
    }
    for (const s of ['L1', 'L2', 'L3'] as Shelf[]) {
      while (excess > 0 && want.cake[s] > 0) {
        want.cake[s]--;
        want.carrot[s]++;
        excess--;
        short++;
      }
    }
    demand = cakesAvailable;
  }

  // ── shelf caps with cascade (keep the most valuable pieces on each shelf) ──
  const counted = { carrot: { L1: 0, L2: 0, L3: 0 } as Record<Shelf, number>, cake: { L1: 0, L2: 0, L3: 0 } as Record<Shelf, number> };
  let carryCarrot = 0;
  let carryCake = 0;
  let overflow = 0;
  for (const s of ORDER_DOWN) {
    let k = want.cake[s] + carryCake;
    let c = want.carrot[s] + carryCarrot;
    const keepK = Math.min(k, cap);
    const keepC = Math.min(c, cap - keepK);
    counted.cake[s] = keepK;
    counted.carrot[s] = keepC;
    carryCake = k - keepK;
    carryCarrot = c - keepC;
    overflow += carryCake + carryCarrot;
    k = 0;
    c = 0;
  }
  ovenCarrot += carryCarrot;
  ovenCake += carryCake;

  let pantry = 0;
  for (const s of SHELVES) pantry += counted.carrot[s] * G.points.pantry.carrot[s] + counted.cake[s] * G.points.pantry.cake[s];
  const oven = ovenCarrot * G.points.oven.carrot + ovenCake * G.points.oven.cake;
  const park = robots.filter((r) => r.park).length * G.points.park;
  const haul = hauls.reduce((a, h) => a + robotHaulPoints(h.park, h.carrot, h.cake), 0);
  const endgame = park + haul;
  const taxiPts = taxi * G.points.taxi;
  const rp: RpFlags = {
    stocked: SHELVES.every((s) => counted.carrot[s] + counted.cake[s] >= G.rankingPoints.stockedUp.minPiecesPerShelf),
    baked: SHELVES.every((s) => counted.cake[s] >= G.rankingPoints.bakedUp.minCakesPerShelf),
    dinner: endgame >= G.rankingPoints.dinner.minEndgamePoints,
  };
  return { total: taxiPts + pantry + oven + endgame, pantry, oven, taxi: taxiPts, park, haul, endgame, rp, overflow, cakeShort: short, cakesAvailable, counted };
}

/** Bootstrap pool for one team: its own records, else the event-wide pool. */
export interface TeamPool {
  team: string;
  intents: RobotIntent[];
  /** true when the team had no data and borrowed the event pool */
  borrowed: boolean;
  reliability: number;
}

export function sampleIntent(pool: TeamPool, rng: Rng): RobotIntent {
  if (!pool.intents.length) return emptyIntent();
  return pool.intents[Math.floor(rng() * pool.intents.length)];
}

export interface SimSummary {
  n: number;
  mean: number;
  sd: number;
  p10: number;
  p90: number;
  rp: { stocked: number; baked: number; dinner: number };
  pantry: number;
  oven: number;
  endgame: number;
  overflow: number;
  cakeShort: number;
  scores: Float64Array;
}

export function simulateAlliance(pools: TeamPool[], runs: number, rng: Rng, keepScores = true): SimSummary {
  const scores = new Float64Array(runs);
  let s = 0;
  let s2 = 0;
  let st = 0;
  let bk = 0;
  let dn = 0;
  let pan = 0;
  let ov = 0;
  let eg = 0;
  let of = 0;
  let cs = 0;
  for (let i = 0; i < runs; i++) {
    const res = resolveAlliance(pools.map((p) => sampleIntent(p, rng)));
    scores[i] = res.total;
    s += res.total;
    s2 += res.total * res.total;
    if (res.rp.stocked) st++;
    if (res.rp.baked) bk++;
    if (res.rp.dinner) dn++;
    pan += res.pantry;
    ov += res.oven;
    eg += res.endgame;
    of += res.overflow;
    cs += res.cakeShort;
  }
  const mean = s / runs;
  const sorted = keepScores ? Float64Array.from(scores).sort() : scores;
  return {
    n: runs,
    mean,
    sd: Math.sqrt(Math.max(0, s2 / runs - mean * mean)),
    p10: keepScores ? sorted[Math.floor(runs * 0.1)] : NaN,
    p90: keepScores ? sorted[Math.floor(runs * 0.9)] : NaN,
    rp: { stocked: st / runs, baked: bk / runs, dinner: dn / runs },
    pantry: pan / runs,
    oven: ov / runs,
    endgame: eg / runs,
    overflow: of / runs,
    cakeShort: cs / runs,
    scores,
  };
}

export function piecesOf(i: RobotIntent, piece: Piece): number {
  return SHELVES.reduce((a, s) => a + i.pantry[piece][s], 0);
}
