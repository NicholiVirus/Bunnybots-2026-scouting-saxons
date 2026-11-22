/** Shared team filters/sorts (Team Catalog, comparison, Alliance Selection). */
import type { RobotRole, Shelf } from '@/game/harvestHavoc.config';
import type { TeamStats } from '@/analytics/model';
import { compareTeamIds } from '@/lib/teamIds';

export interface TeamFilter {
  q?: string;
  drivetrain?: string;
  mechanism?: string;
  level?: Shelf;
  cakes?: boolean;
  oven?: boolean;
  groundReliable?: boolean;
  defense?: boolean;
  role?: RobotRole;
  maxMedianCycle?: number | null;
  maxCakeCycle?: number | null;
  minPoints?: number | null;
  hauler?: boolean;
  hideWithdrawn?: boolean;
}

export function applyFilter(t: TeamStats, f: TeamFilter): boolean {
  if (f.hideWithdrawn && t.status === 'withdrawn') return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!t.team.toLowerCase().includes(q) && !t.name.toLowerCase().includes(q)) return false;
  }
  if (f.drivetrain && t.pit.drivetrain !== f.drivetrain) return false;
  if (f.mechanism && t.pit.mechanism !== f.mechanism) return false;
  if (f.level) {
    const scored = (t.pieces.carrot[f.level] ?? 0) + (t.pieces.cake[f.level] ?? 0) > 0;
    if (!(t.pit.levels ?? []).includes(f.level) && !scored) return false;
  }
  if (f.cakes) {
    const pitCakes = t.pit.handles === 'cakes' || t.pit.handles === 'both';
    if (!pitCakes && t.pieces.cakes <= 0) return false;
  }
  if (f.oven && !(t.pit.oven === 'yes' || t.pieces.ovenCarrot + t.pieces.ovenCake > 0)) return false;
  if (f.groundReliable && t.groundIntakeReliability !== 'reliable') return false;
  if (f.defense && t.defense.rate <= 0 && t.pit.role !== 'defense') return false;
  if (f.role && t.role !== f.role) return false;
  if (f.maxMedianCycle && !(t.cycles && t.cycles.median <= f.maxMedianCycle)) return false;
  if (f.maxCakeCycle && !(t.cycles?.byPiece.cake && t.cycles.byPiece.cake.median <= f.maxCakeCycle)) return false;
  if (f.minPoints && !(t.n > 0 && t.points.mean >= f.minPoints)) return false;
  if (f.hauler && !((t.endgame.haulPoints ?? 0) >= 1.5 || t.endgame.reliablyHaulsCakes)) return false;
  return true;
}

export type SortKey = 'team' | 'points' | 'recent' | 'cycle' | 'reliability' | 'opr' | 'endgame' | 'driver' | 'rank';

export const SORT_LABEL: Record<SortKey, string> = {
  team: 'Team #',
  points: 'Avg points',
  recent: 'Recent form',
  cycle: 'Median cycle',
  reliability: 'Reliability',
  opr: 'OPR',
  endgame: 'Endgame value',
  driver: 'Driver score',
  rank: 'Qual rank',
};

export function sortTeams(list: TeamStats[], key: SortKey): TeamStats[] {
  const val = (t: TeamStats): number => {
    switch (key) {
      case 'points':
        return t.n ? -t.points.mean : Infinity;
      case 'recent':
        return t.recent3 !== null ? -t.recent3 : Infinity;
      case 'cycle':
        return t.cycles ? t.cycles.median : Infinity;
      case 'reliability':
        return t.reliability !== null ? -t.reliability : Infinity;
      case 'opr':
        return t.official.opr !== null ? -t.official.opr : Infinity;
      case 'endgame':
        return t.endgame.value !== null ? -t.endgame.value : Infinity;
      case 'driver':
        return t.driver.relScore !== null ? -t.driver.relScore : t.driver.rating !== null ? -t.driver.rating * 10 : Infinity;
      case 'rank':
        return t.official.rank ?? Infinity;
      default:
        return 0;
    }
  };
  return [...list].sort((a, b) => {
    const d = val(a) - val(b);
    if (key === 'team' || d === 0 || Number.isNaN(d)) return compareTeamIds(a.team, b.team);
    return d;
  });
}
