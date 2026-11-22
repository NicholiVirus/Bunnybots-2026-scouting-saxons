'use client';
/** Drag-to-reorder list (touch + mouse + keyboard) with ▲▼ buttons as a fallback. */
import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { cx } from './ui';

export interface SortableItem {
  id: string;
  content: ReactNode;
  className?: string;
}

function Row({ item, index, count, move, disabled }: { item: SortableItem; index: number; count: number; move: (from: number, to: number) => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx('flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5', isDragging && 'z-10 shadow-lg ring-2 ring-saxon', item.className)}
    >
      {!disabled && (
        <button className="tap flex touch-none items-center justify-center text-muted" aria-label="Drag to reorder" {...attributes} {...listeners}>
          <GripVertical />
        </button>
      )}
      <div className="min-w-0 flex-1">{item.content}</div>
      {!disabled && (
        <div className="flex flex-col">
          <button className="h-6 w-10 text-muted disabled:opacity-20" disabled={index === 0} onClick={() => move(index, index - 1)} aria-label="Move up">
            <ChevronUp className="mx-auto" size={18} />
          </button>
          <button className="h-6 w-10 text-muted disabled:opacity-20" disabled={index === count - 1} onClick={() => move(index, index + 1)} aria-label="Move down">
            <ChevronDown className="mx-auto" size={18} />
          </button>
        </div>
      )}
    </li>
  );
}

export function SortableList({ items, onReorder, disabled }: { items: SortableItem[]; onReorder: (ids: string[]) => void; disabled?: boolean }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((i) => i.id);
  const move = (from: number, to: number) => onReorder(arrayMove(ids, from, to));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <Row key={item.id} item={item} index={i} count={items.length} move={move} disabled={disabled} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
