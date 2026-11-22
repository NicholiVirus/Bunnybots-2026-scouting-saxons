import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTeamIdContext } from '@/lib/teamIds';
import { allianceScore } from '@/game/scoring';
import { computeRankings, teamRecords } from '@/analytics/rankings';
import { importCsv, parseSchedulePaste, detectKind, parseCsv } from './csv';
import { BunnybotsAllianceSource, fetchEndpoint } from './bunnybotsAlliance';
import { mergeMatch } from './normalize';
import { applyCutoff } from './demo';

const demo = (f: string) => readFileSync(path.resolve(import.meta.dirname, '../../public/demo', f), 'utf8');
const ctx = defaultTeamIdContext();

describe("449's simulated CSVs (zero mapping)", () => {
  it('imports all 32 quals, maps 9449 → 449b, rescored with cake oven = 1', () => {
    const d = importCsv(demo('matches.csv'), { ctx, source: 'demo', recompute: true });
    expect(d.kind).toBe('matches');
    expect(d.quals).toHaveLength(32);
    expect(d.playoffs).toHaveLength(0);
    const q3 = d.quals.find((m) => m.key === 'Q3')!;
    expect(q3.blue).toEqual(['449', '4575', '449b']);
    // Q1 red: cake_oven_red = 2 → their sim said 142, rules say 140
    const q1 = d.quals.find((m) => m.key === 'Q1')!;
    expect(q1.red_score).toBe(140);
    expect(q1.warnings!.some((w) => /reported 142, rules give 140/.test(w))).toBe(true);
    // every recomputed score equals the rules applied to its own breakdown
    for (const m of d.quals) {
      expect(m.red_score).toBe(allianceScore(m.breakdown!.red, m.breakdown!.blue.fouls).total);
      expect(m.blue_score).toBe(allianceScore(m.breakdown!.blue, m.breakdown!.red.fouls).total);
    }
    expect(d.warnings.length).toBeGreaterThan(10);
  });

  it('keeps official scores (and only warns) when not recomputing', () => {
    const d = importCsv(demo('matches.csv'), { ctx, source: 'csv' });
    expect(d.quals.find((m) => m.key === 'Q1')!.red_score).toBe(142);
  });

  it('our ranking math reproduces 449’s RP totals on their own scores', () => {
    const d = importCsv(demo('matches.csv'), { ctx, source: 'csv' });
    const recs = teamRecords(d.quals);
    const ranks = importCsv(demo('rankings.csv'), { ctx, source: 'csv' });
    expect(ranks.kind).toBe('rankings');
    expect(ranks.rankings).toHaveLength(24);
    for (const r of ranks.rankings) {
      const mine = recs.get(r.team_id)!;
      expect(mine.rp, r.team_id).toBe(r.ranking_total);
      expect(mine.wins, r.team_id).toBe(r.wins);
      expect(mine.losses, r.team_id).toBe(r.losses);
    }
    expect(ranks.rankings.find((r) => r.team_id === '449b')).toBeTruthy();
    const computed = computeRankings(d.quals);
    expect(computed[0].team_id).toBe('3504');
  });

  it('imports playoffs (M1–M13, F#) and alliances', () => {
    const p = importCsv(demo('playoffs.csv'), { ctx, source: 'demo', compLevel: 'po', recompute: true });
    expect(p.playoffs.map((m) => m.key).slice(0, 2)).toEqual(['M1', 'M2']);
    expect(p.playoffs.find((m) => m.key === 'F1')).toBeTruthy();
    expect(p.playoffs[0].blue).toEqual(['449b', '611', '526']);
    const a = importCsv(demo('alliances.csv'), { ctx, source: 'demo' });
    expect(a.kind).toBe('alliances');
    expect(a.alliances).toHaveLength(8);
    expect(a.alliances[7]).toMatchObject({ number: 8, captain: '449b', first_pick: '611', second_pick: '526' });
  });

  it('demo cutoff replays the event mid-day', () => {
    const d = importCsv(demo('matches.csv'), { ctx, source: 'demo', recompute: true });
    const cut = applyCutoff({ ...d, playoffs: [], alliances: [], rankings: [], snapshots: [] }, 20);
    expect(cut.quals.filter((m) => m.played)).toHaveLength(20);
    expect(cut.quals.find((m) => m.key === 'Q21')!.red_score).toBeNull();
    expect(cut.rankings.every((r) => r.matches_played <= 8)).toBe(true);
  });
});

describe('The Bunnybots Alliance ?format=csv output (zero mapping)', () => {
  it('imports the live CSV shape incl. `played` and unplayed rows', () => {
    const header =
      'match_number,match_label,played,red1,red2,red3,blue1,blue2,blue3,taxi_R1,taxi_R2,taxi_R3,carrot_oven_red,carrot_L1_red,carrot_L2_red,carrot_L3_red,cake_oven_red,cake_L1_red,cake_L2_red,cake_L3_red,park_R1,park_R2,park_R3,carrot_haul_R1,carrot_haul_R2,carrot_haul_R3,cake_haul_R1,cake_haul_R2,cake_haul_R3,minor_red,major_red,taxi_B1,taxi_B2,taxi_B3,carrot_oven_blue,carrot_L1_blue,carrot_L2_blue,carrot_L3_blue,cake_oven_blue,cake_L1_blue,cake_L2_blue,cake_L3_blue,park_B1,park_B2,park_B3,carrot_haul_B1,carrot_haul_B2,carrot_haul_B3,cake_haul_B1,cake_haul_B2,cake_haul_B3,minor_blue,major_blue,stocked_rp_red,baked_rp_red,dinner_rp_red,stocked_rp_blue,baked_rp_blue,dinner_rp_blue,red_score,blue_score';
    const played =
      '1,Q1,TRUE,611,449,9449,526,3504,686,TRUE,TRUE,FALSE,3,1,1,1,0,1,1,1,TRUE,TRUE,TRUE,1,0,0,1,0,0,0,0,TRUE,FALSE,FALSE,0,3,3,3,0,0,0,0,TRUE,FALSE,FALSE,0,0,0,0,0,0,1,0,TRUE,TRUE,TRUE,TRUE,FALSE,FALSE,73,46';
    const unplayed = '2,Q2,FALSE,321,614,686,1599,2106,2377' + ',' .repeat(51);
    const d = importCsv([header, played, unplayed].join('\n'), { ctx, source: 'api' });
    expect(d.kind).toBe('matches');
    expect(d.quals).toHaveLength(2);
    const q1 = d.quals[0];
    expect(q1.red).toEqual(['611', '449', '449b']);
    expect(q1.played).toBe(true);
    expect(q1.red_score).toBe(73);
    expect(q1.rp!.red).toEqual({ stocked: true, baked: true, dinner: true });
    expect(d.quals[1].played).toBe(false);
    expect(d.quals[1].red_score).toBeNull();
  });
});

describe('other CSVs + schedule paste', () => {
  it("maps 449's qual_schedule style headers (match,R1..B3) automatically", () => {
    const d = importCsv('match,R1,R2,R3,B1,B2,B3\n1,611,449,321,526,3504,686\n2,9449,614,686,1599,2106,2377', { ctx });
    expect(d.quals).toHaveLength(2);
    expect(d.quals[1].red[0]).toBe('449b');
  });
  it('uses an explicit column mapping for odd files', () => {
    const text = 'Game,A1,A2,A3,Z1,Z2,Z3\n7,611,449,321,526,3504,686';
    expect(detectKind(parseCsv(text).headers)).toBe('unknown');
    const d = importCsv(text, {
      ctx,
      mapping: { match_number: 'Game', red1: 'A1', red2: 'A2', red3: 'A3', blue1: 'Z1', blue2: 'Z2', blue3: 'Z3' },
    });
    expect(d.quals[0]).toMatchObject({ key: 'Q7', red: ['611', '449', '321'] });
  });
  it('parses a pasted schedule (spaces, tabs, 449b / 9449)', () => {
    const d = parseSchedulePaste('1 611 449 321 526 3504 686\n2\t449b\t614\t686\t1599\t2106\t92537', ctx);
    expect(d.quals).toHaveLength(2);
    expect(d.quals[1].red[0]).toBe('449b');
    expect(d.quals[1].blue[2]).toBe('2537b');
  });
});

describe('Bunnybots Alliance API client', () => {
  const quals = [
    { match_number: 1, match_label: 'Q1', played: false, red1: 611, red2: 449, red3: 9449, blue1: 526, blue2: 3504, blue3: 686, red_score: null, blue_score: null },
  ];
  it('falls back to the path-less ?api= form', async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/')) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(quals), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const r = await fetchEndpoint('bunnybots.example.org/', 'matches/qualification', {}, fake);
    expect(r.url).toBe('https://bunnybots.example.org/?api=matches%2Fqualification');
    expect(calls[0]).toBe('https://bunnybots.example.org/api/matches/qualification');
  });
  it('fetches quals/playoffs/rankings/alliances and normalizes ids', async () => {
    const fake: typeof fetch = async (input) => {
      const url = String(input);
      const body = url.includes('qualification')
        ? quals
        : url.includes('playoff')
          ? []
          : url.includes('rankings')
            ? [{ team_key: '9449', team: 9449, rank: 1, matches_played: 1, dq: 0, wins: 1, losses: 0, ties: 0, ranking_total: 5, avg_match: 80 }]
            : [{ alliance: 'Alliance 1', captain: 9449, first_pick: 611, second_pick: 526 }];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const d = await new BunnybotsAllianceSource('https://x.test', ctx, fake).fetch();
    expect(d.quals[0].red).toEqual(['611', '449', '449b']);
    expect(d.quals[0].played).toBe(false);
    expect(d.rankings[0]).toMatchObject({ team_id: '449b', ranking_score: 5, rank: 1 });
    expect(d.alliances[0]).toMatchObject({ number: 1, captain: '449b' });
    expect(d.snapshots.map((s) => s.endpoint)).toEqual(['matches/qualification', 'matches/playoff', 'rankings', 'alliances']);
  });
});

describe('merge rules', () => {
  it('API wins, except over a locked manual result; identical rows are no-ops', () => {
    const d = importCsv(demo('matches.csv'), { ctx, source: 'api' });
    const m = d.quals[0];
    expect(mergeMatch(undefined, m)).toBe(m);
    expect(mergeMatch(m, { ...m })).toBeNull();
    const manual = { ...m, source: 'manual' as const, locked: true, red_score: 1 };
    expect(mergeMatch(manual, m)).toBeNull();
    expect(mergeMatch({ ...manual, locked: false }, m)).toMatchObject({ source: 'api', red_score: 142 });
  });
});
