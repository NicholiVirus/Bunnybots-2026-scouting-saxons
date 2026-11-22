import { describe, expect, it } from 'vitest';
import { deriveDraft, stepDraft, type DraftStep } from './draft';

const ranked = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
const pick = (alliance: number, team: string): DraftStep => ({ action: 'pick', alliance, team_id: team });
const decline = (alliance: number, team: string): DraftStep => ({ action: 'decline', alliance, team_id: team });

describe('alliance selection state machine', () => {
  it('starts with the top N as projected captains, alliance 1 to pick', () => {
    const s = deriveDraft(ranked, 4);
    expect(s.alliances.map((a) => a.captain)).toEqual(['t1', 't2', 't3', 't4']);
    expect(s.alliances.every((a) => a.projected)).toBe(true);
    expect(s.turn).toEqual({ round: 1, alliance: 1 });
    expect(s.available[0]).toBe('t2'); // the next captain can be picked
  });

  it('captain promotion: picking alliance 2’s captain moves everyone up', () => {
    const s = deriveDraft(ranked, 4, [pick(1, 't2')]);
    expect(s.alliances.map((a) => a.captain)).toEqual(['t1', 't3', 't4', 't5']);
    expect(s.alliances[0].picks[0]).toBe('t2');
    expect(s.turn).toEqual({ round: 1, alliance: 2 });
  });

  it('serpentine: round 2 goes N → 1, then done with backups in rank order', () => {
    const steps = [pick(1, 't5'), pick(2, 't6'), pick(3, 't7'), pick(4, 't8')];
    let s = deriveDraft(ranked, 4, steps);
    expect(s.turn).toEqual({ round: 2, alliance: 4 });
    s = deriveDraft(ranked, 4, [...steps, pick(4, 't9'), pick(3, 't10'), pick(2, 't11')]);
    expect(s.turn).toEqual({ round: 2, alliance: 1 });
    s = stepDraft(s, pick(1, 't12'));
    expect(s.done).toBe(true);
    expect(s.turn).toBeNull();
    expect(s.alliances.map((a) => [a.captain, ...a.picks])).toEqual([
      ['t1', 't5', 't12'],
      ['t2', 't6', 't11'],
      ['t3', 't7', 't10'],
      ['t4', 't8', 't9'],
    ]);
    expect(s.backups).toEqual([]);
  });

  it('a decliner cannot be picked later but can still become a captain', () => {
    // t2 (alliance 2's projected captain) is invited by alliance 1 and declines
    let s = deriveDraft(ranked, 4, [decline(1, 't2')]);
    expect(s.turn).toEqual({ round: 1, alliance: 1 }); // alliance 1 picks again
    expect(s.available).not.toContain('t2');
    expect(s.alliances[1].captain).toBe('t2'); // still captain of alliance 2
    s = stepDraft(s, pick(1, 't6'));
    // t5 is invited by alliance 2, declines; t5 is NOT a captain-level team yet → just unavailable
    s = stepDraft(s, decline(2, 't5'));
    expect(s.available).not.toContain('t5');
    const bad = stepDraft(s, pick(3, 't5'));
    expect(bad.warnings.some((w) => /declined/.test(w))).toBe(true);
    expect(bad.alliances[2].picks[0]).toBeNull();
  });

  it('a decliner IS promoted to captain when the order reaches them', () => {
    // t5 declines alliance 1; then alliance 1 picks t2 → captains shift so t5 becomes alliance 4 captain
    const s = deriveDraft(ranked, 4, [decline(1, 't5'), pick(1, 't2')]);
    expect(s.alliances.map((a) => a.captain)).toEqual(['t1', 't3', 't4', 't5']);
  });

  it('rejects invalid picks with warnings', () => {
    const s = deriveDraft(ranked, 2, [pick(1, 't1'), pick(1, 't3'), pick(2, 't3')]);
    expect(s.warnings.join(' ')).toMatch(/own captain|already on alliance/);
  });

  it('builds from official /api/alliances and keeps local declines', () => {
    const official = [
      { number: 1, captain: 't1', first_pick: 't4', second_pick: null, source: 'api' as const, updated_at: '' },
      { number: 2, captain: 't2', first_pick: 't5', second_pick: null, source: 'api' as const, updated_at: '' },
    ];
    const s = deriveDraft(ranked, 2, [decline(2, 't6')], official);
    expect(s.turn).toEqual({ round: 2, alliance: 2 });
    expect(s.available).not.toContain('t6');
    expect(s.declined.get('t6')).toBe(2);
  });

  it('fewer teams than slots: alliances without a captain do not exist', () => {
    const s = deriveDraft(['a', 'b', 'c', 'd'], 8);
    expect(s.alliances.filter((a) => a.captain).length).toBe(4);
  });
});
