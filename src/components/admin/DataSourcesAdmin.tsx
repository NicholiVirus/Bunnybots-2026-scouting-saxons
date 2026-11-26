'use client';
import { EVENT } from '@/config/event';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Link2, RefreshCw, Upload } from 'lucide-react';
import { db } from '@/data/db';
import { useSettings, useTeamIdContext } from '@/data/hooks';
import { usePrefs } from '@/lib/prefs';
import { cleanBaseUrl, fetchEndpoint } from '@/sources/bunnybotsAlliance';
import { applyOfficialData, refreshComputedRankings, markOfficialSuccess, officialStore } from '@/sources/apply';
import { autoMap, detectKind, importCsv, MATCH_FIELDS, parseCsv } from '@/sources/csv';
import { getDemoCutoff, loadDemo } from '@/sources/demo';
import { lineupMismatches, parseVideoFile } from '@/sources/video';
import { deleteRows, putRows } from '@/data/repo';
import { pollOfficialNow } from '@/components/OfficialDataPoller';
import { FreshnessBanner } from '@/components/FreshnessBanner';
import { Badge, Button, Card, Field, Segmented, Toggle, inputCls } from '@/components/ui';
import { saveSetting } from './SettingsAdmin';
import { formatAgo } from '@/lib/util';
import { LiveStreamsAdmin } from './LiveStreamsAdmin';

export function DataSourcesAdmin() {
  const prefs = usePrefs();
  return (
    <div className="space-y-4">
      {prefs.demo && <DemoControls />}
      <LiveFeed />
      <CsvImport />
      <LiveStreamsAdmin />
      <VideoImport />
      <Snapshots />
    </div>
  );
}

function LiveFeed() {
  const s = useSettings();
  const off = officialStore.use();
  const [url, setUrl] = useState(s.tbaUrl);
  const [poll, setPoll] = useState(String(s.pollIntervalSec));
  const [test, setTest] = useState<string | null>(null);

  const runTest = async () => {
    setTest('Testing…');
    try {
      const { data, url: used } = await fetchEndpoint(url, 'matches/qualification');
      const n = Array.isArray(data) ? data.length : 0;
      setTest(`✓ ${n} qualification matches via ${used}`);
    } catch (e) {
      setTest(`✗ ${(e as Error).message} — check the URL, or the site may be down (manual entry still works).`);
    }
  };

  return (
    <Card title="The Bunnybots Alliance (live results)" actions={<FreshnessBanner />}>
      <div className="space-y-3">
        <Field label="Base URL (449's results site)" hint={`449's site: ${EVENT.defaultTbaUrl || 'https://blair-robot-449.shinyapps.io/the_bunnybots_alliance'} · no key needed. The free server can take ~30 s to wake up.`}>
          <div className="flex gap-2">
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
            <Button
              variant="primary"
              onClick={() => {
                const clean = cleanBaseUrl(url);
                setUrl(clean);
                void saveSetting('tbaUrl', clean);
              }}
            >
              Save
            </Button>
          </div>
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Poll every (s)">
            <input
              className={`${inputCls} w-28`}
              type="number"
              min={10}
              value={poll}
              onChange={(e) => setPoll(e.target.value)}
              onBlur={() => void saveSetting('pollIntervalSec', Math.max(10, Number(poll) || 30))}
            />
          </Field>
          <Field as="group" label="Results mode">
            <Segmented
              value={s.dataMode}
              onChange={(v) => void saveSetting('dataMode', v)}
              options={[
                { value: 'live', label: 'Live feed' },
                { value: 'manual', label: 'Manual only' },
              ]}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void runTest()}>
            <Link2 size={16} /> Test connection
          </Button>
          <Button onClick={() => void pollOfficialNow(s.tbaUrl)} disabled={!s.tbaUrl}>
            <RefreshCw size={16} className={off.polling ? 'animate-spin' : ''} /> Poll now
          </Button>
        </div>
        {test && <p className="rounded-lg bg-surface-2 p-2 text-sm">{test}</p>}
        {off.lastError && <p className="rounded-lg bg-warn/10 p-2 text-sm text-warn" data-testid="feed-error">{off.lastError}</p>}
        {off.warnings.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-warn">{off.warnings.length} data warnings (scores that don’t match our rules)</summary>
            <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-muted">
              {off.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

function VideoImport() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const matches = useLiveQuery(() => db.matches.toArray(), []);
  const stored = useLiveQuery(() => db.video_reports.count(), []);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parseVideoFile(text);
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [text]);
  const mismatches = useMemo(() => {
    if (!parsed || 'error' in parsed || !matches) return [];
    return lineupMismatches(parsed.rows, new Map(matches.map((m) => [m.key, { red: m.red, blue: m.blue }])));
  }, [parsed, matches]);

  const doImport = async () => {
    if (!parsed || 'error' in parsed) return;
    await putRows('video_reports', parsed.rows);
    setResult(`Imported ${parsed.rows.length} robot-matches from the video scout.`);
    setText('');
  };
  const clearAll = async () => {
    if (!window.confirm('Remove all video scouting data from every device?')) return;
    const all = await db.video_reports.toArray();
    await deleteRows('video_reports', all);
    setResult(`Removed ${all.length} robot-matches.`);
  };

  return (
    <Card title="Video scouting (automatic, from the match video)">
      <p className="mb-3 text-sm text-muted">
        Import the file the video PC writes (<code>bunnyscout saxon-export</code> → <code>saxon_video.json</code>), or let the video PC
        upload directly (<code>bunnyscout saxon-push</code>, signed in as a Strategist or Admin). Video results show next to the
        scouts&apos; on team and match pages, and count in the stats only for robot-matches no human scouted.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-4">
          <Upload size={16} /> Choose file
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setText(await f.text());
                setResult(null);
              }
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-xs text-muted">{stored ?? 0} robot-matches stored</span>
        {!!stored && (
          <Button size="sm" variant="danger" onClick={() => void clearAll()}>
            Remove all
          </Button>
        )}
      </div>
      {parsed && 'error' in parsed && <p className="text-sm text-bad">{parsed.error}</p>}
      {parsed && !('error' in parsed) && (
        <div className="space-y-2 text-sm">
          <p>
            {parsed.rows.length} robot-matches{parsed.event ? ` from “${parsed.event}”` : ''} in{' '}
            {new Set(parsed.rows.map((r) => r.match_key)).size} matches.
          </p>
          {[...parsed.warnings, ...mismatches].map((w) => (
            <p key={w} className="text-xs text-warn">
              {w}
            </p>
          ))}
          <Button variant="primary" onClick={() => void doImport()} disabled={!parsed.rows.length}>
            Import
          </Button>
        </div>
      )}
      {result && <p className="mt-2 text-sm text-good">{result}</p>}
    </Card>
  );
}

function CsvImport() {
  const ctx = useTeamIdContext();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [recompute, setRecompute] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseCsv(text) : null), [text]);
  const kind = parsed ? detectKind(parsed.headers) : null;
  const needsMapping = parsed && kind === 'unknown';
  const effMapping = mapping ?? (parsed ? autoMap(parsed.headers) : null);
  const preview = useMemo(() => {
    if (!parsed) return null;
    try {
      return importCsv(text, { ctx, mapping: needsMapping ? effMapping ?? undefined : undefined, recompute });
    } catch (e) {
      return { error: (e as Error).message } as const;
    }
  }, [parsed, text, ctx, needsMapping, effMapping, recompute]);

  const loadUrl = async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      setText(await res.text());
      setMapping(null);
    } catch (e) {
      setResult(`Could not fetch: ${(e as Error).message}`);
    }
  };

  const doImport = async () => {
    if (!preview || 'error' in preview) return;
    const r = await applyOfficialData(preview);
    if (!preview.rankings.length) await refreshComputedRankings('csv');
    await markOfficialSuccess('csv', preview.warnings);
    setResult(`Imported: ${r.matchesChanged} matches changed${r.rankingsChanged ? ', rankings updated' : ''}${r.alliancesChanged ? ', alliances updated' : ''}.`);
  };

  return (
    <Card title="CSV import (schedule, results, rankings, alliances)">
      <p className="mb-3 text-sm text-muted">
        The Bunnybots Alliance <code>?format=csv</code> output and 449&apos;s CSVs import with zero mapping. Anything else: map the columns below.
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-4">
          <Upload size={16} /> Choose file
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setText(await f.text());
                setMapping(null);
              }
            }}
          />
        </label>
        <input className={`${inputCls} min-w-48 flex-1`} placeholder="…or CSV URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button onClick={() => void loadUrl()} disabled={!url}>
          Fetch
        </Button>
      </div>
      <textarea
        className="h-28 w-full rounded-xl border border-line bg-surface-2 p-2 font-mono text-xs"
        placeholder="…or paste CSV here"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMapping(null);
        }}
      />
      {parsed && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="saxon">{kind === 'unknown' ? 'needs mapping' : kind}</Badge>
            <span className="text-muted">
              {parsed.rows.length} rows · {parsed.headers.length} columns
            </span>
          </div>
          {needsMapping && effMapping && (
            <div className="grid gap-2 sm:grid-cols-3">
              {MATCH_FIELDS.map((f) => (
                <Field key={f.field} label={`${f.label}${f.required ? ' *' : ''}`}>
                  <select
                    className={inputCls}
                    value={effMapping[f.field] ?? ''}
                    onChange={(e) => setMapping({ ...effMapping, [f.field]: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          )}
          <Toggle checked={recompute} onChange={setRecompute} label="Recompute scores with our rules (use for 449's simulated data)" />
          {preview && 'error' in preview ? (
            <p className="text-sm text-bad">{preview.error}</p>
          ) : (
            preview && (
              <p className="text-sm">
                Ready: <b>{preview.quals.length}</b> quals, <b>{preview.playoffs.length}</b> playoffs, <b>{preview.rankings.length}</b> rankings,{' '}
                <b>{preview.alliances.length}</b> alliances
                {preview.warnings.length > 0 && <span className="text-warn"> · {preview.warnings.length} score warnings</span>}
              </p>
            )
          )}
          <Button variant="primary" onClick={() => void doImport()}>
            <CheckCircle2 size={16} /> Import
          </Button>
        </div>
      )}
      {result && <p className="mt-3 rounded-lg bg-good/10 p-2 text-sm text-good">{result}</p>}
    </Card>
  );
}

function DemoControls() {
  const quals = useLiveQuery(() => db.matches.where('comp_level').equals('qm').count(), [], 0);
  const [cut, setCut] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useMemo(() => {
    void getDemoCutoff().then((c) => setCut(Number.isFinite(c) ? String(c) : 'all'));
  }, []);
  return (
    <Card title="Demo sandbox (449's simulated event)" className="border-warn/50">
      <p className="mb-3 text-sm text-muted">
        Replay the event mid-day to test predictions, availability and the draft board. Scores are recomputed with our rules (their sim scored oven cakes at
        2; the manual says 1) — mismatches show as data warnings.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Show results through">
          <select className={`${inputCls} w-40`} value={cut} onChange={(e) => setCut(e.target.value)}>
            <option value="all">All (incl. playoffs)</option>
            {Array.from({ length: Math.max(quals, 32) + 1 }, (_, i) => (
              <option key={i} value={String(i)}>
                {i === 0 ? 'Before Q1' : `Q${i}`}
              </option>
            ))}
          </select>
        </Field>
        <Button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await loadDemo(cut === 'all' ? Infinity : Number(cut));
              setMsg(`Loaded ${r.quals} quals, ${r.playoffs} playoffs · ${r.warnings} score warnings`);
            } catch (e) {
              setMsg((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Reload demo
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  );
}

function Snapshots() {
  const snaps = useLiveQuery(() => db.api_snapshots.orderBy('id').reverse().limit(12).toArray(), [], []);
  if (!snaps.length) return null;
  return (
    <Card title="Raw API snapshots (latest)">
      <ul className="space-y-1 text-sm">
        {snaps.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1">
            <span>
              {s.endpoint} <span className="text-muted">#{s.hash}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-muted">
              {formatAgo(new Date(s.fetched_at).getTime())}
              <button
                className="underline"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(s.payload, null, 2)], { type: 'application/json' });
                  window.open(URL.createObjectURL(blob), '_blank');
                }}
              >
                view
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
