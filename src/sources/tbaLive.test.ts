/**
 * Contract test against a REAL snapshot of The Bunnybots Alliance API
 * (blair-robot-449.shinyapps.io/the_bunnybots_alliance, captured 2026-11-23,
 * placeholder event with teams 1–24). If 449 changes a field, this fails.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultTeamIdContext } from '@/lib/teamIds';
import { allianceScore } from '@/game/scoring';
import { BunnybotsAllianceSource } from './bunnybotsAlliance';

const fx = (n: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, '__fixtures__/tba-live', `${n}.json`), 'utf8'));
const live = {
  quals: fx('matches_qualification'),
  playoffs: fx('matches_playoff'),
  rankings: fx('rankings'),
  alliances: fx('alliances'),
};
const fake: typeof fetch = async (input) => {
  const u = String(input);
  const body = u.includes('qualification') ? live.quals : u.includes('playoff') ? live.playoffs : u.includes('rankings') ? live.rankings : live.alliances;
  return new Response(JSON.stringify(body), { status: 200 });
};

describe('The Bunnybots Alliance — live API snapshot', () => {
  it('imports every qual, playoff, ranking and alliance', async () => {
    const d = await new BunnybotsAllianceSource('https://blair-robot-449.shinyapps.io/the_bunnybots_alliance', defaultTeamIdContext(), fake).fetch();
    expect(d.quals).toHaveLength(live.quals.length);
    expect(d.playoffs).toHaveLength(live.playoffs.length);
    expect(d.rankings).toHaveLength(live.rankings.length);
    expect(d.alliances).toHaveLength(live.alliances.length);
    const q1 = d.quals[0];
    expect(q1).toMatchObject({ key: 'Q1', played: true, red: ['9', '8', '17'], blue: ['19', '1', '11'] });
    expect(q1.breakdown).toBeTruthy();
    expect(d.playoffs[0].label).toBe('M1');
    expect(d.rankings[0]).toMatchObject({ team_id: '12', rank: 1 });
    expect(d.alliances[0]).toMatchObject({ number: 1, captain: '12' });
  });

  it('placeholder scores differ from the rules only by the Oven-cake value', async () => {
    // 449's placeholder event was simulated with an Oven cake worth 2; the manual
    // (and 449's own match-details.R) say 1. We keep the reported score and warn.
    // Real event scores come straight from the field system.
    const d = await new BunnybotsAllianceSource('https://x.test', defaultTeamIdContext(), fake).fetch();
    let checked = 0;
    for (const m of [...d.quals, ...d.playoffs]) {
      if (!m.played || !m.breakdown) continue;
      for (const side of ['red', 'blue'] as const) {
        const opp = side === 'red' ? 'blue' : 'red';
        const ours = allianceScore(m.breakdown[side], m.breakdown[opp].fouls).total;
        const reported = side === 'red' ? m.red_score : m.blue_score;
        expect(reported! - ours, `${m.label} ${side}`).toBe(m.breakdown[side].oven.cake);
        checked++;
      }
    }
    expect(checked).toBe(2 * (live.quals.length + live.playoffs.length));
    // the reported (official) score is what the app keeps
    expect(d.quals[0].red_score).toBe(live.quals[0].red_score);
  });
});

describe('roster guard', () => {
  it("refuses 449's placeholder feed (teams 1–24) but accepts the real roster", async () => {
    const { checkFeedAgainstRoster } = await import('./rosterGuard');
    const { ROSTER } = await import('@/config/event');
    const ctx = defaultTeamIdContext();
    const roster = ROSTER.map((t) => t.id);
    const placeholder = await new BunnybotsAllianceSource('https://x.test', ctx, fake).fetch();
    const c = checkFeedAgainstRoster(placeholder, roster);
    expect(c.ok).toBe(false);
    expect(c.total).toBe(24);
    // the demo event (449's simulation with the real 28 teams) passes
    const { importCsv } = await import('./csv');
    const csv = readFileSync(path.resolve(import.meta.dirname, '../../public/demo/matches.csv'), 'utf8');
    const real = importCsv(csv, { ctx });
    expect(checkFeedAgainstRoster({ quals: real.quals ?? [], playoffs: [], rankings: [], alliances: [], snapshots: [], warnings: [] }, roster).ok).toBe(true);
    // nothing posted yet is fine
    expect(checkFeedAgainstRoster({ quals: [], playoffs: [], rankings: [], alliances: [], snapshots: [], warnings: [] }, roster).ok).toBe(true);
  });
});
