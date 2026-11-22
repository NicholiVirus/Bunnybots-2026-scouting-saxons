'use client';
import { useEffect, useState } from 'react';
import { Flag, Minus, Plus, Square, Timer } from 'lucide-react';
import {
  DEFENSE_LABEL,
  DEFENSE_TYPES,
  FLAG_LABEL,
  HARVEST_HAVOC as G,
  INTAKE_LABEL,
  INTAKE_SOURCES,
  PROBLEM_FLAGS,
  T_AUTO_END_MS,
  T_ENDGAME_START_MS,
  T_MATCH_END_MS,
  phaseAt,
  type Phase,
  type Piece,
  type ProblemFlag,
  type Target,
} from '@/game/harvestHavoc.config';
import type { RobotReport, ScoutEvent } from '@/data/types';
import type { ScoutingBundle } from '@/data/repo';
import { countMatching } from '@/scouting/derive';
import { activeFlags, elapsedMs, type useScoutSession } from '@/scouting/session';
import { displayTeam } from '@/lib/teamIds';
import { formatClock } from '@/lib/util';
import { Button, cx, haptic } from '@/components/ui';
import { TeamAvatar, usePhotoMap } from '@/components/TeamChip';

type Session = ReturnType<typeof useScoutSession>;

function useMedia(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function Live({ s, onEnd }: { s: Session; onEnd: () => void }) {
  const b = s.bundle as ScoutingBundle;
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState(b.submission.teams[0]);
  const wide = useMedia('(min-width: 768px)');
  const photos = usePhotoMap();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);
  const t = elapsedMs(b, now);
  const clockPhase = phaseAt(t);
  const phase = s.phaseOverride ?? clockPhase;

  // auto-advance shortly after 2:30 (park is judged 3 s after the end)
  useEffect(() => {
    if (t > T_MATCH_END_MS + G.timing.parkCheckAfterEndSec * 1000) onEnd();
  }, [t > T_MATCH_END_MS + G.timing.parkCheckAfterEndSec * 1000]); // eslint-disable-line react-hooks/exhaustive-deps

  const teams = b.submission.teams;
  const color = b.submission.alliance === 'red' ? 'redA' : 'blueA';

  return (
    <div className="-mx-3 -mt-4 sm:-mx-4">
      <div className="sticky top-14 z-20 border-b border-line bg-bg/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className={cx('flex items-center gap-1 rounded-xl px-3 py-1 text-3xl font-black tnum', t > T_MATCH_END_MS ? 'text-bad' : 'text-fg')} data-testid="clock">
            <Timer size={20} className="text-muted" />
            {formatClock(t)}
          </div>
          <div className="flex flex-1 justify-center gap-1">
            {(['auto', 'teleop', 'endgame'] as Phase[]).map((p) => (
              <button
                key={p}
                onClick={() => s.setPhaseOverride(p === clockPhase ? null : p)}
                className={cx(
                  'h-9 rounded-lg px-2 text-xs font-bold uppercase',
                  phase === p ? 'bg-saxon text-saxon-ink' : 'bg-surface-2 text-muted',
                  s.phaseOverride === p && 'ring-2 ring-warn',
                )}
                title={p === clockPhase ? 'Following the clock' : 'Override phase'}
              >
                {p}
              </button>
            ))}
            {s.phaseOverride && (
              <button className="h-9 rounded-lg bg-surface-2 px-2 text-xs text-warn" onClick={() => s.setPhaseOverride(null)}>
                ⟳ clock
              </button>
            )}
          </div>
          <Button size="sm" variant="danger" onClick={onEnd} data-testid="match-ended">
            <Square size={14} /> End
          </Button>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-saxon transition-all" style={{ width: `${Math.min(100, (t / T_MATCH_END_MS) * 100)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted">
          <span>0:00</span>
          <span style={{ marginLeft: `${(T_AUTO_END_MS / T_MATCH_END_MS) * 100 - 8}%` }}>teleop 0:15</span>
          <span>endgame {formatClock(T_ENDGAME_START_MS)}</span>
          <span>2:30</span>
        </div>
        {!wide && teams.length > 1 && (
          <div className="mt-2 flex gap-1" role="tablist">
            {teams.map((team, i) => (
              <button
                key={team}
                role="tab"
                aria-selected={active === team}
                onClick={() => {
                  setActive(team);
                  haptic(8);
                }}
                className={cx(
                  'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-2 font-black tnum',
                  active === team ? (color === 'redA' ? 'border-redA bg-redA/20' : 'border-blueA bg-blueA/20') : 'border-line bg-surface-2 text-muted',
                )}
                data-testid={`tab-${team}`}
              >
                <TeamAvatar team={team} url={photos.get(team)} size={26} />
                {displayTeam(team)}
                <span className="text-[10px] font-normal text-muted">{b.submission.stations[i]?.slice(-1)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={cx('px-3 pt-3', wide && teams.length > 1 && 'grid gap-3', wide && teams.length === 2 && 'grid-cols-2', wide && teams.length === 3 && 'grid-cols-3')}>
        {teams.map((team, i) =>
          wide || team === active || teams.length === 1 ? (
            <RobotPanel
              key={team}
              team={team}
              station={b.submission.stations[i]}
              s={s}
              phase={phase}
              compact={wide && teams.length > 1}
              active={wide ? active === team : true}
              onFocus={() => setActive(team)}
              photo={photos.get(team)}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

function Counter({
  label,
  count,
  sub,
  onPlus,
  onMinus,
  disabled,
  testId,
  tone,
}: {
  label: string;
  count: number;
  sub?: string;
  onPlus: () => void;
  onMinus: () => void;
  disabled?: boolean;
  testId?: string;
  tone?: 'cake' | 'carrot' | 'oven';
}) {
  return (
    <div className={cx('flex items-center gap-1 rounded-2xl border border-line p-1', tone === 'cake' ? 'bg-orange-500/10' : 'bg-surface-2')}>
      <button
        className="tap-lg flex items-center justify-center rounded-xl bg-surface text-muted active:bg-bad/30 disabled:opacity-30"
        onClick={() => {
          haptic(6);
          onMinus();
        }}
        disabled={count <= 0}
        aria-label={`Remove ${label}`}
        data-testid={testId ? `${testId}-minus` : undefined}
      >
        <Minus />
      </button>
      <div className="min-w-0 flex-1 text-center leading-tight">
        <div className="truncate text-[11px] font-medium text-muted">{label}</div>
        <div className="text-3xl font-black tnum" data-testid={testId ? `${testId}-count` : undefined}>
          {count}
        </div>
        {sub && <div className="text-[10px] text-muted">{sub}</div>}
      </div>
      <button
        className="tap-lg flex min-w-16 items-center justify-center rounded-xl bg-saxon text-saxon-ink active:scale-95 disabled:opacity-30"
        onClick={() => {
          haptic(12);
          onPlus();
        }}
        disabled={disabled}
        aria-label={`Add ${label}`}
        data-testid={testId ? `${testId}-plus` : undefined}
      >
        <Plus />
      </button>
    </div>
  );
}

function Pill({ on, onClick, children, tone = 'saxon', testId }: { on: boolean; onClick: () => void; children: React.ReactNode; tone?: 'saxon' | 'bad' | 'warn'; testId?: string }) {
  const onCls = tone === 'bad' ? 'bg-bad text-white border-bad' : tone === 'warn' ? 'bg-warn text-black border-warn' : 'bg-saxon text-saxon-ink border-saxon';
  return (
    <button
      onClick={() => {
        haptic(10);
        onClick();
      }}
      data-testid={testId}
      className={cx('tap rounded-xl border px-3 text-sm font-semibold', on ? onCls : 'border-line bg-surface-2 text-muted')}
    >
      {children}
    </button>
  );
}

function RobotPanel({
  team,
  station,
  s,
  phase,
  compact,
  active,
  onFocus,
  photo,
}: {
  team: string;
  station: string;
  s: Session;
  phase: Phase;
  compact: boolean;
  active: boolean;
  onFocus: () => void;
  photo?: string;
}) {
  const b = s.bundle as ScoutingBundle;
  const evs = b.events.filter((e) => e.team_id === team);
  const report = b.reports.find((r) => r.team_id === team) as RobotReport;
  const count = (m: Partial<ScoutEvent>) => countMatching(evs, m);
  const flagsOn = activeFlags(evs, team);
  const haulTotal = count({ action: 'haul' });
  const tapScore = (piece: Piece, target: Target) => s.tap({ team_id: team, action: 'score', piece, target });
  const undoScore = (piece: Piece, target: Target) => s.undo({ team_id: team, action: 'score', piece, target });
  const parked = count({ action: 'park' }) > 0;
  const taxi = count({ action: 'taxi' }) > 0;

  const toggleFlag = (f: ProblemFlag) => {
    const revivable = f === 'died' || f === 'browned_out';
    if (flagsOn.has(f)) {
      if (revivable) s.tap({ team_id: team, action: 'revive', detail: f });
      else s.removeAll({ team_id: team, action: 'flag', detail: f });
    } else s.tap({ team_id: team, action: 'flag', detail: f });
  };

  const cell = (piece: Piece, target: Target) => {
    const total = count({ action: 'score', piece, target });
    const auto = count({ action: 'score', piece, target, phase: 'auto' });
    return (
      <Counter
        key={`${piece}-${target}`}
        label={compact ? `${piece === 'cake' ? 'Cake' : 'Carrot'} ${target === 'oven' ? 'Oven' : target}` : target === 'oven' ? (piece === 'cake' ? 'Cake' : 'Carrot') : target}
        count={total}
        sub={auto ? `${auto} in auto` : undefined}
        onPlus={() => tapScore(piece, target)}
        onMinus={() => undoScore(piece, target)}
        tone={piece}
        testId={`${team}-${piece}-${target}`}
      />
    );
  };

  return (
    <section
      onPointerDown={onFocus}
      className={cx('mb-4 space-y-3 rounded-2xl', compact && 'border-2 p-2', compact && (active ? 'border-saxon' : 'border-line'))}
      data-testid={`panel-${team}`}
    >
      <header className="flex items-center gap-2">
        <TeamAvatar team={team} url={photo} size={compact ? 32 : 40} />
        <span className="text-2xl font-black tnum">{displayTeam(team)}</span>
        <span className="text-xs text-muted">{station}</span>
        {flagsOn.has('died') && <span className="ml-auto rounded-lg bg-bad px-2 py-1 text-xs font-bold text-white">DIED — timer paused</span>}
      </header>

      {phase === 'auto' && (
        <div className="flex flex-wrap gap-2">
          <Pill
            on={taxi}
            onClick={() => (taxi ? s.removeAll({ team_id: team, action: 'taxi' }) : s.tap({ team_id: team, action: 'taxi' }))}
            testId={`${team}-taxi`}
          >
            Taxi {taxi ? '✓' : ''}
          </Pill>
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-semibold text-muted">PANTRY</div>
        {!compact && (
          <div className="mb-1 grid grid-cols-2 gap-2 text-center text-xs font-bold">
            <span className="text-orange-400">CARROT</span>
            <span className="text-orange-300">CAKE (taped)</span>
          </div>
        )}
        <div className={cx('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-2')}>
          {(['L3', 'L2', 'L1'] as const).flatMap((l) => [cell('carrot', l), cell('cake', l)])}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold text-muted">OVEN</div>
        <div className={cx('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-2')}>
          {cell('carrot', 'oven')}
          {cell('cake', 'oven')}
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-muted">INTAKE / OTHER (optional — splits cycles into pickup + delivery)</div>
        <div className="flex flex-wrap gap-2">
          {INTAKE_SOURCES.map((src) => (
            <Pill key={src} on={false} onClick={() => s.tap({ team_id: team, action: 'intake', detail: src })} testId={`${team}-intake-${src}`}>
              {INTAKE_LABEL[src].replace(' (Depot)', '')} <span className="text-muted">{count({ action: 'intake', detail: src }) || ''}</span>
            </Pill>
          ))}
          <Pill on={false} onClick={() => s.tap({ team_id: team, action: 'drop' })}>
            Dropped <span className="text-muted">{count({ action: 'drop' }) || ''}</span>
          </Pill>
          <Pill on={false} onClick={() => s.tap({ team_id: team, action: 'handoff' })}>
            Handoff <span className="text-muted">{count({ action: 'handoff' }) || ''}</span>
          </Pill>
          {(count({ action: 'intake' }) > 0 || count({ action: 'drop' }) > 0 || count({ action: 'handoff' }) > 0) && (
            <button
              className="h-12 rounded-xl px-2 text-xs text-muted underline"
              onClick={() => {
                const last = [...evs].filter((e) => ['intake', 'drop', 'handoff'].includes(e.action)).sort((a, z) => z.t_ms - a.t_ms)[0];
                if (last) s.undo({ team_id: team, action: last.action, detail: last.detail ?? undefined });
              }}
            >
              undo last
            </button>
          )}
        </div>
      </div>

      <div className={cx('rounded-2xl p-2', phase === 'endgame' ? 'bg-saxon/10 ring-1 ring-saxon' : 'bg-surface-2/50')}>
        <div className="mb-1 text-xs font-semibold text-muted">ENDGAME</div>
        <div className="mb-2 flex flex-wrap gap-2">
          <Pill
            on={parked}
            onClick={() => (parked ? s.removeAll({ team_id: team, action: 'park' }) : s.tap({ team_id: team, action: 'park' }))}
            testId={`${team}-park`}
          >
            Parked {parked ? '✓' : ''}
          </Pill>
        </div>
        <div className={cx('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-2')}>
          <Counter
            label="Haul carrots"
            count={count({ action: 'haul', piece: 'carrot' })}
            onPlus={() => s.tap({ team_id: team, action: 'haul', piece: 'carrot', target: 'haul' })}
            onMinus={() => s.undo({ team_id: team, action: 'haul', piece: 'carrot' })}
            disabled={haulTotal >= G.haul.maxPiecesPerRobot}
            testId={`${team}-haul-carrot`}
          />
          <Counter
            label="Haul cakes"
            count={count({ action: 'haul', piece: 'cake' })}
            onPlus={() => s.tap({ team_id: team, action: 'haul', piece: 'cake', target: 'haul' })}
            onMinus={() => s.undo({ team_id: team, action: 'haul', piece: 'cake' })}
            disabled={haulTotal >= G.haul.maxPiecesPerRobot}
            tone="cake"
            testId={`${team}-haul-cake`}
          />
        </div>
        {haulTotal >= G.haul.maxPiecesPerRobot && <p className="mt-1 text-[11px] text-muted">Haul max is {G.haul.maxPiecesPerRobot} pieces.</p>}
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold text-muted">DEFENSE (whole match)</div>
        <div className="flex flex-wrap gap-2">
          <Pill on={report.defense_played} onClick={() => s.patchReport(team, { defense_played: !report.defense_played, defense_type: report.defense_played ? null : report.defense_type })} tone="warn" testId={`${team}-defense`}>
            Played defense {report.defense_played ? '✓' : ''}
          </Pill>
          {report.defense_played &&
            DEFENSE_TYPES.map((d) => (
              <Pill key={d} on={report.defense_type === d} onClick={() => s.patchReport(team, { defense_type: report.defense_type === d ? null : d })} tone="warn">
                {DEFENSE_LABEL[d]}
              </Pill>
            ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted">
          <Flag size={12} /> PROBLEMS
        </div>
        <div className="flex flex-wrap gap-2">
          {PROBLEM_FLAGS.map((f) => {
            const on = flagsOn.has(f);
            const revivable = f === 'died' || f === 'browned_out';
            return (
              <Pill key={f} on={on} onClick={() => toggleFlag(f)} tone="bad" testId={`${team}-flag-${f}`}>
                {on && revivable ? `${FLAG_LABEL[f]} → tap when back` : FLAG_LABEL[f]}
              </Pill>
            );
          })}
        </div>
      </div>
    </section>
  );
}
