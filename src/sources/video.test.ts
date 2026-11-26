import { describe, expect, it } from 'vitest';
import type { MatchRow, ScoutEvent, ScoutSubmission, Station, VideoReport } from '@/data/types';
import { allianceChecks } from '@/analytics/accuracy';
import { buildModel } from '@/analytics/model';
import { emptyBreakdown } from '@/game/scoring';
import { buildRecords } from '@/scouting/records';
import { lineupMismatches, parseClock, parseStreamLink, parseVideoFile, VIDEO_FORMAT, workerOnline } from './video';

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

const video = (team: string, alliance: 'red' | 'blue', events: VideoReport['events']): VideoReport => ({
  id: `Q1:${team}`,
  match_key: 'Q1',
  team_id: team,
  alliance,
  station: '2',
  events,
  points: {},
  confidence: { id: 0.9 },
  metrics: {},
  source_version: 'test',
  updated_at: '',
});

const sub: ScoutSubmission = {
  id: 'A',
  match_key: 'Q1',
  alliance: 'red',
  teams: ['611'],
  stations: ['red1' as Station],
  robot_count: 1,
  scout_id: null,
  scout_name: 'Ann',
  device_id: 'd',
  status: 'submitted',
  started_at: 0,
  submitted_at: '2026-12-12T10:00:00Z',
  source: 'app',
  discarded: false,
  discard_reason: null,
  app_version: 't',
  created_at: '',
  updated_at: '',
};
const humanEv = (t: number): ScoutEvent => ({
  id: `h${t}`,
  submission_id: 'A',
  team_id: '611',
  t_ms: t * 1000,
  phase: 'teleop',
  action: 'score',
  piece: 'carrot',
  target: 'L1',
  detail: null,
});

describe('video scouting', () => {
  it('sits next to a scouted robot and fills robots nobody scouted', () => {
    const vEv = (t: number, target: 'L1' | 'L3', piece: 'carrot' | 'cake') =>
      ({ t_ms: t * 1000, phase: 'teleop', action: 'score', piece, target }) as const;
    const recs = buildRecords({
      submissions: [sub],
      reports: [],
      events: [humanEv(30), humanEv(50)],
      matches: [match],
      cycleOpts: { burstWindowMs: 3000, outlierCapMs: 60_000 },
      disagreePoints: 5,
      video: [video('611', 'red', [vEv(30, 'L1', 'carrot'), vEv(50, 'L1', 'carrot')]), video('449', 'red', [vEv(40, 'L3', 'cake')])],
    });
    const scouted = recs.find((r) => r.team === '611')!;
    expect(scouted.source).toBe('human');
    expect(scouted.scouts).toHaveLength(1);
    expect(scouted.video!.points.total).toBe(scouted.points.total);
    expect(scouted.video!.agrees).toBe(true);
    const gap = recs.find((r) => r.team === '449')!;
    expect(gap.source).toBe('video');
    expect(gap.scouts).toHaveLength(0);
    expect(gap.points.total).toBeGreaterThan(0);
    expect(gap.totals.teleop.pantry.cake.L3).toBe(1);
    expect(gap.station).toBe('red2');
    expect(recs.find((r) => r.team === '321')).toBeUndefined();
  });

  it('ignores deleted video rows', () => {
    const v = { ...video('449', 'red', []), deleted_at: '2026-12-12T10:00:00Z' };
    const recs = buildRecords({
      submissions: [],
      reports: [],
      events: [],
      matches: [match],
      cycleOpts: { burstWindowMs: 3000, outlierCapMs: 60_000 },
      disagreePoints: 5,
      video: [v],
    });
    expect(recs).toHaveLength(0);
  });

  const opts = { cycleOpts: { burstWindowMs: 3000, outlierCapMs: 60_000 }, disagreePoints: 5 };
  const subFor = (id: string, teams: string[], match_key = 'Q1'): ScoutSubmission => ({
    ...sub,
    id,
    match_key,
    teams,
    stations: teams.map((_, i) => `red${i + 1}` as Station),
    robot_count: teams.length,
  });

  it('leaves out a team the lineup does not have (misread bumper number), and uses the schedule for the alliance', () => {
    const recs = buildRecords({
      ...opts,
      submissions: [],
      reports: [],
      events: [],
      matches: [match],
      video: [video('3540', 'blue', []), video('526', 'red', [])],
    });
    expect(recs.find((r) => r.team === '3540')).toBeUndefined();
    expect(recs.find((r) => r.team === '526')?.alliance).toBe('blue');
    // no lineup yet: kept (nothing to check against)
    const open = buildRecords({ ...opts, submissions: [], reports: [], events: [], matches: [{ ...match, red: [], blue: [] }], video: [video('3540', 'blue', [])] });
    expect(open.map((r) => r.team)).toEqual(['3540']);
  });

  it('drops video events outside the vocabulary instead of crashing the stats', () => {
    const raw = [
      { t_ms: 10_000, phase: 'teleop', action: 'score', piece: 'Carrot', target: 'L1' },
      { t_ms: 20_000, phase: 'teleop', action: 'score', piece: 'bunny', target: 'L2' },
      { t_ms: 30_000, phase: 'teleop', action: 'score', piece: 'cake', target: 'L3' },
    ] as unknown as VideoReport['events'];
    const recs = buildRecords({
      ...opts,
      submissions: [],
      reports: [],
      events: [],
      matches: [match],
      video: [video('449', 'red', raw), { ...video('321', 'red', []), events: {} as unknown as VideoReport['events'] }],
    });
    const r = recs.find((x) => x.team === '449')!;
    expect(r.video!.events).toHaveLength(1);
    expect(r.totals.teleop.pantry.cake.L3).toBe(1);
    expect(r.totals.teleop.pantry.carrot.L1).toBe(0);
    expect(recs.find((x) => x.team === '321')!.video!.events).toEqual([]);
  });

  it('checks scouts against the official count only when people scouted all three robots', () => {
    const played: MatchRow = { ...match, breakdown: { red: emptyBreakdown(), blue: emptyBreakdown() } };
    const mixed = buildRecords({ ...opts, submissions: [subFor('A', ['611', '449'])], reports: [], events: [], matches: [played], video: [video('321', 'red', [])] });
    expect(mixed.find((r) => r.team === '321')?.source).toBe('video');
    expect(allianceChecks([played], mixed)).toEqual([]);
    const human = buildRecords({ ...opts, submissions: [subFor('A', ['611', '449', '321'])], reports: [], events: [], matches: [played] });
    expect(allianceChecks([played], human).map((c) => c.alliance)).toEqual(['red']);
  });

  it('counts reliability from human-scouted matches only (the video cannot see a robot die)', () => {
    const q2: MatchRow = { ...match, key: 'Q2', label: 'Q2', match_number: 2 };
    const died: ScoutEvent = { ...humanEv(60), id: 'died', action: 'flag', piece: null, target: null, detail: 'died' };
    const model = buildModel({
      teams: [],
      matches: [match, q2],
      submissions: [sub],
      reports: [],
      events: [died],
      pitReports: [],
      video: [{ ...video('611', 'red', []), id: 'Q2:611', match_key: 'Q2' }],
    });
    const t = model.teams.get('611')!;
    expect(t.n).toBe(2);
    expect(t.reliability).toBe(0);
  });

  it('parses the video file and drops anything outside the vocabulary', () => {
    const file = JSON.stringify({
      format: VIDEO_FORMAT,
      event: 'Blair',
      rows: [
        {
          match_key: 'q1',
          team_id: '449',
          alliance: 'red',
          station: '2',
          events: [
            { t_ms: 1200, phase: 'auto', action: 'taxi' },
            { t_ms: 20000, phase: 'teleop', action: 'score', piece: 'cake', target: 'L3', detail: 'video: confident' },
            { t_ms: 5000, phase: 'teleop', action: 'explode' },
            { t_ms: 6000, phase: 'teleop', action: 'score', piece: 'banana', target: 'L1' },
          ],
          points: { total_est: 14 },
        },
        { match_key: 'Q1', team_id: 'abc', alliance: 'red' },
      ],
    });
    const p = parseVideoFile(file);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].id).toBe('Q1:449');
    expect(p.rows[0].events.map((e) => e.action)).toEqual(['taxi', 'score']);
    expect(p.warnings.join(' ')).toMatch(/2 event/);
    expect(p.warnings.join(' ')).toMatch(/skipped/);
    expect(() => parseVideoFile('{"rows": []}')).toThrow(/video scouting file/);
    expect(lineupMismatches(p.rows, new Map([['Q1', { red: ['611', '321', '1'], blue: ['526', '3504', '686'] }]]))).toEqual([
      'Q1: 449 is not in this match (misread bumper number?), so it is left out of the stats',
    ]);
    expect(lineupMismatches(p.rows, new Map([['Q1', { red: ['611', '321', '1'], blue: ['449', '3504', '686'] }]]))).toEqual([
      "Q1: 449 is on blue, not red (the schedule's alliance is used)",
    ]);
    // no lineup yet (e.g. a playoff match before alliances are known): nothing to check against
    expect(lineupMismatches(p.rows, new Map([['Q1', { red: [], blue: [] }]]))).toEqual([]);
  });
});

describe('video team numbers', () => {
  // the video PC reads bumpers / the official lineup as numbers: a B robot arrives as 9449 (the field system's code)
  const vEv = { t_ms: 40_000, phase: 'teleop', action: 'score', piece: 'cake', target: 'L3' } as const;
  const lineup: MatchRow = { ...match, red: ['611', '449b', '321'] };

  it('imports 9449 as 449b, so it matches the lineup', () => {
    const p = parseVideoFile(
      JSON.stringify({ format: VIDEO_FORMAT, rows: [{ match_key: 'Q1', team_id: 9449, alliance: 'red', station: '2', events: [vEv] }] }),
    );
    expect(p.rows[0].team_id).toBe('449b');
    expect(p.rows[0].id).toBe('Q1:449b');
    expect(lineupMismatches(p.rows, new Map([['Q1', lineup]]))).toEqual([]);
  });

  it('counts a pushed row for 9449 as 449b (rows uploaded straight to the server skip the import)', () => {
    const recs = buildRecords({
      submissions: [],
      reports: [],
      events: [],
      matches: [lineup],
      cycleOpts: { burstWindowMs: 3000, outlierCapMs: 60_000 },
      disagreePoints: 5,
      video: [{ ...video('9449', 'red', [vEv]), id: 'Q1:9449' }],
    });
    const r = recs.find((x) => x.team === '449b')!;
    expect(r.source).toBe('video');
    expect(r.key).toBe('Q1:449b');
    expect(r.totals.teleop.pantry.cake.L3).toBe(1);
    expect(recs.find((x) => x.team === '9449')).toBeUndefined();
  });

  it('leaves real 9xxx teams alone', () => {
    const p = parseVideoFile(JSON.stringify({ format: VIDEO_FORMAT, rows: [{ match_key: 'Q2', team_id: '9033', alliance: 'blue', events: [] }] }));
    expect(p.rows[0].team_id).toBe('9033');
  });
});

describe('stream links', () => {
  it('accepts YouTube videos, live pages and channels', () => {
    expect(parseStreamLink('https://youtu.be/4kpO6woeCaU')).toEqual({ ok: true, url: 'https://www.youtube.com/watch?v=4kpO6woeCaU', site: 'youtube', channel: false });
    expect(parseStreamLink('youtube.com/watch?v=4kpO6woeCaU&t=30s')).toMatchObject({ ok: true, url: 'https://www.youtube.com/watch?v=4kpO6woeCaU' });
    expect(parseStreamLink('https://www.youtube.com/live/4kpO6woeCaU?si=x')).toMatchObject({ ok: true, url: 'https://www.youtube.com/watch?v=4kpO6woeCaU' });
    expect(parseStreamLink('https://www.youtube.com/@BlairRobotics/live')).toEqual({ ok: true, url: 'https://www.youtube.com/@BlairRobotics/live', site: 'youtube', channel: true });
    expect(parseStreamLink('https://m.youtube.com/@BlairRobotics')).toMatchObject({ ok: true, url: 'https://www.youtube.com/@BlairRobotics/live', channel: true });
  });
  it('accepts Twitch channels and past broadcasts', () => {
    expect(parseStreamLink('twitch.tv/FIRSTinspires')).toEqual({ ok: true, url: 'https://www.twitch.tv/firstinspires', site: 'twitch', channel: true });
    expect(parseStreamLink('https://www.twitch.tv/videos/123456')).toMatchObject({ ok: true, channel: false });
  });
  it('rejects other links', () => {
    expect(parseStreamLink('https://vimeo.com/1')).toMatchObject({ ok: false });
    expect(parseStreamLink('https://www.youtube.com/results?search_query=x')).toMatchObject({ ok: false });
    expect(parseStreamLink('not a link at all')).toMatchObject({ ok: false });
  });
  it('reads clock times', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('3725')).toBe(3725);
    expect(parseClock('62:05')).toBe(3725);
    expect(parseClock('1:02:05')).toBe(3725);
    expect(parseClock('1:02:05.5')).toBe(3725.5);
    expect(parseClock('soon')).toBeNaN();
    expect(parseClock('75')).toBe(75);
    expect(parseClock('1:75')).toBeNaN();
    expect(parseClock('1:60:00')).toBeNaN();
    expect(parseClock('0:59.5')).toBe(59.5);
  });
  it('knows when the video PC is online', () => {
    const now = Date.parse('2026-12-05T15:00:00Z');
    expect(workerOnline('2026-12-05T14:59:30Z', now)).toBe(true);
    expect(workerOnline('2026-12-05T14:55:00Z', now)).toBe(false);
    expect(workerOnline(null, now)).toBe(false);
  });
});
