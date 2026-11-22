'use client';
/**
 * Pantry + haul graphic from the field system's slot strings
 * ("1,2,0,0,0": 1 = carrot, 2 = cake, 0 = empty). Falls back to counts.
 */
import { HARVEST_HAVOC as G, SHELVES, type Piece, type Shelf } from '@/game/harvestHavoc.config';
import { parseSlots, type AllianceBreakdown } from '@/game/scoring';

function slotsFor(b: AllianceBreakdown, shelf: Shelf): (Piece | null)[] {
  const fromField = parseSlots(b.slots?.[shelf]);
  if (fromField.length) return fromField;
  const out: (Piece | null)[] = [];
  for (let i = 0; i < b.pantry.carrot[shelf]; i++) out.push('carrot');
  for (let i = 0; i < b.pantry.cake[shelf]; i++) out.push('cake');
  while (out.length < G.pantry.shelfCapacity) out.push(null);
  return out;
}

function haulFor(b: AllianceBreakdown, i: number): (Piece | null)[] {
  const fromField = parseSlots(b.slots?.haul?.[i]);
  if (fromField.length) return fromField;
  const out: (Piece | null)[] = [];
  for (let k = 0; k < (b.haul.cake[i] ?? 0); k++) out.push('cake');
  for (let k = 0; k < (b.haul.carrot[i] ?? 0); k++) out.push('carrot');
  while (out.length < G.haul.maxPiecesPerRobot) out.push(null);
  return out;
}

function PieceSvg({ p, x, y, w, h }: { p: Piece | null; x: number; y: number; w: number; h: number }) {
  if (!p) return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="none" stroke="var(--border)" strokeDasharray="3 3" />;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="#f97316" />
      {p === 'cake' && (
        <>
          <rect x={x + w * 0.4} y={y} width={w * 0.08} height={h} fill="#fff7ed" />
          <rect x={x + w * 0.52} y={y} width={w * 0.08} height={h} fill="#fff7ed" />
        </>
      )}
    </g>
  );
}

export function PantryGraphic({ b, teams, side }: { b: AllianceBreakdown; teams: string[]; side: 'red' | 'blue' }) {
  const W = 300;
  const slotW = 50;
  const slotH = 18;
  const gap = 6;
  const color = side === 'red' ? 'var(--red-alliance)' : 'var(--blue-alliance)';
  const rows = [...SHELVES].reverse(); // L3 on top
  return (
    <svg viewBox={`0 0 ${W} 230`} className="w-full max-w-sm" role="img" aria-label={`${side} pantry and haul`}>
      <text x={4} y={14} fontSize={12} fill={color} fontWeight={700}>
        {side.toUpperCase()} PANTRY
      </text>
      {rows.map((shelf, r) => {
        const y = 24 + r * 34;
        const slots = slotsFor(b, shelf);
        return (
          <g key={shelf}>
            <text x={4} y={y + 13} fontSize={11} fill="var(--muted)">
              {shelf}
            </text>
            {slots.slice(0, Math.max(G.pantry.shelfCapacity, slots.length)).map((p, i) => (
              <PieceSvg key={i} p={p} x={30 + i * (slotW + gap)} y={y} w={slotW} h={slotH} />
            ))}
            <line x1={28} x2={30 + 5 * (slotW + gap)} y1={y + slotH + 3} y2={y + slotH + 3} stroke="var(--muted)" strokeWidth={2} />
          </g>
        );
      })}
      <text x={4} y={140} fontSize={12} fill={color} fontWeight={700}>
        HARVEST HAUL
      </text>
      {[0, 1, 2].map((i) => {
        const x = 4 + i * 100;
        return (
          <g key={i}>
            <text x={x} y={160} fontSize={11} fill={b.park[i] ? 'var(--text)' : 'var(--muted)'}>
              {teams[i] || `Robot ${i + 1}`} {b.park[i] ? '· parked' : '· not parked'}
            </text>
            {haulFor(b, i).map((p, k) => (
              <PieceSvg key={k} p={p} x={x + k * 30} y={170} w={26} h={14} />
            ))}
          </g>
        );
      })}
      <g transform="translate(4,205)">
        <PieceSvg p="carrot" x={0} y={0} w={26} h={12} />
        <text x={32} y={10} fontSize={10} fill="var(--muted)">
          carrot
        </text>
        <PieceSvg p="cake" x={80} y={0} w={26} h={12} />
        <text x={112} y={10} fontSize={10} fill="var(--muted)">
          cake (taped)
        </text>
      </g>
    </svg>
  );
}
