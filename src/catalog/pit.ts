/** Team catalog: merge pit reports (newest value per field wins) + validate vs robot rules. */
import { HARVEST_HAVOC as G } from '@/game/harvestHavoc.config';
import type { PitData, PitReport } from '@/data/types';

/** Field-wise merge: the most recently updated report that sets a field wins. */
export function mergePit(reports: readonly PitReport[]): PitData {
  const sorted = [...reports].sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1));
  const out: PitData = {};
  for (const r of sorted) {
    for (const [k, v] of Object.entries(r.data ?? {})) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && k !== 'levels')) continue;
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Robot-rule checks from the manual (R5/R7/R8): returns human-readable problems. */
export function validatePit(d: PitData): string[] {
  const L = G.robotLimits;
  const out: string[] = [];
  if (d.framePerimeterIn !== undefined && d.framePerimeterIn > L.framePerimeterMaxIn)
    out.push(`Frame perimeter ${d.framePerimeterIn}" is over the ${L.framePerimeterMaxIn}" limit (R5).`);
  if (d.startHeightIn !== undefined && d.startHeightIn > L.startHeightMaxIn)
    out.push(`Start height ${d.startHeightIn}" is over the ${L.startHeightMaxIn}" limit (R5).`);
  if (d.weightLb !== undefined && d.weightLb > L.weightMaxLbNoBatteryNoBumpers)
    out.push(`Weight ${d.weightLb} lb is over ${L.weightMaxLbNoBatteryNoBumpers} lb without battery/bumpers (R7). (≤${L.weightMaxLbWithBumpers} lb with bumpers.)`);
  if (d.maxHaul !== undefined && (d.maxHaul < 0 || d.maxHaul > G.haul.maxPiecesPerRobot))
    out.push(`Max haul must be 0–${G.haul.maxPiecesPerRobot} pieces.`);
  if (d.humanPlayerQuality !== undefined && (d.humanPlayerQuality < 1 || d.humanPlayerQuality > 5)) out.push('Human player rating is 1–5.');
  return out;
}

export const PIT_LABELS = {
  mechanism: { elevator: 'Elevator', arm: 'Arm', elevator_arm: 'Elevator + Arm', other: 'Other' },
  drivetrain: { swerve: 'Swerve', tank: 'Tank', mecanum: 'Mecanum', other: 'Other' },
  handles: { carrots: 'Carrots', cakes: 'Cakes', both: 'Both' },
  oven: { yes: 'Yes', no: 'No', unverified: 'Unverified' },
  reliability: { reliable: 'Reliable', inconsistent: 'Inconsistent', unreliable: 'Unreliable' },
  intake: { kitchen: 'Kitchen', neutral: 'Neutral Zone', source: 'Source' },
} as const;
