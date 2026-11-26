/**
 * Local IndexedDB (Dexie). The UI reads ONLY from here, so every screen works
 * in airplane mode. The sync engine mirrors Supabase into it when online.
 *
 * Demo mode uses a separate database so practice data can never leak into the
 * real event data (and real data is untouched while you play with the demo).
 */
import Dexie, { type Table } from 'dexie';
import type {
  ApiSnapshot,
  AuditRow,
  DraftAction,
  KV,
  MatchRow,
  OfficialAlliance,
  OutboxItem,
  PhotoBlob,
  PhotoRow,
  PicklistEntry,
  PicklistMeta,
  PicklistSnapshot,
  PicklistVote,
  PitCheck,
  PitReport,
  Profile,
  RankingRow,
  RobotReport,
  ScoutAssignment,
  ScoutEvent,
  ScoutSubmission,
  SettingRow,
  StrategyNote,
  Team,
  TeamAlias,
  VideoReport,
} from './types';

export interface AssetRow {
  key: string;
  blob: Blob;
  mime: string;
  updated_at: string;
  source: string;
}

export class ScoutDB extends Dexie {
  teams!: Table<Team, string>;
  team_aliases!: Table<TeamAlias, string>;
  matches!: Table<MatchRow, string>;
  rankings!: Table<RankingRow, string>;
  official_alliances!: Table<OfficialAlliance, number>;
  scout_submissions!: Table<ScoutSubmission, string>;
  robot_reports!: Table<RobotReport, string>;
  scout_events!: Table<ScoutEvent, string>;
  video_reports!: Table<VideoReport, string>;
  pit_reports!: Table<PitReport, string>;
  photos!: Table<PhotoRow, string>;
  picklist_entries!: Table<PicklistEntry, string>;
  picklist_votes!: Table<PicklistVote, string>;
  picklist_snapshots!: Table<PicklistSnapshot, string>;
  picklist_meta!: Table<PicklistMeta, string>;
  draft_actions!: Table<DraftAction, string>;
  strategy_notes!: Table<StrategyNote, string>;
  pit_checks!: Table<PitCheck, string>;
  scout_assignments!: Table<ScoutAssignment, string>;
  settings!: Table<SettingRow, string>;
  profiles!: Table<Profile, string>;
  audit_log!: Table<AuditRow, number>;
  api_snapshots!: Table<ApiSnapshot, number>;
  outbox!: Table<OutboxItem, number>;
  photo_blobs!: Table<PhotoBlob, string>;
  kv!: Table<KV, string>;
  assets!: Table<AssetRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      teams: 'id, status',
      team_aliases: 'alias, team_id',
      matches: 'key, comp_level, match_number, played',
      rankings: 'team_id, rank',
      official_alliances: 'number',
      scout_submissions: 'id, match_key, scout_id, status, [match_key+alliance]',
      robot_reports: 'id, submission_id, team_id',
      scout_events: 'id, submission_id, team_id',
      pit_reports: 'id, team_id, author_id',
      photos: 'id, team_id',
      picklist_entries: 'id, picking_team, team_id',
      picklist_votes: 'id, picking_team, team_id, user_id',
      picklist_snapshots: 'id, picking_team, created_at',
      picklist_meta: 'picking_team',
      draft_actions: 'id, seq',
      strategy_notes: 'match_key',
      pit_checks: 'team_id',
      scout_assignments: 'id, match_key, scout_id',
      settings: 'key',
      profiles: 'id, role',
      audit_log: 'id, at, table_name',
      api_snapshots: '++id, endpoint, fetched_at',
      outbox: '++id, status, [table+key]',
      photo_blobs: 'id, team_id, uploaded',
      kv: 'key',
      assets: 'key',
    });
    // automatic video scouting (BunnyBotsAutomaticScouting), shown next to the human scouting
    this.version(2).stores({ video_reports: 'id, match_key, team_id' });
  }
}

export const DB_NAME = 'hh-scouting';
export const DEMO_DB_NAME = 'hh-scouting-demo';

function pickName(): string {
  if (typeof window === 'undefined') return DB_NAME;
  try {
    const prefs = JSON.parse(localStorage.getItem('hh:prefs:v1') || '{}');
    return prefs.demo ? DEMO_DB_NAME : DB_NAME;
  } catch {
    return DB_NAME;
  }
}

export const db = new ScoutDB(pickName());
export const isDemoDb = () => db.name === DEMO_DB_NAME;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}
export async function kvSet(key: string, value: unknown) {
  await db.kv.put({ key, value });
}
