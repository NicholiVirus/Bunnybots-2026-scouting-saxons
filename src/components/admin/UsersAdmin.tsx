'use client';
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '@/sync/supabase';
import { useAuth } from '@/sync/auth';
import type { Role } from '@/data/types';
import { Badge, Button, Card, Spinner } from '@/components/ui';

interface Row {
  id: string;
  display_name: string;
  email: string | null;
  role: Role;
  created_at: string;
}

const ROLES: Role[] = ['admin', 'strategist', 'scout', 'viewer'];

export function UsersAdmin() {
  const auth = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const { data, error } = await sb.rpc('admin_list_profiles');
    if (error) setErr(error.message);
    else setRows(data as Row[]);
  }, []);

  useEffect(() => {
    if (auth.status === 'signed_in') void load();
  }, [auth.status, load]);

  if (auth.status === 'local')
    return (
      <Card title="Users & roles">
        <p className="text-sm text-muted">Local-only mode has no accounts. Configure Supabase to manage users (README → Setup).</p>
      </Card>
    );

  const setRole = async (id: string, role: Role) => {
    const sb = getSupabase();
    if (!sb) return;
    setErr(null);
    const { error } = await sb.from('profiles').update({ role }).eq('id', id);
    if (error) setErr(error.message);
    await load();
  };

  const shown = (rows ?? []).filter((r) => !filter || `${r.display_name} ${r.email}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Card
      title="Users & roles"
      actions={
        <Button size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      }
    >
      <p className="mb-3 text-sm text-muted">
        New sign-ups start as <b>Viewer</b>. Promote scouts and strategists here (needs a connection). Roles are enforced by the database, not just this
        screen.
      </p>
      {err && <p className="mb-3 rounded-lg bg-bad/10 p-2 text-sm text-bad">{err}</p>}
      <input
        className="mb-3 h-10 w-full rounded-xl border border-line bg-surface-2 px-3"
        placeholder="Search name or e-mail"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {!rows && !err && <Spinner />}
      <ul className="divide-y divide-line">
        {shown.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <div className="font-medium">
                {r.display_name || '(no name)'} {r.id === auth.userId && <Badge tone="saxon">you</Badge>}
              </div>
              <div className="text-xs text-muted">{r.email}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => void setRole(r.id, role)}
                  className={`h-9 rounded-lg px-2.5 text-sm ${r.role === role ? 'bg-saxon text-saxon-ink font-semibold' : 'bg-surface-2 text-muted'}`}
                >
                  {role}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
