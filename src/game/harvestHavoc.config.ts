/**
 * ════════════════════════════════════════════════════════════════════════════
 *  HARVEST HAVOC — Blair BunnyBots 2026 game rules (single source of truth)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  VERIFIED against Game Manual v1.5 (Oct 4 2026), which incorporates
 *  Team Updates 00–05. Event site (robot.mbhs.edu/bunnybots) checked on
 *  2026-11-22: Team Update 05 is the latest posted.
 *
 *  RULE: every point value, threshold and limit used anywhere in the app comes
 *  from THIS file. If a newer Team Update changes a number, edit it here and
 *  everything (scoring, RP checks, simulations, importers) follows.
 *
 *  Manual references are given as "p.<page> <section>" of the v1.5 PDF.
 */

export type Piece = 'carrot' | 'cake';
export type Shelf = 'L1' | 'L2' | 'L3';
export type Target = Shelf | 'oven';
export type Phase = 'auto' | 'teleop' | 'endgame';

export const PIECES: readonly Piece[] = ['carrot', 'cake'] as const;
export const SHELVES: readonly Shelf[] = ['L1', 'L2', 'L3'] as const;
export const TARGETS: readonly Target[] = ['L1', 'L2', 'L3', 'oven'] as const;
export const PHASES: readonly Phase[] = ['auto', 'teleop', 'endgame'] as const;

export const HARVEST_HAVOC = {
  meta: {
    game: 'Harvest Havoc',
    event: 'Blair BunnyBots 2026',
    manualVersion: 'v1.5',
    manualDate: '2026-10-04',
    teamUpdatesIncorporated: [0, 1, 2, 3, 4, 5],
    verifiedOn: '2026-11-22',
  },

  /** p.3 GAME SUMMARY, p.19 TELE-OPERATED, p.20 ENDGAME */
  timing: {
    matchSec: 150,
    autoSec: 15,
    teleopSec: 135,
    endgameSec: 20, // last 20 s of teleop
    /** p.17 PARKING: bumpers in own Table Zone 3 s after match end */
    parkCheckAfterEndSec: 3,
  },

  /** 3v3 (p.3) */
  allianceSize: 3,

  /** p.12 Game Piece Placement */
  supply: {
    carrotsPerAlliance: 24,
    preloadCarrotsPerRobot: 2,
    prestagedCarrotsPerSide: 5,
    cakesPerAlliance: 10,
    /** 1 cake on the alliance's corner of the Dinner Table */
    prestagedCakesPerAlliance: 1,
    /** 9 cakes wait at the opposing alliance's Depot, obtained only by trade */
    tradeableCakesPerAlliance: 9,
  },

  /** p.18 Point Values (auto values == teleop values, p.17) */
  points: {
    pantry: {
      carrot: { L1: 3, L2: 4, L3: 5 },
      cake: { L1: 8, L2: 10, L3: 12 },
    },
    oven: { carrot: 2, cake: 1 },
    taxi: 2, // per robot, all bumpers cross the Kitchen line during auto
    park: 2, // ENDGAME points per robot
    haul: { carrot: 1, cake: 3 }, // ENDGAME points per piece held while PARKED
    foul: { minor: 4, major: 8 }, // credited to the OPPONENT
  },

  /** p.16 SCORING: 5 pieces fit per shelf; if more, the 5 LOWEST-value count */
  pantry: {
    shelfCapacity: 5,
    overflowCounts: 'lowest-value' as const,
  },

  /** p.17 HARVEST HAUL: up to 3 pieces, only counts while PARKED */
  haul: {
    maxPiecesPerRobot: 3,
    requiresPark: true,
  },

  /** p.28 G14: no robot may control more than 3 pieces */
  carryLimit: 3,

  /** p.22 RECIRCULATION */
  cakeEconomy: {
    ovenCarrotsPerCake: 3,
    /** Cakes scored in the Oven return to the Ramp human player and can be reused */
    ovenCakesRecycle: true,
    /** If the opponent Depot has no cakes left, the 3 carrots are handed over for free */
    freeHandoverWhenEmpty: true,
  },

  /** p.19 Ranking Points */
  rankingPoints: {
    win: 3,
    tie: 1,
    loss: 0,
    stockedUp: { minPiecesPerShelf: 3, value: 1 },
    bakedUp: { minCakesPerShelf: 1, value: 1 },
    dinner: { minEndgamePoints: 10, value: 1 },
  },

  /** p.37 TOURNAMENT PLAY */
  ranking: {
    metric: 'average-ranking-points' as const,
    tiebreakers: ['win-loss-record', 'cumulative-alliance-score', 'random'] as const,
    /** p.23: a DISQUALIFIED team gets 0 match points and 0 RP for that qual match */
    disqualifiedGetsZero: true,
    /** Showing up to quals is optional (p.37) — "No Show" is a real outcome */
    qualAttendanceOptional: true,
  },

  /** p.37–38 */
  playoffs: {
    maxAlliances: 8, // actual count depends on playoff-ready teams (FRC 10.6.6)
    picksPerAlliance: 2,
    selection: 'serpentine' as const, // standard FRC 10.6.1
    bracket: 'double-elimination' as const,
    /** Round-1 pairings by seed (1v8, 4v5, 2v7, 3v6 — standard FRC order) */
    firstRound: [
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ] as const,
    /** Finals are part of the double-elim bracket: the lower-bracket alliance carries its loss */
    finals: 'double-elimination-carry-loss' as const,
    tiebreakers: ['fewer-major-fouls', 'more-pantry-points', 'more-oven-points', 'replay'] as const,
    /** Missing alliances become byes (automatic match win) */
    missingAllianceIsBye: true,
  },

  /** p.31–32 ROBOT rules (catalog validation) */
  robotLimits: {
    framePerimeterMaxIn: 120,
    startHeightMaxIn: 48,
    extensionMaxIn: 18,
    weightMaxLbNoBatteryNoBumpers: 115,
    weightMaxLbWithBumpers: 135,
    groundClearanceMinIn: 0.5,
  },

  /** Penalty references used by analytics */
  foulRules: {
    descoreMajorsPerPiece: 2, // G15
    extraPieceMajorsPerPiece: 1, // G14
  },
} as const;

export type GameConfig = typeof HARVEST_HAVOC;

// ── Derived timing (milliseconds since the match-start buzzer) ──────────────
export const T_AUTO_END_MS = HARVEST_HAVOC.timing.autoSec * 1000; // 15 000
export const T_MATCH_END_MS = HARVEST_HAVOC.timing.matchSec * 1000; // 150 000
export const T_ENDGAME_START_MS = (HARVEST_HAVOC.timing.matchSec - HARVEST_HAVOC.timing.endgameSec) * 1000; // 130 000

/** Phase at a given time since the start buzzer. */
export function phaseAt(tMs: number): Phase {
  if (tMs < T_AUTO_END_MS) return 'auto';
  if (tMs >= T_ENDGAME_START_MS) return 'endgame';
  return 'teleop';
}

/** Max RP one alliance can earn in a qualification match. */
export const MAX_RP_PER_MATCH =
  HARVEST_HAVOC.rankingPoints.win +
  HARVEST_HAVOC.rankingPoints.stockedUp.value +
  HARVEST_HAVOC.rankingPoints.bakedUp.value +
  HARVEST_HAVOC.rankingPoints.dinner.value;

/** Max endgame points from parks alone (3 robots). */
export const MAX_PARK_POINTS = HARVEST_HAVOC.allianceSize * HARVEST_HAVOC.points.park;

// ── Scouting vocabularies (from 449's scouting form + this brief) ───────────

/** Where a robot picked a piece up. "ground" = any carpet pickup we track ourselves. */
export const INTAKE_SOURCES = ['kitchen', 'neutral', 'source', 'ground'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];
export const INTAKE_LABEL: Record<IntakeSource, string> = {
  kitchen: 'Kitchen',
  neutral: 'Neutral Zone',
  source: 'Source (Depot)',
  ground: 'Ground',
};

export const DEFENSE_TYPES = ['thief', 'defense_oz', 'defense_nz'] as const;
export type DefenseType = (typeof DEFENSE_TYPES)[number];
export const DEFENSE_LABEL: Record<DefenseType, string> = {
  thief: 'Thief',
  defense_oz: 'Defense (Opponent Zone)',
  defense_nz: 'Defense (Neutral Zone)',
};

export const PROBLEM_FLAGS = [
  'died',
  'no_show',
  'browned_out',
  'a_stop',
  'e_stop',
  'parts_fell_off',
  'severely_damaged',
  'tipped',
] as const;
export type ProblemFlag = (typeof PROBLEM_FLAGS)[number];
export const FLAG_LABEL: Record<ProblemFlag, string> = {
  died: 'Died',
  no_show: 'No Show',
  browned_out: 'Browned Out',
  a_stop: 'A-Stop',
  e_stop: 'E-Stop',
  parts_fell_off: 'Parts Fell Off',
  severely_damaged: 'Severely Damaged',
  tipped: 'Tipped',
};
/** Flags that make a match count AGAINST reliability (brief §8). */
export const RELIABILITY_FLAGS: readonly ProblemFlag[] = ['died', 'no_show', 'browned_out', 'e_stop'];
/** Flags that pause cycle timing while active (robot disabled). */
export const DISABLING_FLAGS: readonly ProblemFlag[] = ['died', 'browned_out', 'a_stop', 'e_stop'];

export const MECHANISMS = ['elevator', 'arm', 'ground_intake', 'oven_scoring', 'drivetrain', 'auto', 'endgame_haul'] as const;
export type Mechanism = (typeof MECHANISMS)[number];
export const MECHANISM_LABEL: Record<Mechanism, string> = {
  elevator: 'Elevator',
  arm: 'Arm',
  ground_intake: 'Ground intake',
  oven_scoring: 'Oven scoring',
  drivetrain: 'Drivetrain',
  auto: 'Auto',
  endgame_haul: 'Endgame haul',
};
export const MECH_STATUSES = ['worked', 'partial', 'failed', 'not_used'] as const;
export type MechStatus = (typeof MECH_STATUSES)[number];

export const ROLES = ['pantry', 'oven_feeder', 'cake_specialist', 'defense', 'hybrid'] as const;
export type RobotRole = (typeof ROLES)[number];
export const ROLE_LABEL: Record<RobotRole, string> = {
  pantry: 'Pantry scorer',
  oven_feeder: 'Oven feeder',
  cake_specialist: 'Cake specialist',
  defense: 'Defense / Thief',
  hybrid: 'Hybrid',
};

export const ZONES = ['kitchen', 'farm', 'neutral', 'table', 'ramp'] as const;
