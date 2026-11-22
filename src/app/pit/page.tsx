'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { useTeams } from '@/data/hooks';
import { putRow } from '@/data/repo';
import type { PitData, PitReport } from '@/data/types';
import { mergePit, validatePit, PIT_LABELS } from '@/catalog/pit';
import { HARVEST_HAVOC as G, ROLE_LABEL, ROLES, type Shelf, type Target } from '@/game/harvestHavoc.config';
import { useAuth, whoAmI, can } from '@/sync/auth';
import { displayTeam } from '@/lib/teamIds';
import { nowIso, uuid } from '@/lib/util';
import { isOurTeam } from '@/config/event';
import { Badge, Button, Card, Empty, Field, PageTitle, cx, haptic, inputCls } from '@/components/ui';
import { PhotoManager } from '@/components/PhotoManager';
import { usePhotoMap, TeamAvatar } from '@/components/TeamChip';

export default function PitPage() {
  return (
    <Suspense fallback={null}>
      <PitInner />
    </Suspense>
  );
}

function PitInner() {
  const id = useSearchParams().get('id');
  const auth = useAuth();
  if (!can.pitScout(auth.role)) return <Empty title="Scouts only">Ask an admin to make you a scout.</Empty>;
  return id ? <PitForm team={id} /> : <TeamPicker />;
}

function TeamPicker() {
  const teams = useTeams() ?? [];
  const photos = usePhotoMap();
  const reports = useLiveQuery(() => db.pit_reports.toArray(), [], []);
  const done = new Set(reports.map((r) => r.team_id));
  const photoDone = new Set([...photos.keys()]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageTitle sub={`${done.size} of ${teams.length} teams pit-scouted · ${photoDone.size} with photos`}>Pit scouting</PageTitle>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {teams.map((t) => (
          <li key={t.id}>
            <Link
              href={`/pit/?id=${encodeURIComponent(t.id)}`}
              className={cx('flex items-center gap-2 rounded-xl border border-line bg-surface p-2 hover:border-saxon', isOurTeam(t.id) && 'ours')}
            >
              <TeamAvatar team={t.id} url={photos.get(t.id)} size={40} />
              <div className="min-w-0">
                <div className="font-bold tnum">{displayTeam(t.id)}</div>
                <div className="flex gap-1">
                  {done.has(t.id) ? <Badge tone="good">pit ✓</Badge> : <Badge>pit —</Badge>}
                  {photoDone.has(t.id) ? <Badge tone="good">📷</Badge> : null}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function YesNo({ value, onChange }: { value?: boolean; onChange: (v: boolean | undefined) => void }) {
  return (
    <div className="flex gap-1">
      {[
        [true, 'Yes'],
        [false, 'No'],
      ].map(([v, l]) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(value === v ? undefined : (v as boolean))}
          className={cx('tap rounded-xl border px-4', value === v ? 'border-saxon bg-saxon font-semibold text-saxon-ink' : 'border-line bg-surface-2 text-muted')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value?: T; options: Record<T, string>; onChange: (v: T | undefined) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {(Object.entries(options) as [T, string][]).map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(value === k ? undefined : k)}
          className={cx('tap rounded-xl border px-3 text-sm', value === k ? 'border-saxon bg-saxon font-semibold text-saxon-ink' : 'border-line bg-surface-2 text-muted')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Multi<T extends string>({ value, options, onChange }: { value?: T[]; options: Record<T, string>; onChange: (v: T[]) => void }) {
  const v = value ?? [];
  return (
    <div className="flex flex-wrap gap-1">
      {(Object.entries(options) as [T, string][]).map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(v.includes(k) ? v.filter((x) => x !== k) : [...v, k])}
          className={cx('tap rounded-xl border px-3 text-sm', v.includes(k) ? 'border-saxon bg-saxon font-semibold text-saxon-ink' : 'border-line bg-surface-2 text-muted')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function PitForm({ team }: { team: string }) {
  const router = useRouter();
  const me = whoAmI();
  const all = useLiveQuery(() => db.pit_reports.where('team_id').equals(team).toArray(), [team], []);
  const mine = useMemo(() => all.find((r) => (me.id ? r.author_id === me.id : r.author_name === me.name)), [all, me.id, me.name]);
  const merged = useMemo(() => mergePit(all), [all]);
  const [d, setD] = useState<PitData>({});
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded || all === undefined) return;
    // start from my own report, else from the team's merged catalog entry
    setD(mine?.data ?? merged);
    setLoaded(true);
  }, [all, mine, merged, loaded]);

  const set = (p: Partial<PitData>) => {
    setD((x) => ({ ...x, ...p }));
    setSaved(false);
  };
  const issues = validatePit(d);
  const num = (v: string) => (v === '' ? undefined : Number(v));

  const save = async () => {
    const row: PitReport = {
      id: mine?.id ?? uuid(),
      team_id: team,
      author_id: me.id,
      author_name: me.name,
      data: d,
      created_at: mine?.created_at ?? nowIso(),
      updated_at: nowIso(),
    };
    await putRow('pit_reports', row);
    haptic(20);
    setSaved(true);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle
        sub={`${all.length} report(s) for this team · yours ${mine ? 'exists' : 'is new'}`}
        actions={
          <Link href={`/team/?id=${encodeURIComponent(team)}`}>
            <Button size="sm">Team profile</Button>
          </Link>
        }
      >
        Pit scout {displayTeam(team)}
      </PageTitle>
      <Card title="Robot photos">
        <PhotoManager team={team} />
      </Card>
      <Card title="Scoring">
        <div className="space-y-4">
          <Field label="Scoring mechanism">
            <Choice value={d.mechanism} options={PIT_LABELS.mechanism} onChange={(v) => set({ mechanism: v })} />
          </Field>
          <Field label="Pantry levels reachable">
            <Multi<Shelf> value={d.levels} options={{ L1: 'L1', L2: 'L2', L3: 'L3' }} onChange={(v) => set({ levels: v })} />
          </Field>
          <Field label="Handles">
            <Choice value={d.handles} options={PIT_LABELS.handles} onChange={(v) => set({ handles: v })} />
          </Field>
          <Field label="Oven capable">
            <Choice value={d.oven} options={PIT_LABELS.oven} onChange={(v) => set({ oven: v })} />
          </Field>
          <Field label="Role">
            <Choice value={d.role} options={Object.fromEntries(ROLES.map((r) => [r, ROLE_LABEL[r]])) as Record<(typeof ROLES)[number], string>} onChange={(v) => set({ role: v })} />
          </Field>
          <Field label="Handoff capable (e.g. oven-only robot passes a cake to a Pantry robot)">
            <YesNo value={d.handoff} onChange={(v) => set({ handoff: v })} />
          </Field>
        </div>
      </Card>
      <Card title="Drive & intake">
        <div className="space-y-4">
          <Field label="Drivetrain">
            <Choice value={d.drivetrain} options={PIT_LABELS.drivetrain} onChange={(v) => set({ drivetrain: v })} />
          </Field>
          <Field label="Ground intake">
            <YesNo value={d.groundIntake} onChange={(v) => set({ groundIntake: v })} />
          </Field>
          {d.groundIntake && (
            <Field label="Ground intake reliability (auto-updates from match reports)">
              <Choice value={d.groundIntakeReliability} options={PIT_LABELS.reliability} onChange={(v) => set({ groundIntakeReliability: v })} />
            </Field>
          )}
          <Field label="Intake sources">
            <Multi value={d.intakeSources} options={PIT_LABELS.intake} onChange={(v) => set({ intakeSources: v })} />
          </Field>
        </div>
      </Card>
      <Card title="Auto & endgame">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Auto: taxi?">
              <YesNo value={d.autoTaxi} onChange={(v) => set({ autoTaxi: v })} />
            </Field>
            <Field label="Auto: scores both preloads?">
              <YesNo value={d.autoScoresBothPreloads} onChange={(v) => set({ autoScoresBothPreloads: v })} />
            </Field>
            <Field label="Auto: picks up prestaged carrots?">
              <YesNo value={d.autoPicksPrestaged} onChange={(v) => set({ autoPicksPrestaged: v })} />
            </Field>
            <Field label="Can park?">
              <YesNo value={d.canPark} onChange={(v) => set({ canPark: v })} />
            </Field>
          </div>
          <Field label="Auto: where does it score?">
            <Multi<Target> value={d.autoTargets} options={{ L1: 'L1', L2: 'L2', L3: 'L3', oven: 'Oven' }} onChange={(v) => set({ autoTargets: v })} />
          </Field>
          <Field label="Auto description">
            <input className={inputCls} value={d.autoDescription ?? ''} onChange={(e) => set({ autoDescription: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Max haul (0–${G.haul.maxPiecesPerRobot})`}>
              <Choice<'0' | '1' | '2' | '3'> value={d.maxHaul !== undefined ? (String(d.maxHaul) as '0') : undefined} options={{ '0': '0', '1': '1', '2': '2', '3': '3' }} onChange={(v) => set({ maxHaul: v === undefined ? undefined : Number(v) })} />
            </Field>
            <Field label="Carries cakes in the haul?">
              <YesNo value={d.haulsCakes} onChange={(v) => set({ haulsCakes: v })} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Robot & team">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Weight (lb, no battery/bumpers ≤ ${G.robotLimits.weightMaxLbNoBatteryNoBumpers})`}>
            <input className={inputCls} inputMode="decimal" value={d.weightLb ?? ''} onChange={(e) => set({ weightLb: num(e.target.value) })} />
          </Field>
          <Field label={`Frame perimeter (in, ≤ ${G.robotLimits.framePerimeterMaxIn})`}>
            <input className={inputCls} inputMode="decimal" value={d.framePerimeterIn ?? ''} onChange={(e) => set({ framePerimeterIn: num(e.target.value) })} />
          </Field>
          <Field label={`Start height (in, ≤ ${G.robotLimits.startHeightMaxIn})`}>
            <input className={inputCls} inputMode="decimal" value={d.startHeightIn ?? ''} onChange={(e) => set({ startHeightIn: num(e.target.value) })} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Human player quality (Ramp/Depot speed, cake throws)">
            <Choice<'1' | '2' | '3' | '4' | '5'>
              value={d.humanPlayerQuality !== undefined ? (String(d.humanPlayerQuality) as '1') : undefined}
              options={{ '1': '1', '2': '2', '3': '3', '4': '4', '5': '5' }}
              onChange={(v) => set({ humanPlayerQuality: v === undefined ? undefined : Number(v) })}
            />
          </Field>
          <Field label="Driver experience">
            <input className={inputCls} value={d.driverExperience ?? ''} onChange={(e) => set({ driverExperience: e.target.value })} placeholder="e.g. 2nd year driver" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Notes">
            <textarea className="h-24 w-full rounded-xl border border-line bg-surface-2 p-2" value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </Card>
      {issues.length > 0 && (
        <Card className="border-bad/50" title="Rule check">
          <ul className="list-disc pl-5 text-sm text-bad">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="safe-bottom sticky bottom-20 z-10 flex gap-2 lg:bottom-4">
        <Button variant="primary" size="lg" className="flex-1" onClick={() => void save()}>
          {saved ? 'Saved ✓' : 'Save pit report'}
        </Button>
        <Button size="lg" onClick={() => router.push('/pit/')}>
          Next team
        </Button>
      </div>
    </div>
  );
}
