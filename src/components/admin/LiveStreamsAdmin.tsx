'use client';
/**
 * Admin -> Data sources: live-stream links for the automatic video scout. The video PC
 * (`bunnyscout saxon-worker`) records each link, splits it into matches by the field's start sound,
 * analyses every match and uploads the results, which then show next to the human scouting.
 */
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Radio } from 'lucide-react';
import { db } from '@/data/db';
import { deleteRows, putRow, serverSyncActive } from '@/data/repo';
import type { StreamState, VideoStream } from '@/data/types';
import { parseClock, parseStreamLink, workerOnline } from '@/sources/video';
import { Badge, Button, Card, Field, Toggle, inputCls } from '@/components/ui';
import { formatAgo, uuid } from '@/lib/util';

const STATE: Record<StreamState, { text: string; tone: 'neutral' | 'good' | 'warn' | 'bad' | 'saxon' }> = {
  queued: { text: 'waiting for the video PC', tone: 'neutral' },
  waiting: { text: 'waiting for the stream', tone: 'warn' },
  recording: { text: 'recording', tone: 'good' },
  ended: { text: 'done', tone: 'saxon' },
  stopped: { text: 'stopped', tone: 'neutral' },
  error: { text: 'error', tone: 'bad' },
};

/**
 * Columns the app owns; the video PC writes the rest (state, status, title, matches, worker, heartbeat).
 * Stop / Restart / Remove send only these, so a stale copy on this device can't wipe the PC's latest progress.
 * All of them, not just `requested`: if the "add" is still queued offline, this write replaces it and must
 * still create the row.
 */
const APP_COLUMNS = ['url', 'first_label', 'example_start', 'keep_waiting', 'requested'] as const;

const isRunning = (s: VideoStream) => !['ended', 'stopped', 'error'].includes(s.state);

const fmtAt = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};

export function LiveStreamsAdmin() {
  const streams = useLiveQuery(() => db.video_streams.toArray(), []);
  const [link, setLink] = useState('');
  const [first, setFirst] = useState('');
  const [example, setExample] = useState('');
  const [keepWaiting, setKeepWaiting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const parsed = link.trim() ? parseStreamLink(link) : null;
  const exampleS = parseClock(example);
  const firstOk = !first.trim() || /^[A-Za-z]+\d+(-\d+)?$/.test(first.trim());
  const canAdd = parsed?.ok && !Number.isNaN(exampleS) && firstOk;
  const synced = serverSyncActive();

  const add = async () => {
    if (!parsed?.ok || Number.isNaN(exampleS)) return;
    const row: Omit<VideoStream, 'updated_at'> = {
      id: uuid(),
      url: parsed.url,
      first_label: first.trim().toUpperCase(),
      example_start: exampleS,
      keep_waiting: keepWaiting || parsed.channel,
      requested: 'run',
      state: 'queued',
      status: '',
      title: '',
      matches: [],
      worker: '',
      heartbeat_at: null,
      deleted_at: null,
    };
    await putRow('video_streams', row);
    setLink('');
    setFirst('');
    setExample('');
    setKeepWaiting(false);
  };
  const stop = (s: VideoStream) => putRow('video_streams', { ...s, requested: 'stop' }, { columns: APP_COLUMNS });
  // restart also resets the PC's state so it picks the link up again
  const restart = (s: VideoStream) =>
    putRow('video_streams', { ...s, requested: 'run', state: 'queued', status: '' }, { columns: [...APP_COLUMNS, 'state', 'status'] });
  const remove = (s: VideoStream) => {
    const running = isRunning(s);
    const ask = running ? 'Stop recording and remove this stream from the list? Matches already found stay.' : 'Remove this stream from the list? Matches already found stay.';
    // a running stream is also asked to stop, so the video PC doesn't keep recording a link nobody can see
    if (window.confirm(ask)) void deleteRows('video_streams', [running ? { ...s, requested: 'stop' } : s], { columns: APP_COLUMNS });
  };

  const list = [...(streams ?? [])].sort((a, b) => (b.created_at ?? b.updated_at).localeCompare(a.created_at ?? a.updated_at));
  const online = list.some((s) => workerOnline(s.heartbeat_at, now));

  return (
    <Card title="Live streams (automatic video scouting)">
      <p className="mb-3 text-sm text-muted">
        Paste the event&apos;s YouTube or Twitch link. The video PC (running <code>bunnyscout saxon-worker</code>, signed in as a
        Strategist or Admin) records it, finds every match by the field&apos;s start sound, names it from the schedule, analyses it and
        uploads the results a few minutes after each match. A past broadcast works too.
      </p>
      {!synced && (
        <p className="mb-3 rounded-lg bg-warn/10 p-2 text-sm text-warn">
          Server sync is off on this device, so the video PC can&apos;t see links added here.
        </p>
      )}
      <div className="space-y-2">
        <Field
          label="Stream link"
          error={parsed && !parsed.ok ? parsed.error : undefined}
          hint={parsed?.ok && parsed.channel ? 'Channel link: it records whatever the channel streams, and waits for the next stream when one ends.' : undefined}
        >
          <input
            className={inputCls}
            placeholder="https://www.youtube.com/@channel/live or youtube.com/watch?v=…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            inputMode="url"
            autoComplete="off"
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="First match in it (optional)" hint="Blank = the next match with no video yet." error={firstOk ? undefined : 'e.g. Q12'}>
            <input className={inputCls} placeholder="Q12" value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field
            label="One match start (optional)"
            hint="Time into the stream (1:02:05) when a match started. Needed once per event for a past broadcast; live, it is learnt from the match clock."
            error={Number.isNaN(exampleS) ? 'Use h:mm:ss, m:ss or seconds' : undefined}
          >
            <input className={inputCls} placeholder="1:02:05" value={example} onChange={(e) => setExample(e.target.value)} />
          </Field>
        </div>
        {parsed?.ok && !parsed.channel && (
          <Toggle checked={keepWaiting} onChange={setKeepWaiting} label="Keep waiting for the next stream when this one ends" />
        )}
        <Button variant="primary" onClick={() => void add()} disabled={!canAdd}>
          <Radio size={16} /> Add stream
        </Button>
      </div>

      {list.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted">
            {online ? 'Video PC online.' : 'Video PC offline: start bunnyscout saxon-worker on it.'}
          </p>
          {list.map((s) => {
            const st = STATE[s.state] ?? STATE.queued;
            const running = isRunning(s);
            return (
              <div key={s.id} className="rounded-xl border border-line p-2 text-sm" data-testid="video-stream">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={st.tone}>{s.requested === 'stop' && running ? 'stopping' : st.text}</Badge>
                  <a className="min-w-0 flex-1 truncate underline" href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title || s.url}
                  </a>
                  {running ? (
                    <Button size="sm" onClick={() => void stop(s)} disabled={s.requested === 'stop'}>
                      Stop
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void restart(s)}>
                      Restart
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => remove(s)}>
                    Remove
                  </Button>
                </div>
                {(s.status || s.heartbeat_at) && (
                  <p className="mt-1 text-xs text-muted">
                    {s.status}
                    {s.heartbeat_at ? ` · ${s.worker || 'video PC'} ${formatAgo(Date.parse(s.heartbeat_at), now)}` : ''}
                  </p>
                )}
                {s.matches.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.matches.map((m) => (
                      <Badge key={`${m.label}-${m.at_s}`} tone={m.note ? 'warn' : 'neutral'} title={m.note ?? `starts ${fmtAt(m.at_s)} into the recording`}>
                        {m.label}
                        {m.note ? ' (cut off)' : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
