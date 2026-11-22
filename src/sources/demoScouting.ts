'use client';
/**
 * Synthetic scouting for the DEMO sandbox, consistent with the official
 * breakdowns: each alliance's shelf/oven counts are split across its 3 robots
 * by seeded per-team "profiles", then turned into timestamped tap events
 * (intakes, multi-piece bursts, died/revive, park + haul). Coverage mixes
 * 1-robot and 3-robot scouts plus some duplicates, so merging, cycle
 * confidence, disagreement flags and driver rankings all have data.
 * Deterministic (seeded), local-only, never synced.
 */
import { APP_VERSION } from '@/config/defaults';
import { HARVEST_HAVOC as G, SHELVES, T_AUTO_END_MS, type Piece, type Target } from '@/game/harvestHavoc.config';
import { db } from '@/data/db';
import type { MatchRow, PitReport, RobotReport, ScoutEvent, ScoutSubmission, Station } from '@/data/types';
import { mulberry32, seedFrom, shuffle, type Rng } from '@/lib/rng';
import { nowIso } from '@/lib/util';
import { stableUuid } from '@/scouting/qr';
import type { OfficialData } from './DataSource';

interface Profile {
  skill: number; // 0..1
  ovenBias: number;
  cakeBias: number;
  l3Bias: number;
  cycleSec: number;
  carry: number; // pieces per trip 1..3
  defense: number;
  flaky: number;
  autoPieces: number;
  drivetrain: 'swerve' | 'tank' | 'mecanum';
  mechanism: 'elevator' | 'arm' | 'elevator_arm';
  groundIntake: boolean;
  intakeBreaks: boolean;
}

const SCOUTS = ['Ava R.', 'Ben K.', 'Chloe M.', 'Dev P.', 'Ella S.', 'Finn O.', 'Grace L.', 'Hugo T.', 'Isla W.', 'Jay N.'];
const NOTES_GOOD = ['Fast L3 cakes, smooth driver', 'Great oven feeder, kept the cake trade going', 'Quick cycles from the Source', 'Clean handoffs to partner', 'Very consistent, no wasted motion'];
const NOTES_MID = ['Decent but slow to line up on L2', 'Dropped a couple of carrots near the Pantry', 'Good auto, teleop average', 'Mostly L1 carrots', 'Parked late but made it'];
const NOTES_BAD = ['Struggled with ground intake', 'Died for ~20 s mid-match', 'Lots of missed placements', 'Played defense most of the match', 'Tipped near the ramp, recovered'];

export function profileFor(team: string): Profile {
  const r = mulberry32(seedFrom(`profile:${team}`));
  const skill = r();
  return {
    skill,
    ovenBias: r(),
    cakeBias: r() * (0.4 + skill * 0.6),
    l3Bias: r() * skill,
    cycleSec: 7 + (1 - skill) * 13 + r() * 3,
    carry: 1 + Math.floor(r() * 3),
    defense: skill < 0.35 ? r() * 0.7 : r() * 0.15,
    flaky: (1 - skill) * 0.25 * r(),
    autoPieces: skill > 0.6 ? 2 : skill > 0.3 ? 1 : 0,
    drivetrain: r() < 0.55 ? 'swerve' : r() < 0.8 ? 'tank' : 'mecanum',
    mechanism: r() < 0.45 ? 'elevator' : r() < 0.75 ? 'arm' : 'elevator_arm',
    groundIntake: r() < 0.6,
    intakeBreaks: r() < 0.2,
  };
}

/** Split an integer count among weights (largest-remainder, seeded tie-break). */
function split(n: number, weights: number[], rng: Rng): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (n * w) / total);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => [x - Math.floor(x) + rng() * 0.01, i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

export function eventsForRobot(sid: string, team: string, pieces: { piece: Piece; target: Target }[], p: Profile, rng: Rng, taxi: boolean, park: boolean, haul: { carrot: number; cake: number }, failed: boolean) {
  const ev: Omit<ScoutEvent, 'id'>[] = [];
  const add = (t: number, action: ScoutEvent['action'], extra: Partial<ScoutEvent> = {}) =>
    ev.push({ submission_id: sid, team_id: team, t_ms: Math.round(t), phase: t < T_AUTO_END_MS ? 'auto' : t >= 130_000 ? 'endgame' : 'teleop', action, piece: null, target: null, detail: null, ...extra });
  if (taxi) add(2000 + rng() * 3000, 'taxi');
  const list = shuffle(rng, pieces);
  // auto: up to 2 preloads (carrots)
  let autoN = 0;
  for (let i = 0; i < list.length && autoN < p.autoPieces; i++) {
    if (list[i].piece !== 'carrot') continue;
    add(5000 + autoN * 3500 + rng() * 2000, 'score', { piece: 'carrot', target: list[i].target });
    list.splice(i, 1);
    i--;
    autoN++;
  }
  let t = T_AUTO_END_MS + 1500 + rng() * 2000;
  let diedAt = failed ? 40_000 + rng() * 50_000 : Infinity;
  // seconds → ms; squeeze slow robots so their official pieces fit in teleop
  const perPieceMs = Math.min(p.cycleSec * 1000, 108_000 / Math.max(1, list.length));
  for (let i = 0; i < list.length; ) {
    const trip = list.slice(i, i + p.carry);
    const travel = perPieceMs * trip.length * (0.75 + rng() * 0.5);
    const src = rng() < 0.5 ? 'source' : rng() < 0.6 ? 'neutral' : p.groundIntake ? 'ground' : 'kitchen';
    add(t + travel * 0.35, 'intake', { detail: src });
    t += travel;
    if (t > diedAt) {
      add(diedAt, 'flag', { detail: 'died' });
      const back = diedAt + 12_000 + rng() * 15_000;
      if (back < 125_000) add(back, 'revive', { detail: 'died' });
      t = Math.max(t, back + 3000);
      diedAt = Infinity;
    }
    if (t > 128_000) break;
    trip.forEach((x, k) => add(t + k * (600 + rng() * 700), 'score', { piece: x.piece, target: x.target }));
    if (rng() < 0.06) add(t - 2000, 'drop');
    i += trip.length;
  }
  if (park) {
    const pt = 138_000 + rng() * 9000;
    for (let k = 0; k < haul.cake; k++) add(pt - 400 - k * 200, 'haul', { piece: 'cake', target: 'haul' });
    for (let k = 0; k < haul.carrot; k++) add(pt - 300 - k * 150, 'haul', { piece: 'carrot', target: 'haul' });
    add(pt, 'park');
  }
  return ev;
}

export async function generateDemoScouting(full: OfficialData, cutoff: number) {
  const now = nowIso();
  const subs: ScoutSubmission[] = [];
  const reports: RobotReport[] = [];
  const events: ScoutEvent[] = [];
  const matches: MatchRow[] = full.quals.filter((m) => m.played && m.breakdown && m.match_number <= cutoff);

  for (const m of matches) {
    const rng = mulberry32(seedFrom(`demo:${m.key}`));
    for (const side of ['red', 'blue'] as const) {
      const b = m.breakdown![side];
      const teams = m[side];
      const prof = teams.map(profileFor);
      // split official counts across the 3 robots
      const per: { piece: Piece; target: Target }[][] = [[], [], []];
      for (const shelf of SHELVES) {
        for (const piece of ['carrot', 'cake'] as const) {
          const w = prof.map((p) => (0.3 + p.skill) * (piece === 'cake' ? 0.2 + p.cakeBias : 1) * (shelf === 'L3' ? 0.3 + p.l3Bias : 1) * (1 - p.ovenBias * 0.6) * (1 - p.defense));
          split(b.pantry[piece][shelf], w, rng).forEach((n, i) => {
            for (let k = 0; k < n; k++) per[i].push({ piece, target: shelf });
          });
        }
      }
      for (const piece of ['carrot', 'cake'] as const) {
        split(b.oven[piece], prof.map((p) => 0.2 + p.ovenBias * 1.5), rng).forEach((n, i) => {
          for (let k = 0; k < n; k++) per[i].push({ piece, target: 'oven' });
        });
      }
      // who scouts this alliance: 3 solo scouts (60%), one 3-robot scout (30%), or 1 + 2 (10%)
      const roll = rng();
      const groups: number[][] = roll < 0.6 ? [[0], [1], [2]] : roll < 0.9 ? [[0, 1, 2]] : [[0], [1, 2]];
      // an occasional duplicate solo scout on one robot
      if (rng() < 0.12) groups.push([Math.floor(rng() * 3)]);
      const scouts = shuffle(rng, SCOUTS);
      groups.forEach((g, gi) => {
        const sid = stableUuid(`demo-sub:${m.key}:${side}:${gi}`);
        const groupTeams = g.map((i) => teams[i]);
        const dup = gi >= 3 || (gi > 0 && g.length === 1 && groups.slice(0, gi).some((x) => x.includes(g[0])));
        subs.push({
          id: sid,
          match_key: m.key,
          alliance: side,
          teams: groupTeams,
          stations: g.map((i) => `${side}${i + 1}` as Station),
          robot_count: g.length,
          scout_id: null,
          scout_name: scouts[gi % scouts.length],
          device_id: `demo-device-${gi}`,
          status: 'submitted',
          started_at: null,
          submitted_at: new Date(Date.UTC(2026, 11, 12, 15, 0, 0) + m.match_number * 7 * 60_000 + gi * 1000).toISOString(),
          source: 'app',
          discarded: false,
          discard_reason: null,
          app_version: `${APP_VERSION}-demo`,
          created_at: now,
          updated_at: now,
        });
        const pts: number[] = [];
        g.forEach((i) => {
          const p = prof[i];
          const team = teams[i];
          const failed = rng() < p.flaky;
          let pieces = per[i];
          if (dup) pieces = pieces.filter(() => rng() > 0.12); // a second scout misses a few taps
          const haul = { carrot: b.park[i] ? b.haul.carrot[i] : 0, cake: b.park[i] ? b.haul.cake[i] : 0 };
          const evs = eventsForRobot(sid, team, pieces, p, rng, b.taxi[i], b.park[i], haul, failed);
          evs.forEach((e, k) => events.push({ ...e, id: stableUuid(`demo-ev:${sid}:${team}:${k}`) }));
          pts.push(pieces.length);
          const defense = rng() < p.defense;
          const mechFail = p.intakeBreaks && rng() < 0.6;
          const quality = p.skill + (rng() - 0.5) * 0.3;
          reports.push({
            id: `${sid}:${team}`,
            submission_id: sid,
            team_id: team,
            station: `${side}${i + 1}` as Station,
            note: (quality > 0.66 ? NOTES_GOOD : quality > 0.33 ? NOTES_MID : NOTES_BAD)[Math.floor(rng() * 5)],
            driver_rating: Math.max(1, Math.min(5, Math.round(1 + quality * 4))),
            defense_played: defense,
            defense_type: defense ? (['thief', 'defense_oz', 'defense_nz'] as const)[Math.floor(rng() * 3)] : null,
            defense_rating: defense ? 1 + Math.floor(rng() * 5) : null,
            flags: failed ? ['died'] : [],
            mechanisms: {
              drivetrain: { status: 'worked' },
              ...(p.mechanism !== 'arm' ? { elevator: { status: rng() < 0.92 ? 'worked' : 'partial' } } : {}),
              ...(p.mechanism !== 'elevator' ? { arm: { status: rng() < 0.9 ? 'worked' : 'partial' } } : {}),
              ground_intake: p.groundIntake ? (mechFail ? { status: 'failed', note: 'jammed' } : { status: 'worked' }) : { status: 'not_used' },
              oven_scoring: p.ovenBias > 0.4 ? { status: 'worked' } : { status: 'not_used' },
              auto: { status: p.autoPieces ? 'worked' : 'partial' },
              endgame_haul: b.park[i] && haul.carrot + haul.cake > 0 ? { status: 'worked' } : { status: 'not_used' },
            },
            rank_quickness: null,
            rank_awareness: null,
            rank_defense_resistance: null,
            viewed: true,
            totals_override: null,
            updated_at: now,
          });
        });
        // relative ranks for multi-robot scouts (by skill with noise)
        if (g.length > 1) {
          const order = [...g].sort((a, z) => prof[z].skill + (rng() - 0.5) * 0.2 - (prof[a].skill + (rng() - 0.5) * 0.2));
          for (const r of reports.filter((x) => x.submission_id === sid)) {
            const idx = teams.indexOf(r.team_id);
            const rank = order.indexOf(idx) + 1;
            r.rank_quickness = rank;
            r.rank_awareness = Math.min(g.length, Math.max(1, rank + (rng() < 0.2 ? 1 : 0)));
            r.rank_defense_resistance = rank;
          }
        }
        void pts;
      });
    }
  }

  // pit reports from the same profiles
  const teams = await db.teams.toArray();
  const pit: PitReport[] = teams.map((t) => {
    const p = profileFor(t.id);
    const r = mulberry32(seedFrom(`pit:${t.id}`));
    return {
      id: stableUuid(`demo-pit:${t.id}`),
      team_id: t.id,
      author_id: null,
      author_name: SCOUTS[Math.floor(r() * SCOUTS.length)],
      data: {
        mechanism: p.mechanism,
        levels: p.l3Bias > 0.3 ? ['L1', 'L2', 'L3'] : p.skill > 0.3 ? ['L1', 'L2'] : ['L1'],
        handles: p.cakeBias > 0.25 ? 'both' : 'carrots',
        oven: p.ovenBias > 0.4 ? 'yes' : p.ovenBias > 0.2 ? 'unverified' : 'no',
        drivetrain: p.drivetrain,
        groundIntake: p.groundIntake,
        intakeSources: ['source', ...(p.groundIntake ? (['neutral', 'kitchen'] as const) : [])],
        canPark: true,
        maxHaul: Math.min(G.haul.maxPiecesPerRobot, p.carry),
        haulsCakes: p.cakeBias > 0.4,
        autoTaxi: true,
        autoScoresBothPreloads: p.autoPieces >= 2,
        autoTargets: p.autoPieces ? (['L1'] as Target[]) : [],
        role: p.defense > 0.4 ? 'defense' : p.ovenBias > 0.65 ? 'oven_feeder' : p.cakeBias > 0.6 ? 'cake_specialist' : 'pantry',
        handoff: r() < 0.3,
        humanPlayerQuality: 1 + Math.floor(r() * 5),
        weightLb: Math.round(80 + r() * 34),
        framePerimeterIn: Math.round(96 + r() * 24),
        startHeightIn: Math.round(30 + r() * 18),
        driverExperience: r() < 0.5 ? 'Rookie driver' : '2nd-year driver',
      },
      created_at: now,
      updated_at: now,
    };
  });

  await db.transaction('rw', [db.scout_submissions, db.robot_reports, db.scout_events, db.pit_reports], async () => {
    // replace previously generated demo scouting (keep anything the user scouted by hand)
    const old = await db.scout_submissions.filter((s) => s.app_version.endsWith('-demo')).primaryKeys();
    if (old.length) {
      await db.robot_reports.where('submission_id').anyOf(old).delete();
      await db.scout_events.where('submission_id').anyOf(old).delete();
      await db.scout_submissions.bulkDelete(old);
    }
    await db.scout_submissions.bulkPut(subs);
    await db.robot_reports.bulkPut(reports);
    await db.scout_events.bulkPut(events);
    await db.pit_reports.bulkPut(pit);
  });
}
