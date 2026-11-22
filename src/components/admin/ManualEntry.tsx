'use client';
/**
 * Manual / admin entry — always available (API down, gym network dead).
 * Result entry is built for < 30 s: pick match → two scores → RP chips → Save.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMatches, useTeamIdContext } from '@/data/hooks';
import { putRow } from '@/data/repo';
import type { MatchRow, Alliance } from '@/data/types';
import type { RpFlags } from '@/game/scoring';
import { applyOfficialData, refreshComputedRankings, markOfficialSuccess } from '@/sources/apply';
import { parseSchedulePaste } from '@/sources/csv';
import { matchKey } from '@/sources/normalize';
import { orderMatches } from '@/analytics/schedule';
import { normalizeTeamId } from '@/lib/teamIds';
import { nowIso } from '@/lib/util';
import { Badge, Button, Card, Field, Toggle, cx, inputCls, haptic } from '@/components/ui';
import { TeamChip } from '@/components/TeamChip';

const NO_RP: RpFlags = { stocked: false, baked: false, dinner: false };

export function ManualEntry() {
  return (
    <div className="space-y-4">
      <ResultEntry />
      <SchedulePaste />
      <AddPlayoffMatch />
    </div>
  );
}

function ResultEntry() {
  const matches = useMatches() ?? [];
  const ordered = useMemo(() => orderMatches(matches), [matches]);
  const firstUnplayed = ordered.find((m) => !m.played)?.key ?? ordered[0]?.key ?? '';
  const [key, setKey] = useState('');
  const m = ordered.find((x) => x.key === (key || firstUnplayed));
  const [red, setRed] = useState('');
  const [blue, setBlue] = useState('');
  const [rp, setRp] = useState<{ red: RpFlags; blue: RpFlags }>({ red: NO_RP, blue: NO_RP });
  const [fouls, setFouls] = useState({ red: { minor: 0, major: 0 }, blue: { minor: 0, major: 0 } });
  const [dq, setDq] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!m) return;
    setRed(m.red_score?.toString() ?? '');
    setBlue(m.blue_score?.toString() ?? '');
    setRp(m.rp ?? { red: m.breakdown?.red.rp ?? NO_RP, blue: m.breakdown?.blue.rp ?? NO_RP });
    setFouls({
      red: m.breakdown?.red.fouls ?? { minor: 0, major: 0 },
      blue: m.breakdown?.blue.fouls ?? { minor: 0, major: 0 },
    });
    setDq(m.dq ?? []);
    setLocked(!!m.locked);
    setSaved(null);
  }, [m?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return <Card title="Enter a result">Load the schedule first (paste below or import a CSV).</Card>;

  const save = async () => {
    const rs = Number(red);
    const bs = Number(blue);
    if (!Number.isFinite(rs) || !Number.isFinite(bs) || red === '' || blue === '') return;
    let winner: MatchRow['winner'] = rs > bs ? 'red' : bs > rs ? 'blue' : 'tie';
    if (winner === 'tie' && m.comp_level === 'po') winner = fouls.red.major < fouls.blue.major ? 'red' : fouls.blue.major < fouls.red.major ? 'blue' : 'tie';
    const row: MatchRow = {
      ...m,
      played: true,
      red_score: rs,
      blue_score: bs,
      rp,
      winner,
      dq,
      source: 'manual',
      locked,
      breakdown: m.breakdown ? { red: { ...m.breakdown.red, fouls: fouls.red }, blue: { ...m.breakdown.blue, fouls: fouls.blue } } : null,
      warnings: [],
      updated_at: nowIso(),
    };
    await putRow('matches', row);
    await refreshComputedRankings('manual');
    await markOfficialSuccess('manual');
    haptic(20);
    setSaved(`${m.label} saved ${rs}–${bs}`);
    const next = ordered.find((x) => !x.played && x.key !== m.key);
    if (next) setKey(next.key);
  };

  const rpChips = (a: Alliance) => (
    <div className="flex gap-1">
      {(['stocked', 'baked', 'dinner'] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => setRp({ ...rp, [a]: { ...rp[a], [k]: !rp[a][k] } })}
          className={cx('tap rounded-xl border px-3 text-sm font-semibold', rp[a][k] ? 'border-saxon bg-saxon text-saxon-ink' : 'border-line bg-surface-2 text-muted')}
        >
          {k === 'stocked' ? 'Stocked' : k === 'baked' ? 'Baked' : 'Dinner'}
        </button>
      ))}
    </div>
  );

  const side = (a: Alliance) => (
    <div className={cx('flex-1 space-y-2 rounded-2xl p-3', a === 'red' ? 'bg-redA/10' : 'bg-blueA/10')}>
      <div className="flex flex-wrap gap-1">
        {m[a].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setDq(dq.includes(t) ? dq.filter((x) => x !== t) : [...dq, t])}
            title="Tap to mark red-carded (DQ)"
            className={cx('rounded-lg', dq.includes(t) && 'ring-2 ring-bad')}
          >
            <TeamChip team={t} link={false} size={22} />
            {dq.includes(t) && <Badge tone="bad">DQ</Badge>}
          </button>
        ))}
      </div>
      <input
        aria-label={`${a} score`}
        className={cx(inputCls, 'h-16 text-center text-3xl font-black tnum')}
        inputMode="numeric"
        pattern="[0-9]*"
        value={a === 'red' ? red : blue}
        onChange={(e) => (a === 'red' ? setRed : setBlue)(e.target.value.replace(/\D/g, ''))}
        placeholder="score"
      />
      {m.comp_level === 'qm' && rpChips(a)}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Fouls committed (optional)</summary>
        <div className="mt-2 flex gap-2">
          {(['minor', 'major'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              {k}
              <input
                type="number"
                min={0}
                className="h-9 w-16 rounded-lg border border-line bg-surface-2 px-2"
                value={fouls[a][k]}
                onChange={(e) => setFouls({ ...fouls, [a]: { ...fouls[a], [k]: Math.max(0, Number(e.target.value) || 0) } })}
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );

  return (
    <Card title="Enter a result" actions={saved && <Badge tone="good">{saved}</Badge>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={`${inputCls} w-44`} value={m.key} onChange={(e) => setKey(e.target.value)} aria-label="Match">
          {ordered.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
              {x.played ? ` ✓ ${x.red_score}–${x.blue_score}` : ''}
            </option>
          ))}
        </select>
        <Toggle checked={locked} onChange={setLocked} label="Lock (live feed can't overwrite)" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        {side('red')}
        {side('blue')}
      </div>
      <Button variant="primary" size="lg" className="mt-3 w-full" onClick={() => void save()} disabled={red === '' || blue === ''}>
        Save result
      </Button>
    </Card>
  );
}

function SchedulePaste() {
  const ctx = useTeamIdContext();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const preview = useMemo(() => (text.trim() ? parseSchedulePaste(text, ctx) : null), [text, ctx]);
  const unknown = useMemo(() => {
    if (!preview) return [];
    const all = preview.quals.flatMap((m) => [...m.red, ...m.blue]).filter(Boolean);
    return [...new Set(all.filter((t) => !ctx.known.has(t)))];
  }, [preview, ctx]);
  return (
    <Card title="Paste the qualification schedule">
      <p className="mb-2 text-sm text-muted">
        One match per line: <code>1 611 449 321 526 3504 686</code> (match, red 1–3, blue 1–3, optional time), or a CSV with headers. B robots can be typed
        as 449b or 9449.
      </p>
      <textarea className="h-32 w-full rounded-xl border border-line bg-surface-2 p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
      {preview && (
        <p className="mt-2 text-sm">
          {preview.quals.length} matches parsed.
          {unknown.length > 0 && <span className="text-warn"> Unknown teams: {unknown.join(', ')} (add them in Teams, or fix the alias map).</span>}
        </p>
      )}
      <Button
        className="mt-2"
        variant="primary"
        disabled={!preview?.quals.length}
        onClick={async () => {
          if (!preview) return;
          const r = await applyOfficialData(preview);
          setMsg(`${r.matchesChanged} matches saved.`);
          setText('');
        }}
      >
        Save schedule
      </Button>
      {msg && <p className="mt-2 text-sm text-good">{msg}</p>}
    </Card>
  );
}

function AddPlayoffMatch() {
  const ctx = useTeamIdContext();
  const [label, setLabel] = useState('M1');
  const [teams, setTeams] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Add / fix a playoff match">
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} w-24`} value={label} onChange={(e) => setLabel(e.target.value.toUpperCase())} placeholder="M1" />
        <input className={`${inputCls} min-w-56 flex-1`} value={teams} onChange={(e) => setTeams(e.target.value)} placeholder="red1 red2 red3 blue1 blue2 blue3" />
        <Button
          onClick={async () => {
            const ids = teams.split(/[\s,]+/).filter(Boolean).map((t) => normalizeTeamId(t, ctx) ?? '');
            if (ids.length !== 6) {
              setMsg('Enter exactly 6 teams.');
              return;
            }
            const n = Number(label.replace(/\D/g, '')) || 1;
            const row: MatchRow = {
              key: matchKey('po', n, label),
              comp_level: 'po',
              match_number: label.startsWith('F') ? 100 + n : n,
              label,
              red: ids.slice(0, 3),
              blue: ids.slice(3),
              played: false,
              red_score: null,
              blue_score: null,
              breakdown: null,
              rp: null,
              winner: null,
              dq: [],
              source: 'manual',
              locked: false,
              warnings: [],
              updated_at: nowIso(),
            };
            await putRow('matches', row);
            setMsg(`${label} saved.`);
          }}
        >
          Save
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  );
}
