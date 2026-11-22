import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@/lib/rng';
import { computeCycles } from '@/scouting/cycles';
import { eventsForRobot, profileFor } from './demoScouting';

describe('demo scouting generator', () => {
  it('produces realistic cycle times', () => {
    const p = profileFor('3504');
    const pieces = Array.from({ length: 12 }, (_, i) => ({ piece: i % 3 ? ('carrot' as const) : ('cake' as const), target: (['L1', 'L2', 'L3', 'oven'] as const)[i % 4] }));
    const evs = eventsForRobot('s', '3504', pieces, p, mulberry32(1), true, true, { carrot: 1, cake: 1 }, false).map((e, i) => ({ ...e, id: `e${i}` }));
    const r = computeCycles(evs, { burstWindowMs: 3000, outlierCapMs: 60_000 });
    expect(r.cycles.length).toBeGreaterThan(2);
    expect(Math.min(...r.cycles.map((c) => c.durationMs))).toBeGreaterThan(1000);
    // all 12 official pieces still fit inside teleop
    expect(evs.filter((e) => e.action === 'score').length).toBe(12);
  });
});
