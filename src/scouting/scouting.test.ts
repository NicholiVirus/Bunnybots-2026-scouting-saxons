import { describe, expect, it } from 'vitest';
import type { ScoutEvent, ScoutSubmission, RobotReport, MatchRow, Station } from '@/data/types';
import { computeCycles, disabledIntervals } from './cycles';
import { makeEvent, removeLatest, robotPoints, totalsFromEvents, countMatching } from './derive';
import { buildRecords } from './records';
import { mergePit, validatePit } from '@/catalog/pit';

const S = 'sub-1';
let n = 0;
const ev = (t_s: number, action: ScoutEvent['action'], extra: Partial<ScoutEvent> = {}): ScoutEvent => ({
  ...makeEvent(S, t_s * 1000, null, { team_id: '611', action }),
  id: `e${String(++n).padStart(4, '0')}`,
  ...extra,
});
const score = (t: number, piece: 'carrot' | 'cake' = 'carrot', target: ScoutEvent['target'] = 'L1') => ev(t, 'score', { piece, target });
const opts = { burstWindowMs: 3000, outlierCapMs: 60_000 };

describe('cycle timing', () => {
  it('first cycle starts at teleop start (0:15); cycles between placements', () => {
    const r = computeCycles([score(25), score(40), score(55)], opts);
    expect(r.cycles.map((c) => c.durationMs / 1000)).toEqual([10, 15, 15]);
  });

  it('ignores auto placements', () => {
    const r = computeCycles([score(5), score(10), score(25)], opts);
    expect(r.cycles.map((c) => c.durationMs / 1000)).toEqual([10]);
  });

  it('merges a 3-piece burst into one cycle (window 0 = literal definition)', () => {
    const evs = [score(25), score(26), score(27, 'cake', 'L3'), score(45)];
    const r = computeCycles(evs, opts);
    expect(r.cycles.map((c) => c.durationMs / 1000)).toEqual([12, 18]);
    expect(r.cycles[0].pieces).toEqual(['carrot', 'carrot', 'cake']);
    const literal = computeCycles(evs, { ...opts, burstWindowMs: 0 });
    expect(literal.cycles.map((c) => c.durationMs / 1000)).toEqual([10, 1, 1, 18]);
  });

  it('an intake between quick placements breaks the burst', () => {
    const r = computeCycles([score(25), ev(25.5, 'intake', { detail: 'kitchen' }), score(26)], opts);
    expect(r.cycles).toHaveLength(2);
  });

  it('excludes time while Died (until Revived)', () => {
    const evs = [score(30), ev(35, 'flag', { detail: 'died' }), ev(55, 'revive', { detail: 'died' }), score(60)];
    expect(disabledIntervals(evs)).toEqual([[35_000, 55_000]]);
    const r = computeCycles(evs, opts);
    expect(r.cycles.map((c) => c.durationMs / 1000)).toEqual([15, 10]);
  });

  it('E-stop disables to the end of the match; A-stop only to end of auto', () => {
    expect(disabledIntervals([ev(70, 'flag', { detail: 'e_stop' })])).toEqual([[70_000, 150_000]]);
    expect(disabledIntervals([ev(5, 'flag', { detail: 'a_stop' })])).toEqual([[5_000, 15_000]]);
  });

  it('caps outliers as long gaps', () => {
    const r = computeCycles([score(100), score(110)], opts);
    expect(r.longGaps.map((c) => c.durationMs / 1000)).toEqual([85]);
    expect(r.cycles.map((c) => c.durationMs / 1000)).toEqual([10]);
  });

  it('endgame haul is the last cycle: last placement → parked with pieces', () => {
    const r = computeCycles([score(120), ev(141, 'haul', { piece: 'cake', target: 'haul' }), ev(142, 'haul', { piece: 'carrot', target: 'haul' }), ev(145, 'park')], opts);
    const haul = r.cycles.find((c) => c.kind === 'haul')!;
    expect(haul.durationMs).toBe(25_000);
    expect(haul.pieces).toEqual(['cake', 'carrot']);
  });

  it('splits pickup (last score → last intake) and delivery (intake → score)', () => {
    const r = computeCycles([score(30), ev(33, 'intake', { detail: 'source' }), ev(36, 'intake', { detail: 'neutral' }), score(44)], opts);
    expect(r.cycles[1]).toMatchObject({ durationMs: 14_000, pickupMs: 6_000, deliveryMs: 8_000 });
  });
});

describe('event log → totals', () => {
  it('derives totals and points; [−] removes the latest matching event', () => {
    let evs = [ev(3, 'taxi'), score(8, 'carrot', 'L2'), score(20, 'cake', 'L3'), score(30, 'cake', 'L3'), ev(40, 'score', { piece: 'carrot', target: 'oven' }), ev(146, 'park'), ev(146.5, 'haul', { piece: 'cake', target: 'haul' })];
    let t = totalsFromEvents(evs);
    expect(t.auto.taxi).toBe(true);
    expect(t.auto.pantry.carrot.L2).toBe(1);
    expect(t.teleop.pantry.cake.L3).toBe(2);
    expect(t.teleop.oven.carrot).toBe(1);
    const p = robotPoints(t);
    expect(p.auto).toBe(2 + 4);
    expect(p.teleop).toBe(24 + 2);
    expect(p.endgame).toBe(2 + 3);
    expect(p.total).toBe(6 + 26 + 5);
    evs = removeLatest(evs, { team_id: '611', action: 'score', piece: 'cake', target: 'L3' });
    t = totalsFromEvents(evs);
    expect(t.teleop.pantry.cake.L3).toBe(1);
    expect(countMatching(evs, { action: 'score', piece: 'cake' })).toBe(1);
    // the remaining L3 cake is the EARLIER one (20 s)
    expect(evs.find((e) => e.target === 'L3')!.t_ms).toBe(20_000);
  });

  it('caps the haul at 3 pieces', () => {
    const t = totalsFromEvents([ev(146, 'park'), ...[1, 2, 3, 4].map((i) => ev(146 + i / 10, 'haul', { piece: 'carrot', target: 'haul' }))]);
    expect(t.haul.carrot).toBe(3);
  });
});

describe('duplicate coverage merge', () => {
  const match: MatchRow = {
    key: 'Q1',
    comp_level: 'qm',
    match_number: 1,
    label: 'Q1',
    red: ['611', '449', '321'],
    blue: ['526', '3504', '686'],
    played: true,
    red_score: 1,
    blue_score: 0,
    source: 'manual',
    updated_at: '',
  };
  const sub = (id: string, teams: string[], scout: string): ScoutSubmission => ({
    id,
    match_key: 'Q1',
    alliance: 'red',
    teams,
    stations: teams.map((_, i) => `red${i + 1}` as Station),
    robot_count: teams.length,
    scout_id: null,
    scout_name: scout,
    device_id: 'd',
    status: 'submitted',
    started_at: 0,
    submitted_at: `2026-12-12T10:0${teams.length}:00Z`,
    source: 'app',
    discarded: false,
    discard_reason: null,
    app_version: 't',
    created_at: '',
    updated_at: '',
  });
  const rep = (sid: string, team: string, flags: RobotReport['flags'] = []): RobotReport => ({
    id: `${sid}:${team}`,
    submission_id: sid,
    team_id: team,
    station: 'red1',
    note: `${sid} note`,
    driver_rating: 4,
    defense_played: false,
    defense_type: null,
    defense_rating: null,
    flags,
    mechanisms: {},
    rank_quickness: null,
    rank_awareness: null,
    rank_defense_resistance: null,
    viewed: true,
    totals_override: null,
    updated_at: '',
  });
  const e = (sid: string, t: number, target: ScoutEvent['target'] = 'L1'): ScoutEvent => ({
    id: `${sid}-${t}`,
    submission_id: sid,
    team_id: '611',
    t_ms: t * 1000,
    phase: t < 15 ? 'auto' : 'teleop',
    action: 'score',
    piece: 'carrot',
    target,
    detail: null,
  });

  it('averages counts, takes cycles from the 1-robot scout, flags disagreement', () => {
    const solo = sub('A', ['611'], 'Solo');
    const tri = sub('B', ['611', '449', '321'], 'Tri');
    const events = [e('A', 25), e('A', 35), e('A', 45), e('B', 30), e('B', 50), e('B', 70), e('B', 90), e('B', 110), e('B', 120)];
    const recs = buildRecords({
      submissions: [solo, tri],
      reports: [rep('A', '611'), rep('B', '611', ['browned_out']), rep('B', '449'), rep('B', '321')],
      events,
      matches: [match],
      cycleOpts: { burstWindowMs: 0, outlierCapMs: 60_000 },
      disagreePoints: 5,
    });
    const r = recs.find((x) => x.team === '611')!;
    expect(r.scouts).toHaveLength(2);
    expect(r.totals.teleop.pantry.carrot.L1).toBe(4.5); // (3 + 6) / 2
    expect(r.cycleRobotCount).toBe(1); // the solo scout's timestamps
    expect(r.cycles!.cycles.map((c) => c.durationMs / 1000)).toEqual([10, 10, 10]);
    expect(r.disagree).toBe(true); // 9 vs 18 points
    expect(r.flagDisagree).toBe(true);
    expect(r.notes).toHaveLength(2);
  });
});

describe('pit catalog', () => {
  it('merges reports field-wise (newest wins) and validates robot limits', () => {
    const base = { team_id: '611', author_id: null, author_name: 'x', created_at: '' };
    const merged = mergePit([
      { ...base, id: '1', data: { drivetrain: 'tank', oven: 'yes' }, updated_at: '2026-12-12T09:00:00Z' },
      { ...base, id: '2', data: { drivetrain: 'swerve' }, updated_at: '2026-12-12T10:00:00Z' },
    ]);
    expect(merged).toEqual({ drivetrain: 'swerve', oven: 'yes' });
    expect(validatePit({ framePerimeterIn: 125, startHeightIn: 50, weightLb: 116 })).toHaveLength(3);
    expect(validatePit({ framePerimeterIn: 120, startHeightIn: 48, weightLb: 115 })).toHaveLength(0);
  });
});
