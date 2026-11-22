/** Alliance synergy warnings + role mix from the capped simulation and team stats. */
import { ROLE_LABEL, SHELVES, type RobotRole } from '@/game/harvestHavoc.config';
import type { TeamStats } from './model';
import type { SimSummary } from './allianceSim';

export interface Synergy {
  warnings: string[];
  roles: { team: string; role: RobotRole | null; label: string }[];
}

export function synergy(teams: (TeamStats | undefined)[], sim: SimSummary): Synergy {
  const t = teams.filter(Boolean) as TeamStats[];
  const w: string[] = [];
  const l3Heavy = t.filter((x) => x.pieces.cake.L3 + x.pieces.carrot.L3 >= 2.5);
  if (sim.overflow > 1) {
    w.push(
      l3Heavy.length >= 2
        ? `${l3Heavy.map((x) => x.team).join(' & ')} compete for the same 5 L3 slots (~${sim.overflow.toFixed(1)} pieces/match cascade down)`
        : `Shelves overfill: ~${sim.overflow.toFixed(1)} pieces/match have to drop a level`,
    );
  }
  if (sim.cakeShort > 0.5) w.push(`No cake source: ~${sim.cakeShort.toFixed(1)} cake placements/match lost — needs an oven feeder (3 oven carrots = 1 cake)`);
  const upper = t.reduce((a, x) => a + x.pieces.carrot.L2 + x.pieces.carrot.L3 + x.pieces.cake.L1 + x.pieces.cake.L2 + x.pieces.cake.L3, 0);
  if (t.length >= 2 && t.every((x) => x.n > 0) && upper < 0.5) w.push('Only L1 carrots between these robots');
  const reachesL3 = t.some((x) => (x.pit.levels ?? []).includes('L3') || SHELVES.some((s) => s === 'L3' && x.pieces.carrot.L3 + x.pieces.cake.L3 > 0.3));
  if (t.length === 3 && !reachesL3) w.push('No one reaches L3');
  const haulers = t.filter((x) => (x.endgame.haulPoints ?? 0) >= 1);
  if (t.length === 3 && !haulers.length) w.push('No one hauls — Dinner RP needs ≥4 haul points on top of 3 parks');
  if (sim.rp.dinner < 0.3 && t.length === 3) w.push(`Dinner RP unlikely (${Math.round(sim.rp.dinner * 100)}%)`);
  const defenders = t.filter((x) => x.role === 'defense');
  if (defenders.length >= 2) w.push('Two defense robots — low scoring ceiling');
  const flaky = t.filter((x) => x.reliability !== null && x.reliability < 0.75);
  if (flaky.length) w.push(`Reliability risk: ${flaky.map((x) => `${x.team} (${Math.round((x.reliability ?? 0) * 100)}%)`).join(', ')}`);
  return { warnings: w, roles: t.map((x) => ({ team: x.team, role: x.role, label: x.role ? ROLE_LABEL[x.role] : 'unknown' })) };
}
