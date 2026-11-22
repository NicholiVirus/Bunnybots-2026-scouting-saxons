'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { OUR_TEAMS } from '@/config/event';
import { setPrefs } from '@/lib/prefs';
import { displayTeam } from '@/lib/teamIds';
import { useTeams } from '@/data/hooks';
import { Modal, cx } from '@/components/ui';
import type { Selection } from './useSelection';

/** "I am picking as:" — drives every pick tool; remembered per device. */
export function PickingAs({ s }: { s: Selection }) {
  const teams = useTeams() ?? [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const isOther = !(OUR_TEAMS as readonly string[]).includes(s.pickingAs);
  const where = s.ours;
  return (
    <div className="mb-4 rounded-2xl border-2 border-saxon/60 bg-surface p-3" data-testid="picking-as">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-muted">I am picking as:</span>
        {OUR_TEAMS.map((t) => (
          <button
            key={t}
            onClick={() => setPrefs({ pickingAs: t })}
            className={cx('h-14 min-w-24 rounded-xl px-5 text-2xl font-black tnum', s.pickingAs === t ? 'bg-saxon text-saxon-ink' : 'border border-line bg-surface-2 text-muted')}
            data-testid={`picking-${t}`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => setOpen(true)}
          className={cx('flex h-14 items-center gap-2 rounded-xl px-4 font-semibold', isOther ? 'bg-saxon text-saxon-ink' : 'border border-line bg-surface-2 text-muted')}
        >
          <Search size={18} /> {isOther ? displayTeam(s.pickingAs) : 'Other team…'}
        </button>
      </div>
      <div className="mt-2 text-lg font-bold text-saxon" data-testid="picking-label">
        Picking as {displayTeam(s.pickingAs)}
        {where && (
          <span className="ml-2 text-sm font-medium text-fg">
            {where.role === 'captain'
              ? where.projected
                ? `· projected captain of Alliance ${where.number}`
                : `· captain of Alliance ${where.number}`
              : `· picked by Alliance ${where.number} (${where.role === 'first' ? '1st' : '2nd'} pick) — showing that alliance's view`}
          </span>
        )}
        {s.locked && <span className="ml-2 rounded-md bg-bad/20 px-2 py-0.5 text-xs text-bad">LIST LOCKED</span>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Pick as another team (advising a partner captain)">
        <input className="mb-3 h-12 w-full rounded-xl border border-line bg-surface-2 px-3" placeholder="Search team" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
          {teams
            .filter((t) => !q || t.id.includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()))
            .map((t) => (
              <button
                key={t.id}
                className="h-12 rounded-xl border border-line bg-surface-2 font-bold"
                onClick={() => {
                  setPrefs({ pickingAs: t.id });
                  setOpen(false);
                }}
              >
                {displayTeam(t.id)}
              </button>
            ))}
        </div>
      </Modal>
    </div>
  );
}
