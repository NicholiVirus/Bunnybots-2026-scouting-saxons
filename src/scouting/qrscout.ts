/**
 * Compatibility with 449's QRScout "Harvest Havoc" form
 * (github.com/449-Data-Science/bunnybots_scouting_2026/qrscout_config.json).
 * QRScout encodes one robot per QR as tab-separated values in field order;
 * multi-selects are comma-joined choice keys. Their records carry totals only
 * (no timestamps) → imported with totals_override and no cycle data.
 */
import { SHELVES, type DefenseType, type ProblemFlag } from '@/game/harvestHavoc.config';
import type { RobotReport, ScoutSubmission, Station, TotalsOverride } from '@/data/types';
import type { ScoutingBundle } from '@/data/repo';
import { normalizeTeamId, type TeamIdContext } from '@/lib/teamIds';
import { stableUuid } from './qr';
import type { RobotTotals } from './derive';

/** Field order exactly as in 449's qrscout_config.json. */
export const QRSCOUT_FIELDS = [
  'scouter',
  'matchNumber',
  'robot',
  'teamNumber',
  'autoPantry',
  'autoOven',
  'L1C',
  'L2C',
  'L3C',
  'CO',
  'L1CC',
  'L2CC',
  'L3CC',
  'CCO',
  'IK',
  'INZ',
  'IS',
  'defenseStrat',
  'driverRating',
  'died',
  'park_carrots',
  'park_cakes',
  'comments',
] as const;

const DEFENSE_TO: Record<DefenseType, string> = { thief: '1', defense_oz: '2', defense_nz: '3' };
const DEFENSE_FROM: Record<string, DefenseType | null> = {
  '1': 'thief',
  thief: 'thief',
  '2': 'defense_oz',
  oz: 'defense_oz',
  'defense (oz)': 'defense_oz',
  '3': 'defense_nz',
  nz: 'defense_nz',
  'defense (nz)': 'defense_nz',
  '4': null,
  'no defense': null,
  'did not play defense': null,
};
const PROBLEM_TO: Partial<Record<ProblemFlag, string>> = { died: '1', no_show: '2', browned_out: '3', a_stop: '4', e_stop: '5', parts_fell_off: '6' };
const PROBLEM_FROM: Record<string, ProblemFlag> = {
  '1': 'died',
  died: 'died',
  '2': 'no_show',
  'no show': 'no_show',
  '3': 'browned_out',
  'browned out': 'browned_out',
  '4': 'a_stop',
  'a-stop': 'a_stop',
  '5': 'e_stop',
  'e-stop': 'e_stop',
  '6': 'parts_fell_off',
  'parts fell off': 'parts_fell_off',
};
const STATION_FROM: Record<string, Station> = {
  r1: 'red1',
  r2: 'red2',
  r3: 'red3',
  b1: 'blue1',
  b2: 'blue2',
  b3: 'blue3',
  'red 1': 'red1',
  'red 2': 'red2',
  'red 3': 'red3',
  'blue 1': 'blue1',
  'blue 2': 'blue2',
  'blue 3': 'blue3',
};
const STATION_TO: Record<Station, string> = { red1: 'R1', red2: 'R2', red3: 'R3', blue1: 'B1', blue2: 'B2', blue3: 'B3' };

const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
const int = (s: string | undefined) => Math.max(0, Math.round(Number(s) || 0));

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NS';
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** One of our robots → a QRScout tab-delimited record. */
export function toQrScout(opts: {
  scoutName: string;
  matchNumber: number;
  station: Station;
  team: string;
  totals: RobotTotals;
  report: RobotReport | undefined;
}): string {
  const t = opts.totals;
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const autoPantry = sum(t.auto.pantry.carrot) + sum(t.auto.pantry.cake) + t.auto.unknownLevelCarrots;
  const r = opts.report;
  const defense = r?.defense_played && r.defense_type ? DEFENSE_TO[r.defense_type] : '4';
  const died = (r?.flags ?? t.flags).map((f) => PROBLEM_TO[f]).filter(Boolean).join(',');
  const values: Record<(typeof QRSCOUT_FIELDS)[number], string | number> = {
    scouter: initials(opts.scoutName),
    matchNumber: opts.matchNumber,
    robot: STATION_TO[opts.station],
    teamNumber: opts.team,
    autoPantry,
    autoOven: t.auto.oven.carrot + t.auto.oven.cake,
    L1C: t.teleop.pantry.carrot.L1,
    L2C: t.teleop.pantry.carrot.L2,
    L3C: t.teleop.pantry.carrot.L3,
    CO: t.teleop.oven.carrot,
    L1CC: t.teleop.pantry.cake.L1,
    L2CC: t.teleop.pantry.cake.L2,
    L3CC: t.teleop.pantry.cake.L3,
    CCO: t.teleop.oven.cake,
    IK: t.intakes.kitchen,
    INZ: t.intakes.neutral,
    IS: t.intakes.source,
    defenseStrat: defense,
    driverRating: r?.driver_rating ?? 1,
    died,
    park_carrots: t.parked ? t.haul.carrot : 0,
    park_cakes: t.parked ? t.haul.cake : 0,
    comments: clean(r?.note ?? ''),
  };
  return QRSCOUT_FIELDS.map((f) => String(values[f])).join('\t');
}

export function looksLikeQrScout(text: string): boolean {
  const cells = text.split('\t');
  return cells.length >= QRSCOUT_FIELDS.length - 1 && !!STATION_FROM[cells[2]?.trim().toLowerCase()];
}

/** A scanned QRScout record → a totals-only submission (source "qrscout"). */
export function fromQrScout(text: string, ctx: TeamIdContext, appVersion: string): ScoutingBundle {
  const cells = text.replace(/\r?\n$/, '').split('\t');
  if (cells.length < QRSCOUT_FIELDS.length - 1) throw new Error(`Expected ${QRSCOUT_FIELDS.length} tab-separated fields, got ${cells.length}`);
  const v = Object.fromEntries(QRSCOUT_FIELDS.map((f, i) => [f, (cells[i] ?? '').trim()])) as Record<(typeof QRSCOUT_FIELDS)[number], string>;
  const station = STATION_FROM[v.robot.toLowerCase()];
  if (!station) throw new Error(`Unknown robot position "${v.robot}"`);
  const team = normalizeTeamId(v.teamNumber, ctx);
  if (!team) throw new Error('Missing team number');
  const matchNumber = int(v.matchNumber);
  const id = stableUuid(`qrscout:${v.scouter}:${matchNumber}:${station}:${team}`);
  const flags = [...new Set(v.died.split(',').map((x) => PROBLEM_FROM[x.trim().toLowerCase()]).filter(Boolean))] as ProblemFlag[];
  const defenseKeys = v.defenseStrat.split(',').map((x) => x.trim().toLowerCase());
  const defense = defenseKeys.map((k) => DEFENSE_FROM[k]).find((x) => x) ?? null;
  const haulC = int(v.park_carrots);
  const haulK = int(v.park_cakes);
  const totals: TotalsOverride = {
    auto: { pantryCarrotUnknownLevel: int(v.autoPantry), ovenCarrot: int(v.autoOven) },
    teleop: {
      carrot: Object.fromEntries(SHELVES.map((s) => [s, int(v[`${s}C` as 'L1C'])])) as TotalsOverride['teleop']['carrot'],
      cake: Object.fromEntries(SHELVES.map((s) => [s, int(v[`${s}CC` as 'L1CC'])])) as TotalsOverride['teleop']['cake'],
      ovenCarrot: int(v.CO),
      ovenCake: int(v.CCO),
    },
    intake: { kitchen: int(v.IK), neutral: int(v.INZ), source: int(v.IS) },
    haul: { carrot: haulC, cake: haulK },
    parked: haulC + haulK > 0 ? true : null,
    taxi: null,
  };
  const now = new Date().toISOString();
  const submission: ScoutSubmission = {
    id,
    match_key: `Q${matchNumber}`,
    alliance: station.startsWith('red') ? 'red' : 'blue',
    teams: [team],
    stations: [station],
    robot_count: 1,
    scout_id: null,
    scout_name: v.scouter || 'QRScout',
    device_id: 'qrscout',
    status: 'submitted',
    started_at: null,
    submitted_at: now,
    source: 'qrscout',
    discarded: false,
    discard_reason: null,
    app_version: appVersion,
    created_at: now,
    updated_at: now,
  };
  const report: RobotReport = {
    id: `${id}:${team}`,
    submission_id: id,
    team_id: team,
    station,
    note: v.comments,
    driver_rating: v.driverRating ? Math.min(5, Math.max(1, int(v.driverRating))) : null,
    defense_played: !!defense,
    defense_type: defense,
    defense_rating: null,
    flags,
    mechanisms: {},
    rank_quickness: null,
    rank_awareness: null,
    rank_defense_resistance: null,
    viewed: true,
    totals_override: totals,
    updated_at: now,
  };
  return { submission, reports: [report], events: [] };
}
