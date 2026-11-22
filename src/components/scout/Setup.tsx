'use client';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, AlertTriangle, Play, ClipboardList } from 'lucide-react';
import { db } from '@/data/db';
import { useMatches } from '@/data/hooks';
import type { Alliance, MatchRow, Station } from '@/data/types';
import { orderMatches } from '@/analytics/schedule';
import { whoAmI } from '@/sync/auth';
import { getPrefs } from '@/lib/prefs';
import { Badge, Button, Card, Empty, cx, haptic } from '@/components/ui';
import { TeamAvatar, usePhotoMap } from '@/components/TeamChip';
import { CoverageBar, useCoverage } from './Coverage';
import { displayTeam } from '@/lib/teamIds';

export interface SetupChoice {
  match: MatchRow;
  alliance: Alliance;
  teams: string[];
  stations: Station[];
}

export function Setup({
  onStart,
  onSelectionChange,
  draftId,
}: {
  onStart: (c: SetupChoice) => void;
  onSelectionChange: (c: SetupChoice | null) => void;
  draftId?: string;
}) {
  const matches = useMatches();
  const photos = usePhotoMap();
  const me = whoAmI();
  const ordered = useMemo(() => orderMatches(matches ?? []), [matches]);
  const mySubmitted = useLiveQuery(
    () => db.scout_submissions.filter((s) => s.device_id === getPrefs().deviceId && s.status === 'submitted').toArray(),
    [],
    [],
  );
  const assignments = useLiveQuery(() => db.scout_assignments.toArray(), [], []);
  const myAssignments = useMemo(
    () => assignments.filter((a) => (me.id ? a.scout_id === me.id : a.scout_name.toLowerCase() === me.name.toLowerCase())),
    [assignments, me.id, me.name],
  );

  const defaultKey = useMemo(() => {
    const done = new Set(mySubmitted.map((s) => s.match_key));
    const assigned = new Set(myAssignments.map((a) => a.match_key));
    const firstUnplayed = ordered.findIndex((m) => !m.played);
    const from = firstUnplayed < 0 ? 0 : firstUnplayed;
    const candidates = ordered.slice(from).filter((m) => !done.has(m.key));
    return (candidates.find((m) => assigned.has(m.key)) ?? candidates[0] ?? ordered[ordered.length - 1])?.key;
  }, [ordered, mySubmitted, myAssignments]);

  const [key, setKey] = useState<string | undefined>();
  const match = ordered.find((m) => m.key === (key ?? defaultKey));
  const assignment = match ? myAssignments.find((a) => a.match_key === match.key) : undefined;
  const [alliance, setAlliance] = useState<Alliance>('red');
  const [sel, setSel] = useState<number[]>([]);

  // rotation pre-fills alliance + robots (scout can change before Start)
  useEffect(() => {
    if (!match) return;
    if (assignment) {
      setAlliance(assignment.alliance);
      setSel(assignment.teams.map((t) => match[assignment.alliance].indexOf(t)).filter((i) => i >= 0));
    } else setSel([]);
  }, [match?.key, assignment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedSel = [...sel].sort();
  const teams = match ? sortedSel.map((i) => match[alliance][i]).filter(Boolean) : [];
  const stations = sortedSel.map((i) => `${alliance}${i + 1}` as Station);
  const coverage = useCoverage(match?.key, draftId, teams, me.name);

  useEffect(() => {
    onSelectionChange(match && teams.length ? { match, alliance, teams, stations } : null);
  }, [match?.key, alliance, sel.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!matches) return null;
  if (!ordered.length) return <Empty title="No schedule yet">An admin loads the match schedule first (Admin → Data sources / Manual entry).</Empty>;
  if (!match) return null;

  const idx = ordered.findIndex((m) => m.key === match.key);
  const uncovered = [...match.red, ...match.blue].filter((t) => t && !(coverage.get(t)?.length));
  const toggle = (i: number) => {
    haptic();
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <div className="flex items-center gap-2">
          <Button size="lg" aria-label="Previous match" onClick={() => idx > 0 && setKey(ordered[idx - 1].key)}>
            <ChevronLeft />
          </Button>
          <select className="h-14 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-center text-xl font-bold" value={match.key} onChange={(e) => setKey(e.target.value)}>
            {ordered.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {m.played ? ' (played)' : ''}
              </option>
            ))}
          </select>
          <Button size="lg" aria-label="Next match" onClick={() => idx < ordered.length - 1 && setKey(ordered[idx + 1].key)}>
            <ChevronRight />
          </Button>
        </div>
        {assignment && (
          <p className="mt-2 flex items-center gap-1 text-sm text-saxon">
            <ClipboardList size={14} /> Assigned by rotation: {assignment.alliance} {assignment.teams.map(displayTeam).join(', ')}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-2">
        {(['red', 'blue'] as const).map((a) => (
          <button
            key={a}
            onClick={() => {
              setAlliance(a);
              setSel([]);
              haptic();
            }}
            className={cx(
              'tap-lg rounded-2xl text-lg font-bold uppercase',
              alliance === a ? (a === 'red' ? 'bg-redA text-white' : 'bg-blueA text-white') : 'border border-line bg-surface-2 text-muted',
            )}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Tap the robots you will watch (1, 2 or all 3)</span>
          <Button size="sm" onClick={() => setSel([0, 1, 2].filter((i) => match[alliance][i]))}>
            Select all 3
          </Button>
        </div>
        {match[alliance].map((t, i) => {
          const on = sel.includes(i);
          const who = (coverage.get(t) ?? []).filter((w) => !w.endsWith('(you)'));
          return (
            <button
              key={t + i}
              onClick={() => toggle(i)}
              data-testid={`robot-${t}`}
              className={cx(
                'flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition',
                on ? (alliance === 'red' ? 'border-redA bg-redA/15' : 'border-blueA bg-blueA/15') : 'border-line bg-surface',
              )}
            >
              <TeamAvatar team={t} url={photos.get(t)} size={56} />
              <div className="flex-1">
                <div className="text-2xl font-black tnum">{displayTeam(t)}</div>
                <div className="text-xs text-muted">
                  {alliance === 'red' ? 'Red' : 'Blue'} {i + 1}
                  {who.length > 0 && <span className="ml-2 text-good">· watched by {who.join(', ')}</span>}
                </div>
              </div>
              <span className={cx('flex h-8 w-8 items-center justify-center rounded-full border-2 text-lg', on ? 'border-saxon bg-saxon text-saxon-ink' : 'border-line')}>
                {on ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      <Card title="Live coverage (all 6 robots)">
        <CoverageBar match={match} coverage={coverage} />
      </Card>

      {uncovered.length > 0 && teams.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {uncovered.length} robot{uncovered.length > 1 ? 's' : ''} uncovered: {uncovered.map(displayTeam).join(', ')}. You can still start.
        </p>
      )}

      <Button variant="primary" size="lg" className="h-16 w-full text-xl" disabled={!teams.length} onClick={() => onStart({ match, alliance, teams, stations })} data-testid="start">
        <Play /> Start at the buzzer
      </Button>
      {match.played && <Badge tone="warn">This match is already played — you are scouting from video/memory.</Badge>}
    </div>
  );
}
