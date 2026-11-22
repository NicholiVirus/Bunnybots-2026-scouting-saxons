import { describe, expect, it } from 'vitest';
import { ROSTER } from '@/config/event';
import { compareTeamIds, defaultTeamIdContext, displayTeam, normalizeTeamId } from './teamIds';

describe('team roster', () => {
  it('seeds all 28 robots with string ids', () => {
    expect(ROSTER).toHaveLength(28);
    expect(new Set(ROSTER.map((t) => t.id)).size).toBe(28);
    expect(ROSTER.filter((t) => t.status === 'expected').map((t) => t.id)).toEqual(['2537b', '4472b', '5243b', '5338b']);
  });
});

describe('normalizeTeamId', () => {
  const ctx = defaultTeamIdContext();
  it('maps field-system B robots (9 + number) to "b" ids', () => {
    expect(normalizeTeamId('9449', ctx)).toBe('449b');
    expect(normalizeTeamId(9449, ctx)).toBe('449b');
    expect(normalizeTeamId('92537', ctx)).toBe('2537b');
    expect(normalizeTeamId('95338', ctx)).toBe('5338b');
  });
  it('keeps real teams that start with 9 (9033 Ocebots)', () => {
    expect(normalizeTeamId('9033', ctx)).toBe('9033');
  });
  it('cleans noise', () => {
    expect(normalizeTeamId('frc611', ctx)).toBe('611');
    expect(normalizeTeamId(' 526 ', ctx)).toBe('526');
    expect(normalizeTeamId('449.0', ctx)).toBe('449');
    expect(normalizeTeamId('449B', ctx)).toBe('449b');
    expect(normalizeTeamId('', ctx)).toBeNull();
    expect(normalizeTeamId(null, ctx)).toBeNull();
    expect(normalizeTeamId('NA', ctx)).toBeNull();
  });
  it('uses admin-edited aliases', () => {
    expect(normalizeTeamId('12345', { ...ctx, aliases: { ...ctx.aliases, '12345': '5353' } })).toBe('5353');
  });
  it('passes unknown teams through (walk-ins)', () => {
    expect(normalizeTeamId('7777', ctx)).toBe('7777');
  });
});

describe('ordering/display', () => {
  it('sorts by number with B after A', () => {
    expect(['449b', '611', '449', '321'].sort(compareTeamIds)).toEqual(['321', '449', '449b', '611']);
    expect(displayTeam('449b')).toBe('449B');
  });
});
