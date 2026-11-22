/**
 * Convert raw records from ANY source (Bunnybots Alliance JSON, its ?format=csv,
 * 449's simulated CSVs, manual entry) into our rows. Team ids go through the
 * alias map; scores are re-checked against harvestHavoc.config.ts.
 */
import { SHELVES } from '@/game/harvestHavoc.config';
import {
  allianceScore,
  computeRpFlags,
  emptyBreakdown,
  playoffTiebreak,
  type AllianceBreakdown,
} from '@/game/scoring';
import type { Alliance, CompLevel, MatchRow, OfficialAlliance, RankingRow, SourceKind } from '@/data/types';
import { normalizeTeamId, type TeamIdContext } from '@/lib/teamIds';
import { nowIso } from '@/lib/util';

export type Raw = Record<string, unknown>;

/** Case/format-insensitive field lookup ("Ranking Score" == ranking_score == RankingScore). */
export function pick(raw: Raw, ...names: string[]): unknown {
  for (const n of names) if (n in raw) return raw[n];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const idx = new Map(Object.keys(raw).map((k) => [norm(k), k]));
  for (const n of names) {
    const k = idx.get(norm(n));
    if (k !== undefined) return raw[k];
  }
  return undefined;
}

export function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'y';
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s.toLowerCase() === 'na' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const int0 = (v: unknown) => Math.max(0, Math.round(toNum(v) ?? 0));

/** "Q12" for quals, the playoff label for playoffs (prefixed if it could collide). */
export function matchKey(compLevel: CompLevel, number: number, label?: string | null): string {
  if (compLevel === 'qm') return `Q${number}`;
  const l = String(label || `M${number}`).replace(/\s+/g, '').toUpperCase();
  return /^Q\d+$/.test(l) ? `P${l}` : l;
}

function breakdownFor(raw: Raw, side: Alliance): AllianceBreakdown {
  const s = side === 'red' ? 'R' : 'B';
  const b = emptyBreakdown();
  b.taxi = [1, 2, 3].map((i) => toBool(pick(raw, `taxi_${s}${i}`)));
  b.park = [1, 2, 3].map((i) => toBool(pick(raw, `park_${s}${i}`)));
  b.haul = {
    carrot: [1, 2, 3].map((i) => int0(pick(raw, `carrot_haul_${s}${i}`))),
    cake: [1, 2, 3].map((i) => int0(pick(raw, `cake_haul_${s}${i}`))),
  };
  for (const shelf of SHELVES) {
    b.pantry.carrot[shelf] = int0(pick(raw, `carrot_${shelf}_${side}`));
    b.pantry.cake[shelf] = int0(pick(raw, `cake_${shelf}_${side}`));
  }
  b.oven = { carrot: int0(pick(raw, `carrot_oven_${side}`)), cake: int0(pick(raw, `cake_oven_${side}`)) };
  b.fouls = { minor: int0(pick(raw, `minor_${side}`)), major: int0(pick(raw, `major_${side}`)) };
  const rpRaw = [pick(raw, `stocked_rp_${side}`), pick(raw, `baked_rp_${side}`), pick(raw, `dinner_rp_${side}`)];
  b.rp = rpRaw.some((x) => x !== undefined && x !== null && x !== '')
    ? { stocked: toBool(rpRaw[0]), baked: toBool(rpRaw[1]), dinner: toBool(rpRaw[2]) }
    : null;
  const slot = (k: string) => {
    const v = pick(raw, k);
    return v === undefined || v === null || v === '' ? null : String(v);
  };
  const slots = {
    L1: slot(`slots_L1_${side}`),
    L2: slot(`slots_L2_${side}`),
    L3: slot(`slots_L3_${side}`),
    haul: [1, 2, 3].map((i) => slot(`slots_haul_${s}${i}`)),
  };
  b.slots = slots.L1 || slots.L2 || slots.L3 || slots.haul.some(Boolean) ? slots : null;
  return b;
}

export interface MatchImportOptions {
  compLevel: CompLevel;
  source: SourceKind;
  ctx: TeamIdContext;
  /**
   * true  → replace scores/RP flags with values recomputed from our config
   *         (used for 449's simulated data, which scored oven cakes at 2).
   * false → keep the official numbers (source of truth) and only warn.
   */
  recompute?: boolean;
}

/** One raw match record → MatchRow (null if it has no match number). */
export function matchFromRaw(raw: Raw, o: MatchImportOptions): MatchRow | null {
  const number = toNum(pick(raw, 'match_number', 'match', 'matchnumber', 'number', 'TypeOrder'));
  const labelRaw = pick(raw, 'match_label', 'label', 'ShortName');
  if (number === null && !labelRaw) return null;
  const n = number ?? (Number(String(labelRaw).replace(/\D/g, '')) || 0);
  const label = labelRaw ? String(labelRaw) : o.compLevel === 'qm' ? `Q${n}` : `M${n}`;
  const team = (k: string, alt: string) => normalizeTeamId(pick(raw, k, alt), o.ctx) ?? '';
  const red = [team('red1', 'R1'), team('red2', 'R2'), team('red3', 'R3')];
  const blue = [team('blue1', 'B1'), team('blue2', 'B2'), team('blue3', 'B3')];

  let redScore = toNum(pick(raw, 'red_score', 'redscore'));
  let blueScore = toNum(pick(raw, 'blue_score', 'bluescore'));
  const playedField = pick(raw, 'played');
  const played = playedField !== undefined && playedField !== null && playedField !== '' ? toBool(playedField) && redScore !== null && blueScore !== null : redScore !== null && blueScore !== null;

  const warnings: string[] = [];
  let breakdown: MatchRow['breakdown'] = null;
  const hasDetail = pick(raw, 'carrot_L1_red') !== undefined || pick(raw, 'taxi_R1') !== undefined;
  if (played && hasDetail) {
    const rb = breakdownFor(raw, 'red');
    const bb = breakdownFor(raw, 'blue');
    const rs = allianceScore(rb, bb.fouls).total;
    const bs = allianceScore(bb, rb.fouls).total;
    if (redScore !== rs) warnings.push(`Red score: reported ${redScore}, rules give ${rs} (Δ ${rs - (redScore ?? 0)})`);
    if (blueScore !== bs) warnings.push(`Blue score: reported ${blueScore}, rules give ${bs} (Δ ${bs - (blueScore ?? 0)})`);
    for (const [side, b] of [
      ['Red', rb],
      ['Blue', bb],
    ] as const) {
      const f = computeRpFlags(b);
      if (b.rp && (b.rp.stocked !== f.stocked || b.rp.baked !== f.baked || b.rp.dinner !== f.dinner))
        warnings.push(`${side} RP flags differ from the rules (reported S${+b.rp.stocked} B${+b.rp.baked} D${+b.rp.dinner})`);
      if (o.recompute || !b.rp) b.rp = f;
    }
    if (o.recompute) {
      redScore = rs;
      blueScore = bs;
    }
    breakdown = { red: rb, blue: bb };
  }

  let winner: MatchRow['winner'] = null;
  if (played && redScore !== null && blueScore !== null) {
    if (redScore > blueScore) winner = 'red';
    else if (blueScore > redScore) winner = 'blue';
    else if (o.compLevel === 'po' && breakdown) {
      const r = allianceScore(breakdown.red, breakdown.blue.fouls);
      const b = allianceScore(breakdown.blue, breakdown.red.fouls);
      const t = playoffTiebreak(
        { majorFouls: breakdown.red.fouls.major, pantry: r.pantry, oven: r.oven },
        { majorFouls: breakdown.blue.fouls.major, pantry: b.pantry, oven: b.oven },
      );
      winner = t > 0 ? 'red' : t < 0 ? 'blue' : 'tie';
    } else winner = 'tie';
  }

  return {
    key: matchKey(o.compLevel, n, label),
    comp_level: o.compLevel,
    match_number: n,
    label,
    red,
    blue,
    scheduled_time: (pick(raw, 'time', 'scheduled_time', 'start_time') as string) ?? null,
    played,
    red_score: played ? redScore : null,
    blue_score: played ? blueScore : null,
    breakdown,
    rp: breakdown ? { red: breakdown.red.rp!, blue: breakdown.blue.rp! } : null,
    winner,
    dq: [],
    source: o.source,
    locked: false,
    warnings: warnings.length ? warnings : [],
    updated_at: nowIso(),
  };
}

export function rankingFromRaw(raw: Raw, ctx: TeamIdContext, source: SourceKind): RankingRow | null {
  const team = normalizeTeamId(pick(raw, 'team_key', 'team', 'TeamId', 'team_id'), ctx);
  if (!team) return null;
  const played = int0(pick(raw, 'matches_played', 'played', 'Played', 'plays'));
  const dq = int0(pick(raw, 'dq', 'Disqualifications'));
  const total = toNum(pick(raw, 'ranking_total', 'Ranking Total', 'RankingPoints', 'rp', 'total_rp')) ?? 0;
  const scoreRaw = toNum(pick(raw, 'ranking_score', 'Ranking Score', 'RankingScore', 'average_rp'));
  const wins = int0(pick(raw, 'wins', 'Wins'));
  const losses = int0(pick(raw, 'losses', 'Losses'));
  const tiesRaw = toNum(pick(raw, 'ties', 'Ties'));
  return {
    team_id: team,
    rank: int0(pick(raw, 'rank', 'Rank')),
    ranking_score: scoreRaw ?? (played + dq > 0 ? total / (played + dq) : 0),
    ranking_total: total,
    wins,
    losses,
    ties: tiesRaw !== null ? Math.round(tiesRaw) : Math.max(0, played - wins - losses - dq),
    dq,
    matches_played: played,
    avg_match: toNum(pick(raw, 'avg_match', 'Avg Match', 'average_match', 'MatchPoints')) ?? 0,
    source,
    updated_at: nowIso(),
  };
}

export function allianceFromRaw(raw: Raw, ctx: TeamIdContext, source: SourceKind, fallbackNumber: number): OfficialAlliance | null {
  const a = pick(raw, 'alliance', 'Alliance', 'Id', 'number');
  const num = Number(String(a ?? fallbackNumber).replace(/\D/g, '')) || fallbackNumber;
  const ids = pick(raw, 'TeamIds') as unknown[] | undefined;
  const t = (k: string, alt: string, i: number) => normalizeTeamId(ids ? ids[i] : pick(raw, k, alt), ctx);
  const captain = t('captain', 'Captain', 0);
  if (!captain) return null;
  return {
    number: num,
    captain,
    first_pick: t('first_pick', 'First Pick', 1),
    second_pick: t('second_pick', 'Second Pick', 2),
    source,
    updated_at: nowIso(),
  };
}

/**
 * Merge rule for official results: the newest official data wins, EXCEPT a
 * manual result an admin locked. Scouting data never touches these rows.
 */
export function mergeMatch(existing: MatchRow | undefined, incoming: MatchRow): MatchRow | null {
  if (!existing) return incoming;
  if (existing.locked && existing.source === 'manual') return null;
  if (incoming.source === 'api' && !incoming.played && existing.played && existing.source === 'manual') return null;
  const same =
    existing.played === incoming.played &&
    existing.red_score === incoming.red_score &&
    existing.blue_score === incoming.blue_score &&
    existing.red.join() === incoming.red.join() &&
    existing.blue.join() === incoming.blue.join() &&
    JSON.stringify(existing.breakdown ?? null) === JSON.stringify(incoming.breakdown ?? null) &&
    JSON.stringify(existing.rp ?? null) === JSON.stringify(incoming.rp ?? null) &&
    existing.source === incoming.source;
  return same ? null : { ...incoming, scheduled_time: incoming.scheduled_time ?? existing.scheduled_time ?? null, dq: existing.dq?.length ? existing.dq : incoming.dq };
}
