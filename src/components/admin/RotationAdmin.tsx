'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useMatches } from '@/data/hooks';
import { deleteRows, putRows } from '@/data/repo';
import type { Alliance, ScoutAssignment } from '@/data/types';
import { orderMatches } from '@/analytics/schedule';
import { displayTeam } from '@/lib/teamIds';
import { nowIso } from '@/lib/util';
import { Button, Card, Field, Segmented, inputCls } from '@/components/ui';

type Pattern = '1' | '12' | '3';
const SLOTS: Record<Pattern, { alliance: Alliance; idx: number[] }[]> = {
  '1': [
    { alliance: 'red', idx: [0] },
    { alliance: 'red', idx: [1] },
    { alliance: 'red', idx: [2] },
    { alliance: 'blue', idx: [0] },
    { alliance: 'blue', idx: [1] },
    { alliance: 'blue', idx: [2] },
  ],
  '12': [
    { alliance: 'red', idx: [0] },
    { alliance: 'red', idx: [1, 2] },
    { alliance: 'blue', idx: [0] },
    { alliance: 'blue', idx: [1, 2] },
  ],
  '3': [
    { alliance: 'red', idx: [0, 1, 2] },
    { alliance: 'blue', idx: [0, 1, 2] },
  ],
};

export interface RotationScout {
  id: string | null;
  name: string;
}

/** Crews of `slots` scouts rotate every `shiftLen` matches; positions rotate each match. */
export function planRotation(
  matchKeys: { key: string; red: string[]; blue: string[] }[],
  scouts: RotationScout[],
  pattern: Pattern,
  shiftLen: number,
): Omit<ScoutAssignment, 'updated_at'>[] {
  const slots = SLOTS[pattern];
  const out: Omit<ScoutAssignment, 'updated_at'>[] = [];
  if (!scouts.length) return out;
  matchKeys.forEach((m, j) => {
    const crewSize = Math.min(slots.length, scouts.length);
    const shift = scouts.length > slots.length ? Math.floor(j / Math.max(1, shiftLen)) : 0;
    const crew = Array.from({ length: crewSize }, (_, i) => scouts[(shift * crewSize + i) % scouts.length]);
    slots.forEach((slot, si) => {
      if (si >= crewSize) return;
      const sc = crew[(si + j) % crewSize];
      const key = sc.id ?? `name:${sc.name.toLowerCase()}`;
      out.push({
        id: `${m.key}:${key}`,
        match_key: m.key,
        scout_id: sc.id,
        scout_name: sc.name,
        alliance: slot.alliance,
        teams: slot.idx.map((i) => m[slot.alliance][i]).filter(Boolean),
      });
    });
  });
  return out;
}

export function RotationAdmin() {
  const matches = useMatches() ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const existing = useLiveQuery(() => db.scout_assignments.toArray(), [], []);
  const quals = useMemo(() => orderMatches(matches).filter((m) => m.comp_level === 'qm'), [matches]);
  const firstUnplayed = quals.find((m) => !m.played)?.match_number ?? 1;
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [pattern, setPattern] = useState<Pattern>('1');
  const [shiftLen, setShiftLen] = useState(6);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const scoutsFromProfiles = profiles.filter((p) => p.role !== 'viewer');
  const scouts: RotationScout[] = [
    ...scoutsFromProfiles.filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, name: p.display_name || 'scout' })),
    ...names
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => ({ id: null, name: n })),
  ];
  const lo = from ?? firstUnplayed;
  const hi = to ?? quals[quals.length - 1]?.match_number ?? 0;
  const range = quals.filter((m) => m.match_number >= lo && m.match_number <= hi);

  const generate = async () => {
    const plan = planRotation(range, scouts, pattern, shiftLen);
    const inRange = new Set(range.map((m) => m.key));
    await deleteRows('scout_assignments', existing.filter((a) => inRange.has(a.match_key)));
    await putRows('scout_assignments', plan.map((p) => ({ ...p, updated_at: nowIso() })));
    setMsg(`${plan.length} assignments for ${range.length} matches.`);
  };

  const byMatch = new Map<string, ScoutAssignment[]>();
  for (const a of existing) byMatch.set(a.match_key, [...(byMatch.get(a.match_key) ?? []), a]);

  return (
    <div className="space-y-4">
      <Card title="Scout rotation">
        <p className="mb-3 text-sm text-muted">
          Pre-fills each scout&apos;s alliance + robots on the Scout screen (they can still change it). Crews rotate every few matches so people get breaks.
        </p>
        <div className="space-y-3">
          <Field as="group" label="Scouts with accounts">
            <div className="flex flex-wrap gap-1">
              {scoutsFromProfiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPicked((s) => (s.has(p.id) ? new Set([...s].filter((x) => x !== p.id)) : new Set([...s, p.id])))}
                  className={`h-10 rounded-lg border px-3 text-sm ${picked.has(p.id) ? 'border-saxon bg-saxon font-semibold text-saxon-ink' : 'border-line bg-surface-2 text-muted'}`}
                >
                  {p.display_name || p.id.slice(0, 6)}
                </button>
              ))}
              {!scoutsFromProfiles.length && <span className="text-sm text-muted">None synced (local mode) — type names below.</span>}
            </div>
          </Field>
          <Field label="Other scouts (one name per line)">
            <textarea className="h-20 w-full rounded-xl border border-line bg-surface-2 p-2" value={names} onChange={(e) => setNames(e.target.value)} />
          </Field>
          <Field as="group" label="Coverage pattern per match">
            <Segmented
              value={pattern}
              onChange={setPattern}
              options={[
                { value: '1', label: '6 scouts × 1 robot' },
                { value: '12', label: '4 scouts (1 + 2)' },
                { value: '3', label: '2 scouts × 3' },
              ]}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Field label="From Q">
              <input className={`${inputCls} w-24`} type="number" value={lo} onChange={(e) => setFrom(Number(e.target.value))} />
            </Field>
            <Field label="To Q">
              <input className={`${inputCls} w-24`} type="number" value={hi} onChange={(e) => setTo(Number(e.target.value))} />
            </Field>
            <Field label="Shift length (matches)">
              <input className={`${inputCls} w-24`} type="number" min={1} value={shiftLen} onChange={(e) => setShiftLen(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void generate()} disabled={!scouts.length || !range.length}>
              Generate for {range.length} matches ({scouts.length} scouts)
            </Button>
            <Button
              onClick={async () => {
                await deleteRows('scout_assignments', existing);
                setMsg('All assignments cleared.');
              }}
            >
              Clear all
            </Button>
          </div>
          {msg && <p className="text-sm text-good">{msg}</p>}
        </div>
      </Card>
      {existing.length > 0 && (
        <Card title="Assignments">
          <div className="scroll-x">
            <table className="w-full min-w-[520px] text-sm">
              <tbody>
                {quals
                  .filter((m) => byMatch.has(m.key))
                  .map((m) => (
                    <tr key={m.key} className="border-b border-line">
                      <td className="py-1 pr-2 font-semibold">{m.label}</td>
                      {(['red', 'blue'] as const).map((side) => (
                        <td key={side} className={side === 'red' ? 'text-redA' : 'text-blueA'}>
                          {(byMatch.get(m.key) ?? [])
                            .filter((a) => a.alliance === side)
                            .map((a) => `${a.scout_name}: ${a.teams.map(displayTeam).join('+')}`)
                            .join(' · ')}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
