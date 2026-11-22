'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/sync/supabase';
import { useAuth } from '@/sync/auth';
import type { AuditRow } from '@/data/types';
import { formatAgo } from '@/lib/util';
import { Badge, Button, Card, Spinner } from '@/components/ui';

/** Admin-only audit trail (results, pick lists, teams, catalog, roles, settings). */
export function AuditAdmin() {
  const auth = useAuth();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [table, setTable] = useState('');
  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    let q = sb.from('audit_log').select('*').order('id', { ascending: false }).limit(300);
    if (table) q = q.eq('table_name', table);
    const { data, error } = await q;
    if (error) setErr(error.message);
    else setRows(data as AuditRow[]);
  }, [table]);
  useEffect(() => {
    if (auth.status === 'signed_in') void load();
  }, [auth.status, load]);

  if (auth.status !== 'signed_in')
    return (
      <Card title="Audit log">
        <p className="text-sm text-muted">The audit log lives on the server (database triggers). Configure Supabase and sign in as an admin to view it.</p>
      </Card>
    );

  const summary = (r: AuditRow) => {
    if (r.action !== 'update' || !r.old_row || !r.new_row) return null;
    const o = r.old_row as Record<string, unknown>;
    const n = r.new_row as Record<string, unknown>;
    return Object.keys(n)
      .filter((k) => k !== 'updated_at' && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
      .map((k) => `${k}: ${short(o[k])} → ${short(n[k])}`)
      .join(' · ');
  };

  return (
    <Card
      title="Audit log"
      actions={
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      }
    >
      <select className="mb-3 h-10 rounded-xl border border-line bg-surface-2 px-2" value={table} onChange={(e) => setTable(e.target.value)}>
        <option value="">All tables</option>
        {['matches', 'official_alliances', 'teams', 'team_aliases', 'picklist_entries', 'picklist_meta', 'pit_reports', 'photos', 'settings', 'profiles'].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {err && <p className="text-sm text-bad">{err}</p>}
      {!rows && !err && <Spinner />}
      <ul className="divide-y divide-line">
        {rows?.map((r) => (
          <li key={r.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={r.action === 'delete' ? 'bad' : r.action === 'insert' ? 'good' : 'neutral'}>{r.action}</Badge>
              <b>{r.table_name}</b> <span className="text-muted">{r.row_key}</span>
              <span className="ml-auto text-xs text-muted">
                {r.actor_name ?? 'system'} · {formatAgo(new Date(r.at).getTime())}
              </span>
            </div>
            {summary(r) && <p className="mt-0.5 break-words text-xs text-muted">{summary(r)}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function short(v: unknown): string {
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
