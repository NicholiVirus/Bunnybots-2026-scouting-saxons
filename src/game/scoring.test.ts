import { describe, expect, it } from 'vitest';
import { HARVEST_HAVOC as G, phaseAt, MAX_RP_PER_MATCH, MAX_PARK_POINTS } from './harvestHavoc.config';
import {
  allianceScore,
  computeRpFlags,
  countedOnShelf,
  emptyBreakdown,
  outcomeFor,
  parseSlots,
  playoffTiebreak,
  rankingPointsFor,
  robotHaulPoints,
  shelfPoints,
} from './scoring';

describe('Harvest Havoc config (manual v1.5 + TU 05)', () => {
  it('has the verified point values', () => {
    expect(G.points.pantry.carrot).toEqual({ L1: 3, L2: 4, L3: 5 });
    expect(G.points.pantry.cake).toEqual({ L1: 8, L2: 10, L3: 12 });
    expect(G.points.oven).toEqual({ carrot: 2, cake: 1 }); // 449's sim used 2 for cakes — manual says 1
    expect(G.points.taxi).toBe(2);
    expect(G.points.park).toBe(2);
    expect(G.points.haul).toEqual({ carrot: 1, cake: 3 });
    expect(G.points.foul).toEqual({ minor: 4, major: 8 });
    expect(MAX_RP_PER_MATCH).toBe(6);
    expect(MAX_PARK_POINTS).toBe(6);
  });

  it('derives phases from the clock: auto 0–15 s, endgame last 20 s', () => {
    expect(phaseAt(0)).toBe('auto');
    expect(phaseAt(14_999)).toBe('auto');
    expect(phaseAt(15_000)).toBe('teleop');
    expect(phaseAt(129_999)).toBe('teleop');
    expect(phaseAt(130_000)).toBe('endgame');
  });
});

describe('pantry overflow (5 per shelf, LOWEST-value 5 count)', () => {
  it('counts everything at or under capacity', () => {
    expect(countedOnShelf('L3', 2, 3)).toEqual({ carrot: 2, cake: 3 });
  });
  it('drops the most valuable pieces when overfilled', () => {
    // 4 cakes + 3 carrots on L3 → counted: 3 carrots + 2 cakes = 15 + 24 = 39
    expect(countedOnShelf('L3', 3, 4)).toEqual({ carrot: 3, cake: 2 });
    expect(shelfPoints('L3', 3, 4)).toBe(3 * 5 + 2 * 12);
    // 7 carrots → only 5 count
    expect(shelfPoints('L1', 7, 0)).toBe(15);
  });
});

describe('alliance score', () => {
  it('matches a hand-computed breakdown', () => {
    const b = emptyBreakdown();
    b.taxi = [true, true, false]; // 4
    b.pantry.carrot = { L1: 1, L2: 3, L3: 2 }; // 3 + 12 + 10 = 25
    b.pantry.cake = { L1: 2, L2: 1, L3: 3 }; // 16 + 10 + 36 = 62
    b.oven = { carrot: 13, cake: 2 }; // 26 + 2 = 28
    b.park = [true, true, true]; // 6
    b.haul = { carrot: [2, 3, 2], cake: [0, 0, 0] }; // 7
    const s = allianceScore(b, { minor: 0, major: 1 }); // +8 from opponent major
    expect(s.taxi).toBe(4);
    expect(s.pantry).toBe(87);
    expect(s.oven).toBe(28);
    expect(s.endgame).toBe(13);
    expect(s.fouls).toBe(8);
    expect(s.total).toBe(4 + 87 + 28 + 13 + 8);
  });

  it('hauls only count while parked, max 3 pieces', () => {
    expect(robotHaulPoints(false, 3, 0)).toBe(0);
    expect(robotHaulPoints(true, 2, 1)).toBe(2 + 3);
    expect(robotHaulPoints(true, 3, 3)).toBe(9); // capped at 3 pieces (cakes first)
  });
});

describe('ranking points', () => {
  it('Stocked = ≥3 per shelf, Baked = ≥1 cake per shelf, Dinner = ≥10 endgame', () => {
    const b = emptyBreakdown();
    b.pantry.carrot = { L1: 2, L2: 2, L3: 2 };
    b.pantry.cake = { L1: 1, L2: 1, L3: 1 };
    b.park = [true, true, true]; // 6
    b.haul = { carrot: [1, 0, 0], cake: [1, 0, 0] }; // 1 + 3 = 4 → 10 total
    expect(computeRpFlags(b)).toEqual({ stocked: true, baked: true, dinner: true });
    b.haul.cake = [0, 0, 0];
    b.pantry.cake.L2 = 0;
    expect(computeRpFlags(b)).toEqual({ stocked: false, baked: false, dinner: false });
  });

  it('Win 3 / Tie 1 / Loss 0 plus bonus RPs', () => {
    expect(rankingPointsFor(outcomeFor(100, 90), { stocked: true, baked: false, dinner: true })).toBe(5);
    expect(rankingPointsFor(outcomeFor(90, 90), { stocked: false, baked: false, dinner: false })).toBe(1);
    expect(rankingPointsFor(outcomeFor(80, 90), { stocked: true, baked: true, dinner: true })).toBe(3);
  });
});

describe('misc', () => {
  it('parses slot strings', () => {
    expect(parseSlots('1,2,0,0,2')).toEqual(['carrot', 'cake', null, null, 'cake']);
  });
  it('applies playoff tiebreakers in order', () => {
    expect(playoffTiebreak({ majorFouls: 0, pantry: 10, oven: 0 }, { majorFouls: 1, pantry: 90, oven: 9 })).toBeGreaterThan(0);
    expect(playoffTiebreak({ majorFouls: 1, pantry: 50, oven: 0 }, { majorFouls: 1, pantry: 40, oven: 9 })).toBeGreaterThan(0);
    expect(playoffTiebreak({ majorFouls: 1, pantry: 40, oven: 2 }, { majorFouls: 1, pantry: 40, oven: 9 })).toBeLessThan(0);
    expect(playoffTiebreak({ majorFouls: 0, pantry: 1, oven: 1 }, { majorFouls: 0, pantry: 1, oven: 1 })).toBe(0);
  });
});
