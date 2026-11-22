import { describe, expect, it } from 'vitest';
import type { PitReport, RobotReport, ScoutSubmission } from '@/data/types';
import { buildLeaderboard } from './leaderboard';
import { diffLists } from '@/components/selection/Meeting';

const sub = (id: string, scout: string, teams: string[], extra: Partial<ScoutSubmission> = {}): ScoutSubmission => ({
  id, match_key: 'Q1', alliance: 'red', teams, stations: [], robot_count: teams.length, scout_id: null, scout_name: scout, device_id: 'd',
  status: 'submitted', started_at: null, submitted_at: '2026-12-12T15:00:00Z', source: 'app', discarded: false, discard_reason: null,
  app_version: 't', created_at: '', updated_at: '', ...extra,
});
const rep = (sid: string, team: string, note = ''): RobotReport => ({
  id: `${sid}:${team}`, submission_id: sid, team_id: team, station: 'red1', note, driver_rating: null, defense_played: false, defense_type: null,
  defense_rating: null, flags: [], mechanisms: {}, rank_quickness: null, rank_awareness: null, rank_defense_resistance: null, viewed: true,
  totals_override: null, updated_at: '',
});

describe('scout leaderboard', () => {
  it('counts matches, robots, pit, notes and accuracy; ignores discarded', () => {
    const subs = [sub('a', 'Ava', ['611']), sub('b', 'Ava', ['449', '321', '686']), sub('c', 'Ben', ['526']), sub('d', 'Ben', ['1'], { discarded: true })];
    const reports = [rep('a', '611', 'fast'), rep('b', '449'), rep('c', '526', 'ok')];
    const pit: PitReport[] = [{ id: 'p', team_id: '611', author_id: null, author_name: 'Ben', data: {}, created_at: '2026-12-12T09:00:00Z', updated_at: '' }];
    const acc = new Map([['a', [0.9]], ['b', [0.8]], ['c', [0.5]]]);
    const rows = buildLeaderboard(subs, reports, pit, acc);
    const ava = rows.find((r) => r.name === 'Ava')!;
    const ben = rows.find((r) => r.name === 'Ben')!;
    expect(ava).toMatchObject({ matches: 2, robots: 4, multiRobot: 1, notes: 1 });
    expect(ava.accuracy).toBeCloseTo(0.85, 6);
    expect(ben).toMatchObject({ matches: 1, pit: 1 });
    expect(rows[0].name).toBe('Ava');
  });
});

describe('pick list snapshot diff', () => {
  it('reports moves, tier changes, additions and removals', () => {
    const before = [
      { team_id: 'a', tier: 'first' as const, position: 1, note: null, dnp_reason: null, dnp_note: null },
      { team_id: 'b', tier: 'first' as const, position: 2, note: null, dnp_reason: null, dnp_note: null },
      { team_id: 'c', tier: 'second' as const, position: 1, note: null, dnp_reason: null, dnp_note: null },
    ];
    const after = [
      { team_id: 'b', tier: 'first', position: 1 },
      { team_id: 'a', tier: 'first', position: 2 },
      { team_id: 'd', tier: 'second', position: 1 },
    ];
    const d = diffLists(before, after);
    expect(d.find((x) => x.team === 'b')!.kind).toBe('up');
    expect(d.find((x) => x.team === 'a')!.kind).toBe('down');
    expect(d.find((x) => x.team === 'd')!.kind).toBe('added');
    expect(d.find((x) => x.team === 'c')!.kind).toBe('removed');
  });
});
