'use client';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Ban, Pin, X } from 'lucide-react';
import { DNP_REASON_LABEL, type DnpReason, type PickTier, type PicklistEntry } from '@/data/types';
import { applyFilter, type TeamFilter } from '@/catalog/filters';
import { putRow, deleteRows } from '@/data/repo';
import { displayTeam } from '@/lib/teamIds';
import { nowIso } from '@/lib/util';
import { useAuth, can, whoAmI } from '@/sync/auth';
import { Badge, Button, Card, Modal, Sparkline, cx, fmt, pct } from '@/components/ui';
import { SortableList } from '@/components/SortableList';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import { TeamFilters } from '@/components/TeamFilters';
import type { Selection } from './useSelection';

const TIER_LABEL: Record<PickTier, string> = { first: '1st pick', second: '2nd pick', dnp: 'Do Not Pick' };

export function Picklist({ s }: { s: Selection }) {
  const auth = useAuth();
  const photos = usePhotoMap();
  const [filter, setFilter] = useState<TeamFilter>({});
  const [dnpFor, setDnpFor] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<PicklistEntry | null>(null);
  const byTier = (t: PickTier) => s.entries.filter((e) => e.tier === t).sort((a, b) => a.position - b.position);
  const listed = new Set(s.entries.map((e) => e.team_id));
  const pool = useMemo(
    () => s.ranked.filter((t) => t !== s.pickingAs && !listed.has(t) && (!s.model || applyFilter(s.model.teams.get(t)!, filter))),
    [s.ranked, s.pickingAs, listed, s.model, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const voteSum = (team: string) => s.votes.filter((v) => v.team_id === team && !v.deleted_at).reduce((a, v) => a + v.value, 0);
  const me = whoAmI();
  const myVote = (team: string) => s.votes.find((v) => v.team_id === team && (me.id ? v.user_id === me.id : v.user_name === me.name));

  const vote = async (team: string, value: 1 | -1) => {
    const mine = myVote(team);
    if (mine && mine.value === value) return deleteRows('picklist_votes', [mine]);
    const uid = me.id ?? `local:${me.name}`;
    await putRow('picklist_votes', { id: `${s.pickingAs}:${team}:${uid}`, picking_team: s.pickingAs, team_id: team, user_id: me.id ?? uid, user_name: me.name, value, updated_at: nowIso() });
  };

  const add = async (team: string, tier: PickTier) => {
    if (tier === 'dnp') return setDnpFor(team);
    const list = byTier(tier);
    await s.saveEntry({ team_id: team, tier, position: (list[list.length - 1]?.position ?? 0) + 1000, dnp_reason: null, dnp_note: null });
  };

  const reorder = async (tier: PickTier, ids: string[]) => {
    const list = byTier(tier);
    for (let i = 0; i < ids.length; i++) {
      const e = list.find((x) => x.team_id === ids[i]);
      const pos = (i + 1) * 1000;
      if (e && e.position !== pos) await s.saveEntry({ team_id: e.team_id, position: pos });
    }
  };

  const status = (team: string) => {
    const on = s.draft.onAlliance.get(team);
    if (on) return { label: `A${on}`, picked: true };
    if (s.draft.declined.has(team)) return { label: 'declined', picked: true };
    return null;
  };

  const row = (e: PicklistEntry, i: number) => {
    const st = s.model?.teams.get(e.team_id);
    const stt = status(e.team_id);
    return (
      <div className={cx('flex flex-wrap items-center gap-2', stt?.picked && 'opacity-50')}>
        <span className="w-6 text-center font-black tnum">{i + 1}</span>
        <span className={cx(stt?.picked && 'line-through')}>
          <TeamChip team={e.team_id} photo={photos.get(e.team_id)} size={26} />
        </span>
        {stt && <Badge tone="warn">{stt.label}</Badge>}
        {st && (
          <span className="flex items-center gap-2 text-xs text-muted tnum">
            {st.n ? `${fmt(st.points.mean)} pts` : 'no scouting'} · {pct(st.reliability)}
            {st.cycles ? ` · ${fmt(st.cycles.median)}s` : ''}
            {st.driver.relScore !== null && ` · drv ${fmt(st.driver.relScore, 0)}`}
            <Sparkline values={st.series.map((x) => x.points)} width={56} height={18} />
            {st.trend === 'improving' && <Badge tone="good">▲</Badge>}
            {st.trend === 'declining' && <Badge tone="bad">▼</Badge>}
            {st.brokeLastMatch && <Badge tone="bad">broke last</Badge>}
          </span>
        )}
        {e.tier === 'dnp' && e.dnp_reason && (
          <Badge tone="bad" title={e.dnp_note ?? ''}>
            {DNP_REASON_LABEL[e.dnp_reason]}
          </Badge>
        )}
        {e.note && (
          <span className="flex items-center gap-1 text-xs text-saxon">
            <Pin size={12} /> {e.note}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="flex items-center gap-0.5 text-xs">
            <button className="rounded p-1 text-muted hover:text-good disabled:opacity-30" disabled={!can.vote(auth.role)} onClick={() => void vote(e.team_id, 1)} aria-label="Upvote">
              <ArrowUp size={14} className={myVote(e.team_id)?.value === 1 ? 'text-good' : ''} />
            </button>
            <span className="w-5 text-center tnum">{voteSum(e.team_id) || ''}</span>
            <button className="rounded p-1 text-muted hover:text-bad disabled:opacity-30" disabled={!can.vote(auth.role)} onClick={() => void vote(e.team_id, -1)} aria-label="Downvote">
              <ArrowDown size={14} className={myVote(e.team_id)?.value === -1 ? 'text-bad' : ''} />
            </button>
          </span>
          {s.canEditList && (
            <>
              <button className="rounded p-1 text-muted hover:text-fg" onClick={() => setNoteFor(e)} aria-label="Pin note">
                <Pin size={14} />
              </button>
              {e.tier !== 'first' && (
                <button className="rounded p-1 text-muted hover:text-fg" onClick={() => void add(e.team_id, 'first')} aria-label="Move to 1st pick">
                  <ChevronsUp size={14} />
                </button>
              )}
              {e.tier !== 'second' && (
                <button className="rounded p-1 text-muted hover:text-fg" onClick={() => void add(e.team_id, 'second')} aria-label="Move to 2nd pick">
                  <ChevronsDown size={14} />
                </button>
              )}
              {e.tier !== 'dnp' && (
                <button className="rounded p-1 text-muted hover:text-bad" onClick={() => setDnpFor(e.team_id)} aria-label="Do not pick">
                  <Ban size={14} />
                </button>
              )}
              <button className="rounded p-1 text-muted hover:text-bad" onClick={() => void s.removeEntry(e.team_id)} aria-label="Remove">
                <X size={14} />
              </button>
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {(['first', 'second', 'dnp'] as PickTier[]).map((tier) => {
        const list = byTier(tier);
        return (
          <Card key={tier} title={`${TIER_LABEL[tier]} (${list.length})`} className={tier === 'dnp' ? 'border-bad/40' : undefined}>
            {list.length === 0 ? (
              <p className="text-sm text-muted">{tier === 'dnp' ? 'No DNPs. Every DNP needs a reason.' : 'Add teams from the pool below.'}</p>
            ) : (
              <SortableList items={list.map((e, i) => ({ id: e.team_id, content: row(e, i) }))} onReorder={(ids) => void reorder(tier, ids)} disabled={!s.canEditList} />
            )}
          </Card>
        );
      })}

      <Card title={`Pool — not on a list (${pool.length})`}>
        <div className="mb-3">
          <TeamFilters value={filter} onChange={setFilter} />
        </div>
        <ul className="divide-y divide-line">
          {pool.map((t) => {
            const st = s.model?.teams.get(t);
            const stt = status(t);
            return (
              <li key={t} className={cx('flex flex-wrap items-center gap-2 py-1.5', stt && 'opacity-50')}>
                <TeamChip team={t} photo={photos.get(t)} size={26} showName />
                {stt && <Badge tone="warn">{stt.label}</Badge>}
                <span className="text-xs text-muted tnum">{st?.n ? `${fmt(st.points.mean)} pts (n=${st.n})` : 'no scouting'}</span>
                {s.canEditList && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" onClick={() => void add(t, 'first')} data-testid={`add-first-${t}`}>
                      → 1st
                    </Button>
                    <Button size="sm" onClick={() => void add(t, 'second')}>
                      → 2nd
                    </Button>
                    <Button size="sm" onClick={() => setDnpFor(t)}>
                      DNP
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <DnpModal
        team={dnpFor}
        onClose={() => setDnpFor(null)}
        onSave={async (reason, note) => {
          if (!dnpFor) return;
          const list = byTier('dnp');
          await s.saveEntry({ team_id: dnpFor, tier: 'dnp', position: (list[list.length - 1]?.position ?? 0) + 1000, dnp_reason: reason, dnp_note: note || null });
          setDnpFor(null);
        }}
      />
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={`Pinned note — ${displayTeam(noteFor?.team_id)}`}>
        <NoteEditor
          initial={noteFor?.note ?? ''}
          onSave={async (note) => {
            if (noteFor) await s.saveEntry({ team_id: noteFor.team_id, note: note || null });
            setNoteFor(null);
          }}
        />
      </Modal>
    </div>
  );
}

function NoteEditor({ initial, onSave }: { initial: string; onSave: (s: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="space-y-2">
      <input className="h-12 w-full rounded-xl border border-line bg-surface-2 px-3" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      <Button variant="primary" onClick={() => onSave(v.trim())}>
        Save
      </Button>
    </div>
  );
}

function DnpModal({ team, onClose, onSave }: { team: string | null; onClose: () => void; onSave: (r: DnpReason, note: string) => void }) {
  const [reason, setReason] = useState<DnpReason | null>(null);
  const [note, setNote] = useState('');
  return (
    <Modal open={!!team} onClose={onClose} title={`Do Not Pick ${displayTeam(team)} — reason required`}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(Object.keys(DNP_REASON_LABEL) as DnpReason[]).map((r) => (
          <button key={r} onClick={() => setReason(r)} className={cx('tap rounded-xl border px-3 text-sm', reason === r ? 'border-bad bg-bad text-white' : 'border-line bg-surface-2')}>
            {DNP_REASON_LABEL[r]}
          </button>
        ))}
      </div>
      <input className="mb-3 h-12 w-full rounded-xl border border-line bg-surface-2 px-3" placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button
        variant="danger"
        disabled={!reason || (reason === 'other' && !note.trim())}
        onClick={() => {
          if (reason) onSave(reason, note.trim());
          setReason(null);
          setNote('');
        }}
      >
        Mark Do Not Pick
      </Button>
    </Modal>
  );
}
