'use client';
import { ROLE_LABEL } from '@/game/harvestHavoc.config';
import type { TeamStats } from '@/analytics/model';
import { PIT_LABELS } from '@/catalog/pit';
import { Badge } from './ui';

/** Architecture tags (from pit scouting; scouting fills gaps). */
export function TeamTags({ t, max = 8 }: { t: TeamStats; max?: number }) {
  const tags: { label: string; tone?: 'good' | 'warn' | 'bad' | 'saxon' | 'neutral' }[] = [];
  if (t.role) tags.push({ label: ROLE_LABEL[t.role], tone: 'saxon' });
  if (t.pit.drivetrain) tags.push({ label: PIT_LABELS.drivetrain[t.pit.drivetrain] });
  if (t.pit.mechanism) tags.push({ label: PIT_LABELS.mechanism[t.pit.mechanism] });
  const levels = new Set(t.pit.levels ?? []);
  for (const l of ['L1', 'L2', 'L3'] as const) if ((t.pieces.carrot[l] ?? 0) + (t.pieces.cake[l] ?? 0) > 0.2) levels.add(l);
  if (levels.size) tags.push({ label: [...levels].sort().join('/') });
  if (t.pit.handles === 'cakes' || t.pit.handles === 'both' || t.pieces.cakes > 0.3) tags.push({ label: 'Cakes', tone: 'good' });
  if (t.pit.oven === 'yes' || t.pieces.ovenCarrot > 0.5) tags.push({ label: 'Oven' });
  if (t.groundIntakeReliability)
    tags.push({
      label: `Ground: ${PIT_LABELS.reliability[t.groundIntakeReliability]}`,
      tone: t.groundIntakeReliability === 'reliable' ? 'good' : t.groundIntakeReliability === 'inconsistent' ? 'warn' : 'bad',
    });
  else if (t.pit.groundIntake) tags.push({ label: 'Ground intake' });
  if (t.endgame.reliablyHaulsCakes) tags.push({ label: 'Hauls cakes', tone: 'good' });
  if (t.defense.rate >= 0.3) tags.push({ label: 'Defense', tone: 'warn' });
  if (t.status === 'expected') tags.push({ label: 'expected', tone: 'warn' });
  if (t.trend === 'improving') tags.push({ label: '▲ improving', tone: 'good' });
  if (t.trend === 'declining') tags.push({ label: '▼ declining', tone: 'bad' });
  if (t.brokeLastMatch) tags.push({ label: 'broke last match', tone: 'bad' });
  return (
    <span className="flex flex-wrap gap-1">
      {tags.slice(0, max).map((x) => (
        <Badge key={x.label} tone={x.tone ?? 'neutral'}>
          {x.label}
        </Badge>
      ))}
    </span>
  );
}
