'use client';
/**
 * Schematic Harvest Havoc field (top view, not to scale) for marking where a
 * robot ends its auto. Always drawn from the scouted team's point of view:
 * their driver station / Kitchen on the left. The point is stored as fractions
 * of the drawing (0–1) so it survives a redraw of the field.
 */
import type { MouseEvent } from 'react';
import { cx } from './ui';

const W = 200;
const H = 100;

export type FieldPoint = { x: number; y: number };

export function FieldMap({
  value,
  onChange,
  className,
}: {
  value?: FieldPoint;
  /** Omit for a read-only map. */
  onChange?: (p: FieldPoint | undefined) => void;
  className?: string;
}) {
  const click = (e: MouseEvent<SVGSVGElement>) => {
    if (!onChange) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onChange({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  };
  const label = 'fill-[var(--muted)] text-[6px] font-semibold uppercase tracking-wide';
  return (
    <div className={cx('space-y-1', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={cx('w-full rounded-xl border border-line bg-surface-2 select-none', onChange && 'cursor-crosshair')}
        onClick={click}
        role={onChange ? 'button' : 'img'}
        aria-label={onChange ? 'Field map: tap where the robot ends auto' : 'Field map showing where the robot ends auto'}
        data-testid="field-map"
      >
        {/* our Kitchen (start zone) + Pantry + Ramp/Oven */}
        <rect x="0" y="0" width="42" height={H} fill="var(--saxon)" opacity="0.18" />
        <rect x="1.5" y="34" width="7" height="32" rx="1.5" fill="var(--saxon)" opacity="0.75" />
        <text x="10.5" y="52" className={label}>Pantry</text>
        <rect x="1.5" y="76" width="14" height="20" rx="1.5" fill="var(--saxon)" opacity="0.45" />
        <text x="17.5" y="88" className={label}>Ramp/Oven</text>
        <text x="4" y="9" className={label}>Our kitchen</text>
        <line x1="42" y1="0" x2="42" y2={H} stroke="var(--saxon)" strokeWidth="0.8" strokeDasharray="2 1.5" />

        {/* opponent Kitchen (right) */}
        <rect x={W - 42} y="0" width="42" height={H} fill="var(--muted)" opacity="0.14" />
        <text x={W - 39} y="9" className={label}>Opp. kitchen</text>

        {/* Table Zones either side of the Dinner Table + center line */}
        <rect x="72" y="26" width="28" height="48" fill="var(--saxon)" opacity="0.12" />
        <rect x="100" y="26" width="28" height="48" fill="var(--muted)" opacity="0.1" />
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="var(--muted)" strokeWidth="0.6" strokeDasharray="3 2" />
        <rect x="91" y="41" width="18" height="18" rx="1" fill="var(--surface)" stroke="var(--muted)" strokeWidth="0.8" />
        <text x="100" y="23" textAnchor="middle" className={label}>Dinner table</text>
        <text x="74" y="71" className={label}>Our table zone</text>
        <text x="100" y="9" textAnchor="middle" className={label}>Neutral zone</text>

        {value && (
          <g data-testid="field-map-marker">
            <circle cx={value.x * W} cy={value.y * H} r="5" fill="var(--saxon)" stroke="var(--bg)" strokeWidth="1.2" />
            <circle cx={value.x * W} cy={value.y * H} r="1.4" fill="var(--bg)" />
          </g>
        )}
      </svg>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Schematic, not to scale · our side on the left</span>
        {onChange && value && (
          <button type="button" className="tap px-2 font-semibold text-saxon" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
