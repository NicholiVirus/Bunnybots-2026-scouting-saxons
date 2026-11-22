'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CloudOff, HardDrive, RefreshCw, Wifi, AlertTriangle, FlaskConical } from 'lucide-react';
import { db } from '@/data/db';
import { useSyncStatus } from '@/sync/status';
import { syncEngine } from '@/sync/engine';
import { useAuth } from '@/sync/auth';
import { usePrefs } from '@/lib/prefs';
import { formatAgo } from '@/lib/util';
import { Badge, Button, Modal, cx } from './ui';

export function SyncBadge() {
  const s = useSyncStatus();
  const auth = useAuth();
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const counts = useLiveQuery(
    async () => ({
      pending: await db.outbox.where('status').equals('pending').count(),
      failed: await db.outbox.where('status').equals('failed').count(),
    }),
    [],
    { pending: 0, failed: 0 },
  );

  let tone = 'text-good';
  let label = 'Synced';
  let Icon = Wifi;
  if (prefs.demo) {
    tone = 'text-warn';
    label = 'Demo';
    Icon = FlaskConical;
  } else if (auth.status === 'local') {
    tone = 'text-muted';
    label = 'Local';
    Icon = HardDrive;
  } else if (!s.online) {
    tone = 'text-bad';
    label = counts.pending ? `Offline · ${counts.pending}` : 'Offline';
    Icon = CloudOff;
  } else if (counts.failed) {
    tone = 'text-bad';
    label = `${counts.failed} failed`;
    Icon = AlertTriangle;
  } else if (counts.pending || s.pushing || s.pulling) {
    tone = 'text-warn';
    label = counts.pending ? `${counts.pending} queued` : 'Syncing';
    Icon = RefreshCw;
  }

  return (
    <>
      <button
        type="button"
        data-testid="sync-badge"
        onClick={() => setOpen(true)}
        className={cx('tap flex items-center gap-1.5 rounded-xl px-2 text-sm font-medium', tone)}
        title="Sync status"
      >
        <Icon size={18} className={s.pushing || s.pulling ? 'animate-spin' : ''} />
        <span className="hidden sm:inline">{label}</span>
        {s.realtime === 'live' && !prefs.demo && auth.status === 'signed_in' && <span className="h-2 w-2 rounded-full bg-good" title="Live" />}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Sync status">
        <SyncPanel />
      </Modal>
    </>
  );
}

function SyncPanel() {
  const s = useSyncStatus();
  const auth = useAuth();
  const prefs = usePrefs();
  const items = useLiveQuery(() => db.outbox.orderBy('id').limit(50).toArray(), [], []);

  if (prefs.demo)
    return (
      <p className="text-sm text-muted">
        Demo sandbox: a separate local database with 449&apos;s simulated event. Nothing here is sent to the server. Turn it off in Settings.
      </p>
    );
  if (auth.status === 'local')
    return (
      <div className="space-y-2 text-sm text-muted">
        <p>
          <b className="text-fg">Local-only mode.</b> No Supabase project is configured for this build, so data stays on this device. Move scouting data
          between devices with <b>QR transfer</b>, or export/import JSON.
        </p>
        <p>To enable multi-device sync, set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see README).</p>
      </div>
    );

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Info label="Network" value={s.online ? 'Online' : 'Offline'} />
        <Info label="Realtime" value={s.realtime} />
        <Info label="Last pull" value={s.lastPullAt ? formatAgo(s.lastPullAt) : '—'} />
        <Info label="Last push" value={s.lastPushAt ? formatAgo(s.lastPushAt) : '—'} />
      </div>
      {s.lastError && <p className="rounded-lg bg-bad/10 p-2 text-bad">{s.lastError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void syncEngine.push()}>
          Push now
        </Button>
        <Button size="sm" onClick={() => void syncEngine.pullAll(true)}>
          Full re-sync
        </Button>
        <Button size="sm" onClick={() => void syncEngine.retryFailed()}>
          Retry failed
        </Button>
      </div>
      <div>
        <div className="mb-1 font-medium">Queue ({items.length})</div>
        {items.length === 0 && <p className="text-muted">Everything is on the server.</p>}
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 p-2">
              <span>
                <b>{i.table}</b> <span className="text-muted">{i.key}</span>
                {i.last_error && <span className="block text-xs text-bad">{i.last_error}</span>}
              </span>
              <Badge tone={i.status === 'failed' ? 'bad' : 'warn'}>{i.status}</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
