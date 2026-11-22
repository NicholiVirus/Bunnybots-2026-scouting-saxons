'use client';
import { ROLE_LABEL, ROLES, type RobotRole, type Shelf } from '@/game/harvestHavoc.config';
import type { TeamFilter } from '@/catalog/filters';
import { PIT_LABELS } from '@/catalog/pit';
import { cx } from './ui';

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('h-9 rounded-lg border px-3 text-sm whitespace-nowrap', on ? 'border-saxon bg-saxon text-saxon-ink font-semibold' : 'border-line bg-surface-2 text-muted')}
    >
      {children}
    </button>
  );
}

const sel = 'h-9 rounded-lg border border-line bg-surface-2 px-2 text-sm';

/** Filter bar: Swerve + Oven + Reliable ground intake + L3 cakes + median cycle ≤ 15 s + defense… */
export function TeamFilters({ value, onChange }: { value: TeamFilter; onChange: (f: TeamFilter) => void }) {
  const set = (p: Partial<TeamFilter>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-2">
      <input
        className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3"
        placeholder="Search team # or name"
        value={value.q ?? ''}
        onChange={(e) => set({ q: e.target.value })}
      />
      <div className="scroll-x flex gap-2 pb-1">
        <select className={sel} value={value.drivetrain ?? ''} onChange={(e) => set({ drivetrain: e.target.value || undefined })} aria-label="Drivetrain">
          <option value="">Any drivetrain</option>
          {Object.entries(PIT_LABELS.drivetrain).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className={sel} value={value.mechanism ?? ''} onChange={(e) => set({ mechanism: e.target.value || undefined })} aria-label="Mechanism">
          <option value="">Any mechanism</option>
          {Object.entries(PIT_LABELS.mechanism).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className={sel} value={value.level ?? ''} onChange={(e) => set({ level: (e.target.value || undefined) as Shelf | undefined })} aria-label="Level">
          <option value="">Any level</option>
          <option value="L3">Reaches L3</option>
          <option value="L2">Reaches L2</option>
          <option value="L1">Reaches L1</option>
        </select>
        <select className={sel} value={value.role ?? ''} onChange={(e) => set({ role: (e.target.value || undefined) as RobotRole | undefined })} aria-label="Role">
          <option value="">Any role</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Chip on={!!value.cakes} onClick={() => set({ cakes: !value.cakes })}>
          Cakes
        </Chip>
        <Chip on={!!value.oven} onClick={() => set({ oven: !value.oven })}>
          Oven
        </Chip>
        <Chip on={!!value.groundReliable} onClick={() => set({ groundReliable: !value.groundReliable })}>
          Reliable ground intake
        </Chip>
        <Chip on={!!value.defense} onClick={() => set({ defense: !value.defense })}>
          Plays defense
        </Chip>
        <Chip on={!!value.hauler} onClick={() => set({ hauler: !value.hauler })}>
          Hauler
        </Chip>
        <label className="flex h-9 items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 text-sm whitespace-nowrap">
          median cycle ≤
          <input
            type="number"
            min={1}
            className="w-12 bg-transparent text-center"
            value={value.maxMedianCycle ?? ''}
            onChange={(e) => set({ maxMedianCycle: e.target.value ? Number(e.target.value) : null })}
          />
          s
        </label>
        <label className="flex h-9 items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 text-sm whitespace-nowrap">
          cake cycle ≤
          <input
            type="number"
            min={1}
            className="w-12 bg-transparent text-center"
            value={value.maxCakeCycle ?? ''}
            onChange={(e) => set({ maxCakeCycle: e.target.value ? Number(e.target.value) : null })}
          />
          s
        </label>
        <label className="flex h-9 items-center gap-1 rounded-lg border border-line bg-surface-2 px-2 text-sm whitespace-nowrap">
          avg pts ≥
          <input
            type="number"
            min={0}
            className="w-12 bg-transparent text-center"
            value={value.minPoints ?? ''}
            onChange={(e) => set({ minPoints: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <Chip on={false} onClick={() => onChange({ q: value.q })}>
          Clear
        </Chip>
      </div>
    </div>
  );
}
