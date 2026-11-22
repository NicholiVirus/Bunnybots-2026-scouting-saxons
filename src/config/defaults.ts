/**
 * App defaults (NOT game rules — those live in src/game/harvestHavoc.config.ts).
 * Admins can override most of these in Admin → Settings; overrides sync to all devices.
 */
export const APP_VERSION = '1.0.0';

export const DEFAULT_SETTINGS = {
  /** The Bunnybots Alliance poll interval on event day. */
  pollIntervalSec: 30,
  /** Cycles longer than this are excluded from stats and shown as "long gaps". */
  cycleOutlierCapSec: 60,
  /**
   * Placements this close together (no intake between) are one trip/cycle.
   * Robots carry up to 3 pieces, so 3 quick taps are one delivery, not 3 cycles.
   * Set to 0 for the literal "every placement is a cycle" definition.
   */
  cycleBurstWindowSec: 3,
  /** Playoff alliance count (up to 8; depends on playoff-ready teams). */
  allianceCount: 8,
  /** Monte Carlo runs for bonus-RP / rank / draft / bracket sims. */
  simRuns: 2000,
  /** Scouted vs official alliance totals: warn above this relative gap. */
  officialMismatchWarnPct: 20,
  /** Two scouts on one robot disagree "a lot" above this many points. */
  scoutDisagreePoints: 10,
  /** Prior strength (in matches) when blending a team toward the event average. */
  priorMatches: 2,
  /** Local time (HH:MM, event TZ) the pick list auto-locks; null = manual only. */
  picklistAutoLock: '14:55',
} as const;

export type AppSettings = {
  -readonly [K in keyof typeof DEFAULT_SETTINGS]: (typeof DEFAULT_SETTINGS)[K] extends string
    ? string | null
    : (typeof DEFAULT_SETTINGS)[K] extends number
      ? number
      : (typeof DEFAULT_SETTINGS)[K];
};

/** Confidence weights for cycle data by how many robots the scout watched. */
export const CYCLE_WEIGHT_BY_ROBOT_COUNT: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.35 };
