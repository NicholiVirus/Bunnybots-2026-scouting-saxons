import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '@/data/db';
import { deleteRows, putRow, saveScoutingBundle } from '@/data/repo';
import { syncStatus } from './status';
import { SyncEngine } from './engine';
import { newDraft } from '@/scouting/session';

type Call = { kind: string; table?: string; payload?: unknown };

/** Minimal fake of the supabase-js surface the engine uses. */
function fakeClient(opts: { fail?: (c: Call) => { message: string; code?: string; status: number } | null; rows?: Record<string, Record<string, unknown>[]> } = {}) {
  const calls: Call[] = [];
  const respond = (c: Call) => {
    calls.push(c);
    const f = opts.fail?.(c) ?? null;
    return Promise.resolve(f ? { data: null, error: { message: f.message, code: f.code ?? '' }, status: f.status } : { data: null, error: null, status: 200 });
  };
  const select = (table: string) => {
    const q = {
      _gte: '' as string,
      gte(_c: string, v: string) {
        q._gte = v;
        return q;
      },
      order() {
        return q;
      },
      limit() {
        const rows = (opts.rows?.[table] ?? []).filter((r) => String(r.updated_at) >= q._gte);
        return Promise.resolve({ data: rows, error: null, status: 200 });
      },
      in(col: string, vals: string[]) {
        const rows = (opts.rows?.[table] ?? []).filter((r) => vals.includes(String(r[col])));
        return Promise.resolve({ data: rows, error: null, status: 200 });
      },
    };
    return q;
  };
  const client = {
    from: (table: string) => ({
      upsert: (payload: unknown) => respond({ kind: 'upsert', table, payload }),
      update: (payload: unknown) => ({ eq: () => respond({ kind: 'update', table, payload }) }),
      select: () => select(table),
    }),
    rpc: (name: string, args: unknown) => respond({ kind: `rpc:${name}`, payload: args }),
    auth: { refreshSession: () => Promise.resolve({}) },
    storage: { from: () => ({ upload: () => respond({ kind: 'upload' }) }) },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  syncStatus.set({ active: true });
});

describe('sync engine — push', () => {
  it('pushes queued rows and scouting bundles, then empties the outbox', async () => {
    await putRow('teams', { id: '7777', number: 7777, name: 'Walk-in', status: 'expected', notes: null });
    const b = newDraft('Q1', 'red', ['611'], ['red1']);
    await saveScoutingBundle({ ...b, submission: { ...b.submission, status: 'submitted' } });
    expect(await db.outbox.count()).toBe(2);
    const { client, calls } = fakeClient();
    const e = new SyncEngine();
    e.attachForTest(client);
    await e.push();
    expect(calls.map((c) => c.kind)).toEqual(['upsert', 'rpc:submit_scouting']);
    expect((calls[0].payload as Record<string, unknown>).updated_at).toBeUndefined(); // server owns updated_at
    expect(await db.outbox.count()).toBe(0);
  });

  it('sends only the listed columns for a partial write; the local row is still written in full', async () => {
    const stream = {
      id: 's1',
      url: 'https://www.youtube.com/@x/live',
      first_label: '',
      example_start: null,
      keep_waiting: true,
      requested: 'run',
      state: 'recording',
      status: 'recording Q3',
      title: 'Day 1',
      matches: [{ label: 'Q3', at_s: 63 }],
      worker: 'video-pc',
      heartbeat_at: '2026-12-05T15:00:00Z',
      deleted_at: null,
    };
    await putRow('video_streams', { ...stream, requested: 'stop' }, { columns: ['url', 'requested'] });
    await deleteRows('video_streams', [{ ...stream, id: 's2' }], { columns: ['url', 'requested'] });
    const { client, calls } = fakeClient();
    const e = new SyncEngine();
    e.attachForTest(client);
    await e.push();
    expect(calls.map((c) => c.kind)).toEqual(['upsert', 'upsert']);
    expect(calls[0].payload).toEqual({ id: 's1', url: stream.url, requested: 'stop' });
    expect(Object.keys(calls[1].payload as object).sort()).toEqual(['deleted_at', 'id', 'requested', 'url']);
    expect(await db.video_streams.get('s1')).toMatchObject({ requested: 'stop', state: 'recording', matches: stream.matches });
  });

  it('coalesces repeated edits of the same row into one push', async () => {
    for (const name of ['a', 'b', 'c']) await putRow('teams', { id: '7777', number: 7777, name, status: 'expected', notes: null });
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps items queued on network failure, then flushes when back online', async () => {
    await putRow('teams', { id: '1', number: 1, name: 'x', status: 'confirmed', notes: null });
    let offline = true;
    const { client, calls } = fakeClient({ fail: () => (offline ? { message: 'TypeError: Failed to fetch', status: 0 } : null) });
    const e = new SyncEngine();
    e.attachForTest(client);
    await e.push();
    const item = await db.outbox.toCollection().first();
    expect(item?.status).toBe('pending');
    expect(item?.attempts).toBe(1);
    offline = false;
    e.attachForTest(client); // resets backoff (like the 'online' event)
    await e.push();
    expect(await db.outbox.count()).toBe(0);
    expect(calls.length).toBe(2);
  });

  it('parks permission errors as failed without blocking later items', async () => {
    await putRow('matches', { key: 'Q1', comp_level: 'qm', match_number: 1, label: 'Q1', red: [], blue: [], played: false, red_score: null, blue_score: null, source: 'manual' });
    await putRow('teams', { id: '2', number: 2, name: 'ok', status: 'confirmed', notes: null });
    const { client } = fakeClient({ fail: (c) => (c.table === 'matches' ? { message: 'new row violates row-level security policy', code: '42501', status: 403 } : null) });
    const e = new SyncEngine();
    e.attachForTest(client);
    await e.push();
    const left = await db.outbox.toArray();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ table: 'matches', status: 'failed' });
    expect(left[0].last_error).toMatch(/row-level security/);
  });
});

describe('sync engine — pull', () => {
  it('applies server rows, tombstones deletions, and never overwrites unsent local edits', async () => {
    await db.teams.bulkPut([
      { id: '611', number: 611, name: 'local', status: 'confirmed', updated_at: '' },
      { id: '999', number: 999, name: 'gone soon', status: 'confirmed', updated_at: '' },
    ]);
    await putRow('teams', { id: '526', number: 526, name: 'my unsent edit', status: 'confirmed', notes: null });
    const { client } = fakeClient({
      rows: {
        teams: [
          { id: '611', number: 611, name: 'Saxons (server)', status: 'confirmed', updated_at: '2026-12-12T10:00:00Z', deleted_at: null },
          { id: '526', number: 526, name: 'older server copy', status: 'confirmed', updated_at: '2026-12-12T10:00:01Z', deleted_at: null },
          { id: '999', number: 999, name: 'gone soon', status: 'confirmed', updated_at: '2026-12-12T10:00:02Z', deleted_at: '2026-12-12T10:00:02Z' },
        ],
      },
    });
    const e = new SyncEngine();
    e.attachForTest(client);
    await e.pullAll();
    expect((await db.teams.get('611'))?.name).toBe('Saxons (server)');
    expect((await db.teams.get('526'))?.name).toBe('my unsent edit');
    expect(await db.teams.get('999')).toBeUndefined();
    expect((await db.kv.get('cursor:teams'))?.value).toBe('2026-12-12T10:00:02Z');
  });

  it('pulls a submission together with its reports and full event log', async () => {
    const sid = '11111111-1111-4111-8111-111111111111';
    const { client } = fakeClient({
      rows: {
        scout_submissions: [{ id: sid, match_key: 'Q3', alliance: 'blue', teams: ['449b'], stations: ['blue3'], robot_count: 1, status: 'submitted', updated_at: '2026-12-12T11:00:00Z', deleted_at: null }],
        robot_reports: [{ id: `${sid}:449b`, submission_id: sid, team_id: '449b', note: 'fast', flags: [], mechanisms: {} }],
        scout_events: [{ id: 'e1', submission_id: sid, team_id: '449b', t_ms: 20000, phase: 'teleop', action: 'score', piece: 'cake', target: 'L3', detail: null }],
      },
    });
    const e = new SyncEngine();
    e.attachForTest(client);
    await e.pullAll();
    expect(await db.scout_submissions.get(sid)).toBeTruthy();
    expect(await db.robot_reports.where('submission_id').equals(sid).count()).toBe(1);
    expect(await db.scout_events.where('submission_id').equals(sid).count()).toBe(1);
  });
});
