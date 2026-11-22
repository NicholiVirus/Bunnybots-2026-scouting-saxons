/**
 * Shared row shapes. Synced rows use snake_case so the SAME object is stored in
 * IndexedDB (Dexie) and Postgres (Supabase) with no mapping layer.
 */
import type {
  DefenseType,
  Mechanism,
  MechStatus,
  Phase,
  Piece,
  ProblemFlag,
  RobotRole,
  Shelf,
  Target,
  IntakeSource,
} from '@/game/harvestHavoc.config';
import type { AllianceBreakdown } from '@/game/scoring';
import type { TeamStatus } from '@/config/event';

export type TeamId = string;
export type Alliance = 'red' | 'blue';
export type Station = 'red1' | 'red2' | 'red3' | 'blue1' | 'blue2' | 'blue3';
export type Role = 'admin' | 'strategist' | 'scout' | 'viewer';
export type SourceKind = 'api' | 'manual' | 'csv' | 'demo';
export type CompLevel = 'qm' | 'po';

export const STATIONS: readonly Station[] = ['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3'];
export const stationAlliance = (s: Station): Alliance => (s.startsWith('red') ? 'red' : 'blue');
export const stationIndex = (s: Station): number => Number(s.slice(-1)) - 1;

interface Synced {
  updated_at: string;
  deleted_at?: string | null;
}

// ── Teams ───────────────────────────────────────────────────────────────────
export interface Team extends Synced {
  id: TeamId;
  number: number;
  name: string;
  status: TeamStatus;
  notes?: string | null;
}

export interface TeamAlias extends Synced {
  alias: string;
  team_id: TeamId;
}

// ── Official results ────────────────────────────────────────────────────────
export interface MatchRow extends Synced {
  /** "Q12" for quals, the playoff label ("M4", "F1") for playoffs. */
  key: string;
  comp_level: CompLevel;
  match_number: number;
  label: string;
  red: TeamId[];
  blue: TeamId[];
  scheduled_time?: string | null;
  played: boolean;
  red_score: number | null;
  blue_score: number | null;
  breakdown?: { red: AllianceBreakdown; blue: AllianceBreakdown } | null;
  winner?: Alliance | 'tie' | null;
  /** Red-carded (disqualified) teams in this match. */
  dq?: TeamId[] | null;
  source: SourceKind;
  /** Admin override: a locked manual result is never replaced by the API. */
  locked?: boolean;
  warnings?: string[] | null;
}

export interface RankingRow extends Synced {
  team_id: TeamId;
  rank: number;
  /** Average RP (the official ranking metric). */
  ranking_score: number;
  ranking_total: number;
  wins: number;
  losses: number;
  ties: number;
  dq: number;
  matches_played: number;
  avg_match: number;
  source: SourceKind;
}

export interface OfficialAlliance extends Synced {
  number: number;
  captain: TeamId | null;
  first_pick: TeamId | null;
  second_pick: TeamId | null;
  source: SourceKind;
}

// ── Scouting ────────────────────────────────────────────────────────────────
export type SubmissionStatus = 'draft' | 'live' | 'submitted';
export type SubmissionSource = 'app' | 'qr' | 'qrscout';

export interface ScoutSubmission extends Synced {
  id: string;
  match_key: string;
  alliance: Alliance;
  teams: TeamId[];
  stations: Station[];
  /** How many robots this scout watched (1–3): drives cycle-time confidence. */
  robot_count: number;
  scout_id: string | null;
  scout_name: string;
  device_id: string;
  status: SubmissionStatus;
  /** Device epoch ms when Start was tapped (only used for display/debug). */
  started_at: number | null;
  submitted_at: string | null;
  source: SubmissionSource;
  discarded: boolean;
  discard_reason: string | null;
  app_version: string;
  created_at: string;
}

export type EventAction = 'score' | 'intake' | 'drop' | 'handoff' | 'park' | 'haul' | 'flag' | 'revive' | 'taxi';
export type EventTarget = Target | 'haul';

export interface ScoutEvent {
  id: string;
  submission_id: string;
  team_id: TeamId;
  /** ms since the scout tapped Start at the field buzzer. */
  t_ms: number;
  phase: Phase;
  action: EventAction;
  piece: Piece | null;
  target: EventTarget | null;
  /** intake source / flag name / free detail */
  detail: string | null;
}

export interface MechanismEntry {
  status: MechStatus;
  note?: string;
}

/** Totals-only data (449 QRScout imports have no event log). */
export interface TotalsOverride {
  auto: { pantryCarrotUnknownLevel: number; ovenCarrot: number };
  teleop: { carrot: Record<Shelf, number>; cake: Record<Shelf, number>; ovenCarrot: number; ovenCake: number };
  intake: Partial<Record<IntakeSource, number>>;
  haul: { carrot: number; cake: number };
  parked: boolean | null;
  taxi: boolean | null;
}

export interface RobotReport extends Synced {
  /** `${submission_id}:${team_id}` */
  id: string;
  submission_id: string;
  team_id: TeamId;
  station: Station;
  note: string;
  driver_rating: number | null;
  defense_played: boolean;
  defense_type: DefenseType | null;
  defense_rating: number | null;
  flags: ProblemFlag[];
  mechanisms: Partial<Record<Mechanism, MechanismEntry>>;
  /** Relative ranks among the robots this scout watched (1 = best). */
  rank_quickness: number | null;
  rank_awareness: number | null;
  rank_defense_resistance: number | null;
  viewed: boolean;
  totals_override: TotalsOverride | null;
}

// ── Pit scouting / catalog ──────────────────────────────────────────────────
export interface PitData {
  mechanism?: 'elevator' | 'arm' | 'elevator_arm' | 'other';
  levels?: Shelf[];
  handles?: 'carrots' | 'cakes' | 'both';
  oven?: 'yes' | 'no' | 'unverified';
  drivetrain?: 'swerve' | 'tank' | 'mecanum' | 'other';
  groundIntake?: boolean;
  groundIntakeReliability?: 'reliable' | 'inconsistent' | 'unreliable';
  intakeSources?: ('kitchen' | 'neutral' | 'source')[];
  canPark?: boolean;
  maxHaul?: number;
  haulsCakes?: boolean;
  autoTaxi?: boolean;
  autoScoresBothPreloads?: boolean;
  autoTargets?: Target[];
  autoPicksPrestaged?: boolean;
  autoDescription?: string;
  role?: RobotRole;
  handoff?: boolean;
  humanPlayerQuality?: number;
  weightLb?: number;
  framePerimeterIn?: number;
  startHeightIn?: number;
  driverExperience?: string;
  notes?: string;
}

export interface PitReport extends Synced {
  id: string;
  team_id: TeamId;
  author_id: string | null;
  author_name: string;
  data: PitData;
  created_at: string;
}

export interface PhotoRow extends Synced {
  id: string;
  team_id: TeamId;
  /** Path inside the `robot-photos` bucket once uploaded; null while queued offline. */
  storage_path: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string;
  is_primary: boolean;
  created_at: string;
}

// ── Strategy / selection ────────────────────────────────────────────────────
export type PickTier = 'first' | 'second' | 'dnp';
export type DnpReason = 'unreliable' | 'fouls' | 'tippy' | 'damaged_others' | 'cant_score' | 'other';
export const DNP_REASON_LABEL: Record<DnpReason, string> = {
  unreliable: 'Unreliable',
  fouls: 'Fouls',
  tippy: 'Tippy',
  damaged_others: 'Damaged others (G2)',
  cant_score: "Can't score",
  other: 'Other',
};

export interface PicklistEntry extends Synced {
  /** `${picking_team}:${team_id}` */
  id: string;
  picking_team: TeamId;
  team_id: TeamId;
  tier: PickTier;
  position: number;
  note: string | null;
  dnp_reason: DnpReason | null;
  dnp_note: string | null;
  updated_by: string | null;
}

export interface PicklistVote extends Synced {
  /** `${picking_team}:${team_id}:${user_id}` */
  id: string;
  picking_team: TeamId;
  team_id: TeamId;
  user_id: string;
  user_name: string;
  value: 1 | -1;
}

export interface PicklistSnapshot extends Synced {
  id: string;
  picking_team: TeamId;
  name: string;
  entries: Pick<PicklistEntry, 'team_id' | 'tier' | 'position' | 'note' | 'dnp_reason' | 'dnp_note'>[];
  created_by: string | null;
  created_by_name: string;
  created_at: string;
}

export interface PickWeights {
  contribution: number;
  reliability: number;
  consistency: number;
  fit: number;
  defense: number;
  driver: number;
  floor: number;
  fouls: number;
  endgame: number;
  cycle: number;
}

export interface PicklistMeta extends Synced {
  picking_team: TeamId;
  locked: boolean;
  locked_by: string | null;
  locked_at: string | null;
  weights_first: PickWeights | null;
  weights_second: PickWeights | null;
  /** Strategist guesses: captain team → team they expect that captain to pick. */
  captain_guesses: Record<TeamId, TeamId> | null;
}

export type DraftActionKind = 'pick' | 'decline' | 'captain' | 'config';
export interface DraftAction extends Synced {
  id: string;
  /** Monotonic ordering key (client ms + tiebreak). */
  seq: number;
  action: DraftActionKind;
  alliance: number | null;
  team_id: TeamId | null;
  payload: Record<string, unknown> | null;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
}

export interface StrategyNote extends Synced {
  match_key: string;
  note: string;
  plan: Record<TeamId, string>;
  updated_by: string | null;
  updated_by_name: string;
}

export interface PitCheck extends Synced {
  team_id: TeamId;
  status: 'healthy' | 'concern' | null;
  note: string;
  checked_by: string | null;
  checked_by_name: string;
  checked_at: string | null;
}

export interface ScoutAssignment extends Synced {
  /** `${match_key}:${scout_key}` */
  id: string;
  match_key: string;
  scout_id: string | null;
  scout_name: string;
  alliance: Alliance;
  teams: TeamId[];
}

export interface SettingRow extends Synced {
  key: string;
  value: unknown;
  updated_by: string | null;
}

export interface Profile extends Synced {
  id: string;
  display_name: string;
  email: string | null;
  role: Role;
  created_at: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  table_name: string;
  row_key: string;
  action: 'insert' | 'update' | 'delete';
  old_row: unknown;
  new_row: unknown;
}

export interface ApiSnapshot {
  id?: number;
  endpoint: string;
  fetched_at: string;
  hash: string;
  payload: unknown;
}

// ── Local-only ──────────────────────────────────────────────────────────────
export type SyncedTable =
  | 'teams'
  | 'team_aliases'
  | 'matches'
  | 'rankings'
  | 'official_alliances'
  | 'scout_submissions'
  | 'pit_reports'
  | 'photos'
  | 'picklist_entries'
  | 'picklist_votes'
  | 'picklist_snapshots'
  | 'picklist_meta'
  | 'draft_actions'
  | 'strategy_notes'
  | 'pit_checks'
  | 'scout_assignments'
  | 'settings'
  | 'profiles';

export interface OutboxItem {
  id?: number;
  /** Logical operation; scouting bundles go through the submit_scouting RPC. */
  kind: 'upsert' | 'delete' | 'scouting' | 'photo' | 'rpc';
  table: SyncedTable | 'scouting_bundle' | 'storage';
  key: string;
  payload: unknown;
  created_at: string;
  attempts: number;
  last_error: string | null;
  status: 'pending' | 'failed';
}

export interface PhotoBlob {
  id: string;
  team_id: string;
  blob: Blob;
  mime: string;
  uploaded: boolean;
  created_at: string;
}

export interface KV {
  key: string;
  value: unknown;
}
