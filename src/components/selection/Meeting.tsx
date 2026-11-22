'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Lock, Unlock } from 'lucide-react';
import { db } from '@/data/db';
import { putRow } from '@/data/repo';
import type { PicklistSnapshot } from '@/data/types';
import { displayTeam } from '@/lib/teamIds';
import { nowIso, uuid, formatAgo } from '@/lib/util';
import { useAuth, can, whoAmI } from '@/sync/auth';
import { Badge, Button, Card, cx } from '@/components/ui';
import { TeamChip, usePhotoMap } from '@/components/TeamChip';
import type { Selection } from './useSelection';

export function Meeting({ s }: { s: Selection }) {
  const auth = useAuth();
  const snapshots = useLiveQuery(() => db.picklist_snapshots.where('picking_team').equals(s.pickingAs).toArray(), [s.pickingAs], []);
  const [name, setName] = useState('');
  const [diffWith, setDiffWith] = useState<string | null>(null);
  const me = whoAmI();

  const snap = async () => {
    const row: PicklistSnapshot = {
      id: uuid(),
      picking_team: s.pickingAs,
      name: name.trim() || `snapshot ${new Date().toLocaleTimeString()}`,
      entries: s.entries.map((e) => ({ team_id: e.team_id, tier: e.tier, position: e.position, note: e.note, dnp_reason: e.dnp_reason, dnp_note: e.dnp_note })),
      created_by: me.id,
      created_by_name: me.name,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await putRow('picklist_snapshots', row);
    setName('');
  };

  const sorted = [...snapshots].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const target = sorted.find((x) => x.id === diffWith);
  const diff = useMemo(() => (target ? diffLists(target.entries, s.entries) : null), [target, s.entries]);
  const karma = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of s.votes) if (!v.deleted_at) m.set(v.team_id, (m.get(v.team_id) ?? 0) + v.value);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [s.votes]);

  return (
    <div className="space-y-4">
      <Card
        title="Lock the final list"
        actions={s.locked ? <Badge tone="bad">locked {s.meta?.locked_at ? formatAgo(new Date(s.meta.locked_at).getTime()) : ''}</Badge> : <Badge tone="good">editable</Badge>}
      >
        <p className="mb-3 text-sm text-muted">
          Strategists lock at {s.settings.picklistAutoLock ?? '2:55 PM'} (auto-lock is on when a time is set in Admin → Settings). Only an admin can unlock. The database enforces it.
        </p>
        {!s.locked && can.editPicklist(auth.role) && (
          <Button variant="danger" onClick={() => void s.saveMeta({ locked: true, locked_by: me.id, locked_at: nowIso() })}>
            <Lock size={16} /> Lock {displayTeam(s.pickingAs)} list now
          </Button>
        )}
        {s.locked && can.admin(auth.role) && (
          <Button onClick={() => void s.saveMeta({ locked: false, locked_by: null, locked_at: null })}>
            <Unlock size={16} /> Unlock (admin)
          </Button>
        )}
      </Card>

      <Card title="Snapshots">
        <div className="mb-3 flex gap-2">
          <input className="h-12 flex-1 rounded-xl border border-line bg-surface-2 px-3" placeholder='e.g. "after Q20", "final"' value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" onClick={() => void snap()} disabled={!can.editPicklist(auth.role)}>
            <Camera size={16} /> Save
          </Button>
        </div>
        <ul className="divide-y divide-line">
          {sorted.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>
                <b>{x.name}</b> <span className="text-muted">· {x.created_by_name} · {formatAgo(new Date(x.created_at).getTime())}</span>
              </span>
              <Button size="sm" onClick={() => setDiffWith(diffWith === x.id ? null : x.id)}>
                {diffWith === x.id ? 'Hide diff' : 'Diff vs now'}
              </Button>
            </li>
          ))}
          {!sorted.length && <li className="py-2 text-sm text-muted">No snapshots yet.</li>}
        </ul>
        {diff && (
          <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
            <div className="mb-1 font-semibold">Changes since “{target?.name}”</div>
            {diff.length === 0 ? (
              <p className="text-muted">No changes.</p>
            ) : (
              <ul className="space-y-0.5">
                {diff.map((d) => (
                  <li key={d.team} className={cx(d.kind === 'up' ? 'text-good' : d.kind === 'down' ? 'text-bad' : 'text-warn')}>
                    {displayTeam(d.team)}: {d.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card title="Team karma (votes never reorder the list)">
        {karma.length === 0 ? (
          <p className="text-sm text-muted">Scouts vote with ▲▼ on the Picklist tab.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {karma.map(([t, k]) => (
              <Badge key={t} tone={k > 0 ? 'good' : k < 0 ? 'bad' : 'neutral'}>
                {displayTeam(t)} {k > 0 ? `+${k}` : k}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <PitCheck s={s} />
    </div>
  );
}

export function diffLists(
  before: PicklistSnapshot['entries'],
  after: { team_id: string; tier: string; position: number }[],
): { team: string; kind: 'up' | 'down' | 'tier' | 'added' | 'removed'; text: string }[] {
  const order = (list: { team_id: string; tier: string; position: number }[]) => {
    const m = new Map<string, { tier: string; idx: number }>();
    for (const tier of ['first', 'second', 'dnp']) {
      list
        .filter((e) => e.tier === tier)
        .sort((a, b) => a.position - b.position)
        .forEach((e, i) => m.set(e.team_id, { tier, idx: i + 1 }));
    }
    return m;
  };
  const a = order(before);
  const b = order(after);
  const out: { team: string; kind: 'up' | 'down' | 'tier' | 'added' | 'removed'; text: string }[] = [];
  for (const [t, x] of b) {
    const y = a.get(t);
    if (!y) out.push({ team: t, kind: 'added', text: `added to ${x.tier} (#${x.idx})` });
    else if (y.tier !== x.tier) out.push({ team: t, kind: 'tier', text: `${y.tier} #${y.idx} → ${x.tier} #${x.idx}` });
    else if (y.idx !== x.idx) out.push({ team: t, kind: x.idx < y.idx ? 'up' : 'down', text: `#${y.idx} → #${x.idx}` });
  }
  for (const [t, y] of a) if (!b.has(t)) out.push({ team: t, kind: 'removed', text: `removed (was ${y.tier} #${y.idx})` });
  return out;
}

function PitCheck({ s }: { s: Selection }) {
  const auth = useAuth();
  const photos = usePhotoMap();
  const checks = useLiveQuery(() => db.pit_checks.toArray(), [], []);
  const byTeam = new Map(checks.map((c) => [c.team_id, c]));
  const top = s.entries
    .filter((e) => e.tier !== 'dnp')
    .sort((a, b) => (a.tier === b.tier ? a.position - b.position : a.tier === 'first' ? -1 : 1))
    .slice(0, 10)
    .map((e) => e.team_id);
  const list = top.length ? top : s.first.slice(0, 10).map((r) => r.team);
  const me = whoAmI();
  const set = async (team: string, status: 'healthy' | 'concern', note?: string) => {
    await putRow('pit_checks', { team_id: team, status, note: note ?? byTeam.get(team)?.note ?? '', checked_by: me.id, checked_by_name: me.name, checked_at: nowIso() });
  };
  return (
    <Card title="Pre-selection pit check (~2:30 PM) — top 10 on the list">
      <ul className="space-y-2">
        {list.map((t) => {
          const c = byTeam.get(t);
          const st = s.model?.teams.get(t);
          return (
            <li key={t} className="rounded-xl bg-surface-2 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <TeamChip team={t} photo={photos.get(t)} size={28} />
                {st?.brokeLastMatch && <Badge tone="bad">broke last match</Badge>}
                {st?.trend === 'declining' && <Badge tone="bad">declining</Badge>}
                {c?.status && (
                  <Badge tone={c.status === 'healthy' ? 'good' : 'bad'}>
                    {c.status === 'healthy' ? 'Verified healthy' : 'Concern'} · {c.checked_by_name} {c.checked_at ? formatAgo(new Date(c.checked_at).getTime()) : ''}
                  </Badge>
                )}
                {can.editStrategy(auth.role) && (
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant={c?.status === 'healthy' ? 'good' : 'secondary'} onClick={() => void set(t, 'healthy')}>
                      Healthy
                    </Button>
                    <Button size="sm" variant={c?.status === 'concern' ? 'danger' : 'secondary'} onClick={() => void set(t, 'concern')}>
                      Concern
                    </Button>
                  </span>
                )}
              </div>
              {can.editStrategy(auth.role) && (
                <input
                  className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm"
                  placeholder="robot working? mechanisms fixed?"
                  defaultValue={c?.note ?? ''}
                  onBlur={(e) => e.target.value !== (c?.note ?? '') && void set(t, c?.status ?? 'healthy', e.target.value)}
                />
              )}
              {!can.editStrategy(auth.role) && c?.note && <p className="mt-1 text-xs text-muted">{c.note}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
