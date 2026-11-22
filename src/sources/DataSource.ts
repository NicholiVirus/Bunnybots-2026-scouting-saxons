/**
 * Pluggable official-data adapters. Official results are the source of truth for
 * scores, W/L/T and RPs; scouting data never overwrites them.
 *
 *  - bunnybotsAlliance  449's TBA-style API (primary, polled every 30 s)
 *  - csv                upload / URL with column mapping (BA ?format=csv maps with zero config)
 *  - demo               449's simulated event (rescored with our config)
 *  - manual             admin forms (always available; writes rows directly)
 */
import type { ApiSnapshot, MatchRow, OfficialAlliance, RankingRow, SourceKind } from '@/data/types';

export interface OfficialData {
  quals: MatchRow[];
  playoffs: MatchRow[];
  rankings: RankingRow[];
  alliances: OfficialAlliance[];
  /** Raw responses kept for replay/debugging. */
  snapshots: ApiSnapshot[];
  warnings: string[];
}

export interface DataSource {
  id: 'bunnybots-alliance' | 'csv' | 'demo' | 'manual';
  kind: SourceKind;
  label: string;
  fetch(): Promise<OfficialData>;
}

export const emptyOfficialData = (): OfficialData => ({ quals: [], playoffs: [], rankings: [], alliances: [], snapshots: [], warnings: [] });

export const SOURCE_LABEL: Record<SourceKind, string> = {
  api: 'Bunnybots Alliance',
  manual: 'Manual entry',
  csv: 'CSV import',
  demo: 'Demo (449 simulation)',
};
