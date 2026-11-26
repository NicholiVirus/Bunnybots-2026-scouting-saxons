import type { SyncedTable } from '@/data/types';

export interface TableSpec {
  name: SyncedTable;
  key: string;
  /** Column list for pulls (profiles hides e-mails from non-admins). */
  select?: string;
  realtime: boolean;
}

/** Every Supabase table mirrored into IndexedDB, with its primary key. */
export const SYNC_TABLES: readonly TableSpec[] = [
  { name: 'settings', key: 'key', realtime: true },
  { name: 'teams', key: 'id', realtime: true },
  { name: 'team_aliases', key: 'alias', realtime: true },
  { name: 'matches', key: 'key', realtime: true },
  { name: 'rankings', key: 'team_id', realtime: true },
  { name: 'official_alliances', key: 'number', realtime: true },
  { name: 'scout_submissions', key: 'id', realtime: true },
  { name: 'video_reports', key: 'id', realtime: true },
  { name: 'pit_reports', key: 'id', realtime: true },
  { name: 'photos', key: 'id', realtime: true },
  { name: 'picklist_meta', key: 'picking_team', realtime: true },
  { name: 'picklist_entries', key: 'id', realtime: true },
  { name: 'picklist_votes', key: 'id', realtime: true },
  { name: 'picklist_snapshots', key: 'id', realtime: true },
  { name: 'draft_actions', key: 'id', realtime: true },
  { name: 'strategy_notes', key: 'match_key', realtime: true },
  { name: 'pit_checks', key: 'team_id', realtime: true },
  { name: 'scout_assignments', key: 'id', realtime: true },
  { name: 'profiles', key: 'id', select: 'id,display_name,role,created_at,updated_at,deleted_at', realtime: false },
];

export const TABLE_KEY: Record<SyncedTable, string> = Object.fromEntries(SYNC_TABLES.map((t) => [t.name, t.key])) as Record<
  SyncedTable,
  string
>;

export function rowKey(table: SyncedTable, row: Record<string, unknown>): string {
  return String(row[TABLE_KEY[table]]);
}
