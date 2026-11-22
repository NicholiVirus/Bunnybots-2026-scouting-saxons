/**
 * Guard: point values / thresholds must come from harvestHavoc.config.ts.
 * Scans the source for arithmetic that multiplies a game element by a literal
 * point value (e.g. "carrot_L3 * 5", "oven * 2"), which would silently break
 * if a Team Update changed the rules.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('no hard-coded point values outside harvestHavoc.config.ts', () => {
  it('finds no "element × literal points" arithmetic', () => {
    const bad: string[] = [];
    const re = /\b(carrot|cake|oven|taxi|park|haul|pantry|L1|L2|L3|foul|minor|major)\w*\s*\*\s*(1|2|3|4|5|8|10|12)\b(?!\s*[\d.])/i;
    for (const f of walk(root)) {
      if (f.endsWith('harvestHavoc.config.ts') || f.includes('.test.')) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (re.test(line) && !line.includes('1000') && !/\b(ms|px|Ms)\b/.test(line)) bad.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
