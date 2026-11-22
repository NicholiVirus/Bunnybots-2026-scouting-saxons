'use client';
import type { MatchRow, Alliance } from '@/data/types';
import { matchFlags } from '@/analytics/rankings';
import { HARVEST_HAVOC as G } from '@/game/harvestHavoc.config';
import { Badge } from './ui';

/** W/T, Stocked, Baked, Dinner badges for one alliance in one match. */
export function RpBadges({ m, side }: { m: MatchRow; side: Alliance }) {
  if (!m.played) return null;
  const f = matchFlags(m, side);
  const won = m.winner === side;
  const tie = m.winner === 'tie';
  return (
    <span className="inline-flex flex-wrap gap-1">
      {won && <Badge tone={side}>W</Badge>}
      {tie && <Badge>T</Badge>}
      {f.stocked && (
        <Badge tone="good" title={`Stocked Up: ≥${G.rankingPoints.stockedUp.minPiecesPerShelf} pieces on each shelf`}>
          S
        </Badge>
      )}
      {f.baked && (
        <Badge tone="saxon" title={`Baked Up: ≥${G.rankingPoints.bakedUp.minCakesPerShelf} cake on each shelf`}>
          B
        </Badge>
      )}
      {f.dinner && (
        <Badge tone="warn" title={`Dinner: ≥${G.rankingPoints.dinner.minEndgamePoints} endgame points`}>
          D
        </Badge>
      )}
    </span>
  );
}
