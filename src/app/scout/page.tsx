'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, QrCode, RotateCcw } from 'lucide-react';
import { db } from '@/data/db';
import { loadScoutingBundle, saveScoutingBundle, type ScoutingBundle } from '@/data/repo';
import { getPrefs } from '@/lib/prefs';
import { debounce, nowIso } from '@/lib/util';
import { displayTeam } from '@/lib/teamIds';
import { useAuth, can } from '@/sync/auth';
import { emptyReport, findResumable, newDraft, useScoutSession } from '@/scouting/session';
import { Badge, Button, Card, Empty, PageTitle, Spinner } from '@/components/ui';
import { Setup, type SetupChoice } from '@/components/scout/Setup';
import { Live } from '@/components/scout/Live';
import { PostMatch } from '@/components/scout/PostMatch';

type Step = 'loading' | 'setup' | 'live' | 'post' | 'done';

export default function ScoutPage() {
  return (
    <Suspense fallback={null}>
      <ScoutInner />
    </Suspense>
  );
}

function ScoutInner() {
  const auth = useAuth();
  const edit = useSearchParams().get('edit');
  const [step, setStep] = useState<Step>('loading');
  const [initial, setInitial] = useState<ScoutingBundle | null>(null);
  const s = useScoutSession(initial);
  const [resubmit, setResubmit] = useState(false);

  useEffect(() => {
    void (async () => {
      if (edit) {
        const b = await loadScoutingBundle(edit);
        if (b) {
          setInitial(b);
          setResubmit(b.submission.status === 'submitted');
          setStep(b.submission.status === 'live' ? 'live' : 'post');
          return;
        }
      }
      const r = await findResumable(getPrefs().deviceId);
      if (r?.submission.status === 'live') {
        setInitial(r);
        setStep('live');
      } else {
        setInitial(r);
        setStep('setup');
      }
    })();
  }, [edit]);

  // keep a draft submission in sync with the selection so other scouts see coverage
  const draftRef = useRef<ScoutingBundle | null>(null);
  draftRef.current = s.bundle;
  const syncDraft = useRef(
    debounce(async (c: SetupChoice | null) => {
      const cur = draftRef.current;
      if (!c) {
        if (cur && cur.submission.status === 'draft' && !cur.submission.deleted_at) {
          await saveScoutingBundle({ ...cur, submission: { ...cur.submission, deleted_at: nowIso() } });
          s.setBundle(null);
        }
        return;
      }
      if (cur && cur.submission.status === 'draft' && !cur.submission.deleted_at) {
        const same = cur.submission.match_key === c.match.key && cur.submission.teams.join() === c.teams.join();
        if (same) return;
        const id = cur.submission.id;
        const next: ScoutingBundle = {
          submission: { ...cur.submission, match_key: c.match.key, alliance: c.alliance, teams: c.teams, stations: c.stations, robot_count: c.teams.length },
          reports: c.teams.map((t, i) => cur.reports.find((r) => r.team_id === t) ?? emptyReport(id, t, c.stations[i])),
          events: [],
        };
        s.setBundle(next);
        await saveScoutingBundle(next);
      } else {
        const d = newDraft(c.match.key, c.alliance, c.teams, c.stations);
        s.setBundle(d);
        await saveScoutingBundle(d);
      }
    }, 700),
  ).current;

  const onStart = useCallback(
    async (c: SetupChoice) => {
      syncDraft.flush();
      let b = draftRef.current;
      if (!b || b.submission.match_key !== c.match.key || b.submission.teams.join() !== c.teams.join() || b.submission.status !== 'draft') {
        b = newDraft(c.match.key, c.alliance, c.teams, c.stations);
      }
      const live: ScoutingBundle = {
        ...b,
        submission: { ...b.submission, status: 'live', started_at: Date.now(), deleted_at: null },
        events: [],
      };
      s.setBundle(live);
      await saveScoutingBundle(live);
      setStep('live');
    },
    [s, syncDraft],
  );

  if (!can.scout(auth.role)) return <Empty title="Scouts only">Ask an admin to make you a scout (Admin → Users & roles).</Empty>;
  if (step === 'loading')
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );

  if (step === 'live' && s.bundle) return <Live s={s} onEnd={() => setStep('post')} />;

  if (step === 'post' && s.bundle)
    return (
      <div>
        <PageTitle sub={`${s.bundle.submission.alliance} · ${s.bundle.submission.teams.map(displayTeam).join(', ')}`}>Post-match · {s.bundle.submission.match_key}</PageTitle>
        <PostMatch
          s={s}
          resubmit={resubmit}
          onSubmit={() => {
            s.setStatus('submitted');
            setStep('done');
          }}
        />
      </div>
    );

  if (step === 'done' && s.bundle)
    return (
      <div className="mx-auto max-w-md space-y-4 py-6 text-center">
        <CheckCircle2 className="mx-auto text-good" size={56} />
        <h1 className="text-2xl font-bold">Saved {s.bundle.submission.match_key}</h1>
        <p className="text-muted">Saved on this device. It syncs automatically when there is a connection — or hand it over by QR.</p>
        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              s.setBundle(null);
              setResubmit(false);
              setInitial(null);
              setStep('setup');
            }}
          >
            Scout next match
          </Button>
          <Link href={`/transfer/?id=${s.bundle.submission.id}`}>
            <Button size="lg" className="w-full">
              <QrCode /> Show QR code
            </Button>
          </Link>
        </div>
      </div>
    );

  return (
    <div>
      <PageTitle sub="Pick the match, your alliance and the robots you'll watch">Scout</PageTitle>
      {initial?.submission.status === 'draft' && (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted">
          <RotateCcw size={14} /> Draft restored.
        </p>
      )}
      <Setup onStart={(c) => void onStart(c)} onSelectionChange={(c) => void syncDraft(c)} draftId={s.bundle?.submission.status === 'draft' ? s.bundle.submission.id : undefined} />
      <MySubmissions />
    </div>
  );
}

function MySubmissions() {
  const subs = useLiveQuery(
    () =>
      db.scout_submissions
        .filter((x) => x.device_id === getPrefs().deviceId && x.status === 'submitted' && !x.deleted_at)
        .toArray()
        .then((a) => a.sort((p, q) => String(q.submitted_at).localeCompare(String(p.submitted_at))).slice(0, 15)),
    [],
    [],
  );
  const pending = useLiveQuery(() => db.outbox.where('status').equals('pending').toArray(), [], []);
  const pendingKeys = new Set(pending.map((p) => p.key));
  if (!subs.length) return null;
  return (
    <Card title="My recent submissions" className="mx-auto mt-6 max-w-xl">
      <ul className="divide-y divide-line">
        {subs.map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              <b>{x.match_key}</b> <span className={x.alliance === 'red' ? 'text-redA' : 'text-blueA'}>{x.alliance}</span> · {x.teams.map(displayTeam).join(', ')}
              {pendingKeys.has(x.id) && (
                <Badge tone="warn" className="ml-1">
                  not synced
                </Badge>
              )}
            </span>
            <span className="flex gap-1">
              <Link href={`/scout/?edit=${x.id}`}>
                <Button size="sm">Edit</Button>
              </Link>
              <Link href={`/transfer/?id=${x.id}`}>
                <Button size="sm" aria-label="QR">
                  <QrCode size={16} />
                </Button>
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
