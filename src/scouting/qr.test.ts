import { describe, expect, it } from 'vitest';
import type { ScoutEvent } from '@/data/types';
import { defaultTeamIdContext } from '@/lib/teamIds';
import { base45Decode, base45Encode } from './base45';
import { QrAssembler, decodeQrData, encodeBundleToQr, parseQrPart, packBundle, unpackBundle } from './qr';
import { fromQrScout, looksLikeQrScout, toQrScout, QRSCOUT_FIELDS } from './qrscout';
import { newDraft } from './session';
import { totalsFromEvents, robotPoints } from './derive';
import { computeCycles } from './cycles';

function bigBundle() {
  const b = newDraft('Q12', 'blue', ['611', '449b', '526'], ['blue1', 'blue2', 'blue3']);
  b.submission.status = 'submitted';
  b.submission.started_at = 1_765_550_000_000;
  b.submission.submitted_at = '2026-12-12T15:00:00.000Z';
  let k = 0;
  const events: ScoutEvent[] = [];
  for (const [ti, team] of b.submission.teams.entries()) {
    events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: 2500 + ti * 300, phase: 'auto', action: 'taxi', piece: null, target: null, detail: null });
    for (let i = 0; i < 25; i++) {
      const t = 16_000 + i * 4300 + ti * 700;
      events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: t - 1500, phase: 'teleop', action: 'intake', piece: null, target: null, detail: i % 2 ? 'source' : 'neutral' });
      events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: t, phase: t >= 130_000 ? 'endgame' : 'teleop', action: 'score', piece: i % 3 ? 'carrot' : 'cake', target: (['L1', 'L2', 'L3', 'oven'] as const)[i % 4], detail: null });
    }
    events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: 60_000, phase: 'teleop', action: 'flag', piece: null, target: null, detail: 'died' });
    events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: 70_000, phase: 'teleop', action: 'revive', piece: null, target: null, detail: 'died' });
    events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: 146_000, phase: 'endgame', action: 'park', piece: null, target: null, detail: null });
    events.push({ id: `x${k++}`, submission_id: b.submission.id, team_id: team, t_ms: 146_200, phase: 'endgame', action: 'haul', piece: 'cake', target: 'haul', detail: null });
  }
  b.events = events;
  b.reports = b.reports.map((r, i) => ({
    ...r,
    note: `Robot ${i} note — fast L3 cakes, "quotes" & tabs\there`,
    driver_rating: 4,
    defense_played: i === 2,
    defense_type: i === 2 ? 'defense_nz' : null,
    defense_rating: i === 2 ? 3 : null,
    flags: ['died'],
    mechanisms: { elevator: { status: 'worked' }, ground_intake: { status: 'failed', note: 'jammed twice' } },
    rank_quickness: i + 1,
    rank_awareness: 3 - i,
    rank_defense_resistance: i + 1,
    viewed: true,
  }));
  return b;
}

describe('base45', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from({ length: 1001 }, (_, i) => (i * 37) % 256);
    expect(base45Decode(base45Encode(bytes))).toEqual(bytes);
    expect(base45Encode(new TextEncoder().encode('AB'))).toBe('BB8'); // RFC 9285 example
  });
});

describe('Saxon QR format', () => {
  it('round-trips a 3-robot submission with its full event log', () => {
    const b = bigBundle();
    const parts = encodeBundleToQr(b);
    expect(parts.length).toBeGreaterThanOrEqual(1);
    for (const p of parts) expect(p).toMatch(/^[0-9A-Z $%*+\-./:]+$/); // QR alphanumeric only
    const asm = new QrAssembler();
    let done = null;
    // scan out of order, with a duplicate
    for (const p of [...parts].reverse().concat(parts[0])) {
      const r = asm.add(p);
      if (r?.status === 'done') done = r.bundle;
    }
    expect(done).not.toBeNull();
    const back = done!;
    expect(back.submission).toMatchObject({ id: b.submission.id, match_key: 'Q12', alliance: 'blue', teams: b.submission.teams, robot_count: 3, source: 'qr' });
    expect(back.events).toHaveLength(b.events.length);
    for (const team of b.submission.teams) {
      const a = totalsFromEvents(b.events.filter((e) => e.team_id === team));
      const z = totalsFromEvents(back.events.filter((e) => e.team_id === team));
      expect(robotPoints(z)).toEqual(robotPoints(a));
      const opts = { burstWindowMs: 3000, outlierCapMs: 60_000 };
      expect(computeCycles(back.events.filter((e) => e.team_id === team), opts).cycles.map((c) => c.durationMs)).toEqual(
        computeCycles(b.events.filter((e) => e.team_id === team), opts).cycles.map((c) => c.durationMs),
      );
    }
    expect(back.reports[2]).toMatchObject({ defense_played: true, defense_type: 'defense_nz', defense_rating: 3, flags: ['died'], rank_quickness: 3 });
    expect(back.reports[0].mechanisms.ground_intake).toEqual({ status: 'failed', note: 'jammed twice' });
    expect(back.reports[0].note).toContain('"quotes"');
  });

  it('is idempotent: re-importing yields the same event ids', () => {
    const b = bigBundle();
    const data = encodeBundleToQr(b, 100_000)[0];
    const a1 = decodeQrData(parseQrPart(data)!.data);
    const a2 = decodeQrData(parseQrPart(data)!.data);
    expect(a1.events.map((e) => e.id)).toEqual(a2.events.map((e) => e.id));
  });

  it('compresses well (≈ 10 chars per tap before deflate)', () => {
    const b = bigBundle();
    const json = packBundle(b);
    expect(json.length / b.events.length).toBeLessThan(25);
    const qrChars = encodeBundleToQr(b, 100_000)[0].length;
    expect(qrChars).toBeLessThan(json.length);
    expect(unpackBundle(json).events.length).toBe(b.events.length);
  });
});

describe('449 QRScout compatibility', () => {
  const ctx = defaultTeamIdContext();
  it('imports a QRScout record (tab-separated, field order from their config)', () => {
    // scouter, match, robot, team, autoPantry, autoOven, L1C L2C L3C CO, L1CC L2CC L3CC CCO, IK INZ IS, defense, driver, died, park carrots/cakes, comments
    const text = ['NS', '7', 'B2', '449b', '2', '0', '1', '2', '3', '4', '0', '1', '2', '1', '5', '2', '1', '2', '4', '1,3', '1', '1', 'good bot'].join('\t');
    expect(text.split('\t')).toHaveLength(QRSCOUT_FIELDS.length);
    expect(looksLikeQrScout(text)).toBe(true);
    const b = fromQrScout(text, ctx, 'test');
    expect(b.submission).toMatchObject({ match_key: 'Q7', alliance: 'blue', teams: ['449b'], stations: ['blue2'], robot_count: 1, source: 'qrscout' });
    const r = b.reports[0];
    expect(r).toMatchObject({ team_id: '449b', driver_rating: 4, defense_played: true, defense_type: 'defense_oz', note: 'good bot' });
    expect(r.flags.sort()).toEqual(['browned_out', 'died']);
    expect(r.totals_override).toMatchObject({
      auto: { pantryCarrotUnknownLevel: 2, ovenCarrot: 0 },
      teleop: { carrot: { L1: 1, L2: 2, L3: 3 }, cake: { L1: 0, L2: 1, L3: 2 }, ovenCarrot: 4, ovenCake: 1 },
      intake: { kitchen: 5, neutral: 2, source: 1 },
      haul: { carrot: 1, cake: 1 },
      parked: true,
    });
    expect(b.events).toHaveLength(0); // totals only
    // stable id → re-scan dedupes
    expect(fromQrScout(text, ctx, 'test').submission.id).toBe(b.submission.id);
  });

  it('accepts label-style values ("Red 1", "No Show", "NZ")', () => {
    const text = ['GK', '3', 'Red 1', '611', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', 'NZ', '2', 'No Show', '0', '0', ''].join('\t');
    const b = fromQrScout(text, ctx, 'test');
    expect(b.reports[0]).toMatchObject({ defense_type: 'defense_nz', flags: ['no_show'] });
    expect(b.reports[0].totals_override!.parked).toBeNull();
  });

  it('exports our data in QRScout field order', () => {
    const b = bigBundle();
    const team = '611';
    const text = toQrScout({
      scoutName: 'Nick Noble',
      matchNumber: 12,
      station: 'blue1',
      team,
      totals: totalsFromEvents(b.events.filter((e) => e.team_id === team)),
      report: b.reports[0],
    });
    const cells = text.split('\t');
    expect(cells).toHaveLength(QRSCOUT_FIELDS.length);
    expect(cells.slice(0, 4)).toEqual(['NN', '12', 'B1', '611']);
    expect(cells[QRSCOUT_FIELDS.indexOf('died')]).toBe('1');
    expect(cells[QRSCOUT_FIELDS.indexOf('comments')]).not.toContain('\t');
    // and it imports back to the same team/match
    const back = fromQrScout(text, ctx, 'test');
    expect(back.submission.match_key).toBe('Q12');
    expect(back.reports[0].totals_override!.haul.cake).toBe(1);
  });
});
