'use client';
import { Suspense, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Upload } from 'lucide-react';
import { db } from '@/data/db';
import { loadScoutingBundle, putRows, type ScoutingBundle } from '@/data/repo';
import { useTeamIdContext } from '@/data/hooks';
import type { PitReport } from '@/data/types';
import { APP_VERSION } from '@/config/defaults';
import { encodeBundleToQr, QrAssembler } from '@/scouting/qr';
import { fromQrScout, looksLikeQrScout, toQrScout } from '@/scouting/qrscout';
import { importBundle } from '@/scouting/importBundle';
import { totalsFromEvents } from '@/scouting/derive';
import { displayTeam } from '@/lib/teamIds';
import { getPrefs } from '@/lib/prefs';
import { downloadText, nowIso } from '@/lib/util';
import { Badge, Button, Card, PageTitle, Segmented, Toggle } from '@/components/ui';
import { QrCanvas, QrSequence } from '@/components/QrCode';
import { QrScanner } from '@/components/QrScanner';

export default function TransferPage() {
  return (
    <Suspense fallback={null}>
      <TransferInner />
    </Suspense>
  );
}

function TransferInner() {
  const id = useSearchParams().get('id');
  const [tab, setTab] = useState<'send' | 'receive' | 'file'>(id ? 'send' : 'receive');
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle sub="No network needed — hotspots are banned at the event (rule E6)">QR transfer</PageTitle>
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'send', label: 'Send (show QR)' },
          { value: 'receive', label: 'Receive (scan)' },
          { value: 'file', label: 'File backup' },
        ]}
      />
      {tab === 'send' && <Send initialId={id} />}
      {tab === 'receive' && <Receive />}
      {tab === 'file' && <FileBackup />}
    </div>
  );
}

function Send({ initialId }: { initialId: string | null }) {
  const [mineOnly, setMineOnly] = useState(true);
  const subs = useLiveQuery(
    () =>
      db.scout_submissions
        .filter((s) => s.status === 'submitted' && !s.deleted_at && (!mineOnly || s.device_id === getPrefs().deviceId))
        .toArray()
        .then((a) => a.sort((x, y) => String(y.submitted_at).localeCompare(String(x.submitted_at)))),
    [mineOnly],
    [],
  );
  const [sel, setSel] = useState<string | null>(initialId);
  const [format, setFormat] = useState<'ours' | 'qrscout'>('ours');
  const bundle = useLiveQuery(() => (sel ? loadScoutingBundle(sel) : null), [sel]);
  const parts = useMemo(() => (bundle ? encodeBundleToQr(bundle) : []), [bundle]);
  const qrscout = useMemo(() => {
    if (!bundle) return [];
    const n = Number(bundle.submission.match_key.replace(/\D/g, '')) || 0;
    return bundle.submission.teams.map((team, i) => ({
      team,
      text: toQrScout({
        scoutName: bundle.submission.scout_name,
        matchNumber: n,
        station: bundle.submission.stations[i],
        team,
        totals: totalsFromEvents(bundle.events.filter((e) => e.team_id === team)),
        report: bundle.reports.find((r) => r.team_id === team),
      }),
    }));
  }, [bundle]);

  return (
    <div className="space-y-4">
      <Card title="Pick a submission">
        <Toggle checked={mineOnly} onChange={setMineOnly} label="Only this device's submissions" />
        <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto">
          {subs.map((s) => (
            <li key={s.id}>
              <button className={`flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-sm ${sel === s.id ? 'text-saxon' : ''}`} onClick={() => setSel(s.id)}>
                <span>
                  <b>{s.match_key}</b> {s.alliance} · {s.teams.map(displayTeam).join(', ')} <span className="text-muted">by {s.scout_name}</span>
                </span>
                {sel === s.id && <Badge tone="saxon">selected</Badge>}
              </button>
            </li>
          ))}
          {!subs.length && <li className="py-2 text-sm text-muted">No submissions yet.</li>}
        </ul>
      </Card>
      {bundle && (
        <Card
          title={`${bundle.submission.match_key} · ${bundle.submission.teams.map(displayTeam).join(', ')}`}
          actions={
            <Segmented
              size="sm"
              value={format}
              onChange={setFormat}
              options={[
                { value: 'ours', label: 'Saxon (full log)' },
                { value: 'qrscout', label: '449 QRScout' },
              ]}
            />
          }
        >
          {format === 'ours' ? (
            <div className="text-center">
              <QrSequence parts={parts} />
              <p className="mt-2 text-xs text-muted">
                {parts.length} part{parts.length > 1 ? 's' : ''} · full event log (cycle times survive) · {bundle.events.length} taps
              </p>
            </div>
          ) : (
            <div className="space-y-4 text-center">
              {qrscout.map((q) => (
                <div key={q.team}>
                  <div className="mb-1 font-bold">{displayTeam(q.team)}</div>
                  <QrCanvas text={q.text} size={280} />
                </div>
              ))}
              <p className="text-xs text-muted">One code per robot in 449&apos;s QRScout format (totals only — no cycle times).</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Receive() {
  const ctx = useTeamIdContext();
  const asm = useRef(new QrAssembler());
  const [log, setLog] = useState<{ text: string; tone: 'good' | 'warn' | 'bad' }[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const add = (text: string, tone: 'good' | 'warn' | 'bad') => setLog((l) => [{ text, tone }, ...l].slice(0, 30));

  const handle = async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    try {
      if (text.startsWith('HH1/')) {
        const r = asm.current.add(text);
        if (!r) return add('Unreadable Saxon QR', 'bad');
        if (r.status === 'progress') {
          setProgress(`Got part ${r.have} of ${r.total} — keep scanning`);
          return;
        }
        setProgress(null);
        const res = await importBundle(r.bundle);
        return add(`${r.bundle.submission.match_key} ${r.bundle.submission.teams.map(displayTeam).join(', ')} — ${res === 'same' ? 'already had it' : res}`, res === 'same' ? 'warn' : 'good');
      }
      if (looksLikeQrScout(text)) {
        const b = fromQrScout(text, ctx, APP_VERSION);
        const res = await importBundle(b);
        return add(`QRScout ${b.submission.match_key} ${displayTeam(b.submission.teams[0])} — ${res === 'same' ? 'already had it' : res}`, res === 'same' ? 'warn' : 'good');
      }
      add('Not a scouting QR code', 'bad');
    } catch (e) {
      add(`Error: ${(e as Error).message}`, 'bad');
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Scan">
        <p className="mb-2 text-sm text-muted">Reads Saxon codes (multi-part) and 449&apos;s QRScout codes. Re-scanning is safe — no duplicates.</p>
        <QrScanner onScan={(t) => void handle(t)} />
        {progress && <p className="mt-2 text-sm font-semibold text-saxon">{progress}</p>}
      </Card>
      <Card title="…or paste the code text">
        <textarea className="h-24 w-full rounded-xl border border-line bg-surface-2 p-2 font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="qr-paste" />
        <Button
          className="mt-2"
          onClick={() => {
            for (const line of paste.split(/\n(?=HH1\/)/)) void handle(line);
            setPaste('');
          }}
        >
          Import
        </Button>
      </Card>
      {log.length > 0 && (
        <Card title="Imported">
          <ul className="space-y-1 text-sm" data-testid="import-log">
            {log.map((l, i) => (
              <li key={i} className={l.tone === 'good' ? 'text-good' : l.tone === 'warn' ? 'text-warn' : 'text-bad'}>
                {l.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

interface BackupFile {
  kind: 'harvest-havoc-scouting-backup';
  version: 1;
  exported_at: string;
  bundles: ScoutingBundle[];
  pit_reports: PitReport[];
}

function FileBackup() {
  const [msg, setMsg] = useState<string | null>(null);
  const exportAll = async () => {
    const subs = await db.scout_submissions.filter((s) => !s.deleted_at && s.status === 'submitted').toArray();
    const bundles = (await Promise.all(subs.map((s) => loadScoutingBundle(s.id)))).filter(Boolean) as ScoutingBundle[];
    const file: BackupFile = { kind: 'harvest-havoc-scouting-backup', version: 1, exported_at: nowIso(), bundles, pit_reports: await db.pit_reports.toArray() };
    downloadText(`scouting-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`, JSON.stringify(file), 'application/json');
    setMsg(`Exported ${bundles.length} submissions and ${file.pit_reports.length} pit reports.`);
  };
  const importFile = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as BackupFile;
      if (data.kind !== 'harvest-havoc-scouting-backup') throw new Error('Not a scouting backup file');
      let n = 0;
      for (const b of data.bundles) if ((await importBundle(b)) !== 'same') n++;
      if (data.pit_reports?.length) await putRows('pit_reports', data.pit_reports);
      setMsg(`Imported ${n} new/updated submissions, ${data.pit_reports?.length ?? 0} pit reports.`);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  };
  return (
    <Card title="File backup (laptops / USB / AirDrop)">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void exportAll()}>
          <Download size={16} /> Export all scouting (JSON)
        </Button>
        <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-4">
          <Upload size={16} /> Import JSON
          <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
      </div>
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </Card>
  );
}
