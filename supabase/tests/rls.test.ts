/**
 * Row-Level Security tests: run the REAL migration in Postgres 17 (PGlite, in
 * process) and prove each role can only do what §6 of the brief allows.
 *
 *   npm run test:rls
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const shim = readFileSync(path.join(root, 'tests', 'supabase-shim.sql'), 'utf8');
const migration = ['0001_init.sql', '0002_admin_passcode.sql'].map((f) => readFileSync(path.join(root, 'migrations', f), 'utf8')).join('\n');
const seed = readFileSync(path.join(root, 'seed.sql'), 'utf8');

const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  strategist: '00000000-0000-4000-8000-000000000002',
  scout: '00000000-0000-4000-8000-000000000003',
  scout2: '00000000-0000-4000-8000-000000000004',
  viewer: '00000000-0000-4000-8000-000000000005',
};

let db: PGlite;

async function asSuper() {
  await db.exec(`reset role; set request.jwt.claim.sub = '';`);
}
async function asUser(id: string) {
  await db.exec(`reset role; set request.jwt.claim.sub = '${id}'; set role authenticated;`);
}
async function asAnon() {
  await db.exec(`reset role; set request.jwt.claim.sub = ''; set role anon;`);
}
const DENIED = /row-level security|permission denied|only an admin|cannot remove the last admin/i;

async function rows(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}
async function affected(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).affectedRows ?? 0;
}

function bundle(id: string, scoutId: string, team = '611') {
  return JSON.stringify({
    submission: {
      id,
      match_key: 'Q1',
      alliance: 'red',
      teams: [team],
      stations: ['red1'],
      robot_count: 1,
      scout_id: scoutId,
      scout_name: 'Test',
      device_id: 'dev',
      status: 'submitted',
      started_at: 1,
      submitted_at: new Date().toISOString(),
      source: 'app',
      discarded: false,
      discard_reason: null,
      app_version: 'test',
      created_at: new Date().toISOString(),
    },
    reports: [{ id: `${id}:${team}`, team_id: team, station: 'red1', note: 'ok', flags: ['died'], mechanisms: {} }],
    events: [
      { id: crypto.randomUUID(), team_id: team, t_ms: 20000, phase: 'teleop', action: 'score', piece: 'cake', target: 'L3', detail: null },
    ],
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(shim);
  await db.exec(migration);
  await db.exec(seed);
  // Sign-ups (the trigger creates profiles; the very first account becomes admin)
  for (const [name, id] of Object.entries(U)) {
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      `${name}@example.com`,
      JSON.stringify({ full_name: name }),
    ]);
  }
  // Promote via the SQL editor path (trusted): strategist + scouts
  await db.exec(`
    update public.profiles set role = 'strategist' where id = '${U.strategist}';
    update public.profiles set role = 'scout' where id in ('${U.scout}', '${U.scout2}');
  `);
});

describe('sign-up roles', () => {
  it('first account is admin, later accounts default to viewer', async () => {
    await asSuper();
    const r = await rows(`select id, role from public.profiles order by created_at, id`);
    const byId = Object.fromEntries(r.map((x) => [x.id, x.role]));
    expect(byId[U.admin]).toBe('admin');
    expect(byId[U.viewer]).toBe('viewer');
  });
});

describe('Public (not signed in)', () => {
  it('cannot read or write any table', async () => {
    await asAnon();
    await expect(rows(`select * from public.teams`)).rejects.toThrow(DENIED);
    await expect(rows(`insert into public.teams (id, number, name) values ('9999', 9999, 'x')`)).rejects.toThrow(DENIED);
    await expect(rows(`insert into public.draft_actions (id, seq, action) values (gen_random_uuid(), 1, 'pick')`)).rejects.toThrow(
      DENIED,
    );
    await expect(rows(`select public.submit_scouting($1::jsonb)`, [bundle(crypto.randomUUID(), U.scout)])).rejects.toThrow(DENIED);
  });

  it('public board is OFF by default and token-gated when ON', async () => {
    await asAnon();
    expect((await rows(`select public.get_public_board('anything') as b`))[0].b).toBeNull();
    await asUser(U.admin);
    await db.query(`update public.settings set value = $1 where key = 'public_board'`, [
      JSON.stringify({ enabled: true, token: 'secret-token-123' }),
    ]);
    await db.query(
      `insert into public.picklist_entries (id, picking_team, team_id, tier, position, note, dnp_reason)
       values ('611:449', '611', '449', 'first', 1, 'private note', null),
              ('611:9033', '611', '9033', 'dnp', 2, null, 'tippy')`,
    );
    await asAnon();
    expect((await rows(`select public.get_public_board('wrong') as b`))[0].b).toBeNull();
    const b = (await rows(`select public.get_public_board('secret-token-123') as b`))[0].b as Record<string, unknown[]>;
    expect(b).not.toBeNull();
    expect(b.teams.length).toBe(28);
    const pl = b.picklists as Record<string, unknown>[];
    expect(pl.map((e) => e.team_id)).toEqual(['449']); // DNP rows never leave the server
    expect(JSON.stringify(b)).not.toContain('private note');
    // revoke: disabling makes the same link dead
    await asUser(U.admin);
    await db.query(`update public.settings set value = $1 where key = 'public_board'`, [
      JSON.stringify({ enabled: false, token: 'secret-token-123' }),
    ]);
    await asAnon();
    expect((await rows(`select public.get_public_board('secret-token-123') as b`))[0].b).toBeNull();
  });

  it('keepalive heartbeat works without a login', async () => {
    await asAnon();
    expect((await rows(`select public.keepalive() as t`))[0].t).toBeTruthy();
  });
});

describe('Viewer (read-only)', () => {
  it('can read but cannot write anything', async () => {
    await asUser(U.viewer);
    expect((await rows(`select id from public.teams`)).length).toBe(28);
    await expect(rows(`insert into public.teams (id, number, name) values ('9998', 9998, 'x')`)).rejects.toThrow(DENIED);
    expect(await affected(`update public.teams set name = 'hacked' where id = '611'`)).toBe(0);
    expect(await affected(`delete from public.teams where id = '611'`)).toBe(0);
    await expect(
      rows(`insert into public.matches (key, comp_level, match_number, label) values ('Q99', 'qm', 99, 'Q99')`),
    ).rejects.toThrow(DENIED);
    await expect(rows(`select public.submit_scouting($1::jsonb)`, [bundle(crypto.randomUUID(), U.viewer)])).rejects.toThrow(DENIED);
    await expect(
      rows(`insert into public.pit_reports (id, team_id, author_id, data) values (gen_random_uuid(), '611', $1, '{}')`, [U.viewer]),
    ).rejects.toThrow(DENIED);
    await expect(
      rows(`insert into public.picklist_entries (id, picking_team, team_id, tier) values ('611:321', '611', '321', 'first')`),
    ).rejects.toThrow(DENIED);
    await expect(rows(`insert into public.draft_actions (id, seq, action) values (gen_random_uuid(), 1, 'pick')`)).rejects.toThrow(
      DENIED,
    );
    await expect(
      rows(`insert into public.picklist_votes (id, picking_team, team_id, user_id, value) values ('v', '611', '449', $1, 1)`, [U.viewer]),
    ).rejects.toThrow(DENIED);
    expect(await affected(`update public.settings set value = '"x"' where key = 'tba_url'`)).toBe(0);
    await expect(
      rows(`insert into storage.objects (bucket_id, name, owner_id) values ('robot-photos', 'x.jpg', $1)`, [U.viewer]),
    ).rejects.toThrow(DENIED);
  });

  it('cannot read the audit log or other users e-mails, cannot self-promote', async () => {
    await asUser(U.viewer);
    expect((await rows(`select * from public.audit_log`)).length).toBe(0);
    await expect(rows(`select email from public.profiles`)).rejects.toThrow(DENIED);
    await expect(rows(`select * from public.admin_list_profiles()`)).rejects.toThrow(/admin only/);
    await expect(rows(`update public.profiles set role = 'admin' where id = $1`, [U.viewer])).rejects.toThrow(DENIED);
    // but may rename themselves
    expect(await affected(`update public.profiles set display_name = 'Vee' where id = $1`, [U.viewer])).toBe(1);
  });
});

describe('Scout', () => {
  const mine = crypto.randomUUID();

  it('submits own scouting atomically via RPC (submission + reports + events)', async () => {
    await asUser(U.scout);
    await rows(`select public.submit_scouting($1::jsonb)`, [bundle(mine, U.scout)]);
    expect((await rows(`select * from public.robot_reports where submission_id = $1`, [mine])).length).toBe(1);
    expect((await rows(`select * from public.scout_events where submission_id = $1`, [mine])).length).toBe(1);
    // resubmit (undo removed an event) replaces the event log
    const b = JSON.parse(bundle(mine, U.scout));
    b.events = [];
    await rows(`select public.submit_scouting($1::jsonb)`, [JSON.stringify(b)]);
    expect((await rows(`select * from public.scout_events where submission_id = $1`, [mine])).length).toBe(0);
  });

  it("cannot file as someone else or edit another scout's data", async () => {
    await asUser(U.scout2);
    await expect(rows(`select public.submit_scouting($1::jsonb)`, [bundle(crypto.randomUUID(), U.scout)])).rejects.toThrow(DENIED);
    expect(await affected(`update public.scout_submissions set scout_name = 'x' where id = $1`, [mine])).toBe(0);
    await expect(rows(`select public.submit_scouting($1::jsonb)`, [bundle(mine, U.scout2)])).rejects.toThrow(DENIED);
    expect(await affected(`delete from public.robot_reports where submission_id = $1`, [mine])).toBe(0);
  });

  it('cannot discard (admin only), cannot touch results / picklists', async () => {
    await asUser(U.scout);
    await expect(rows(`update public.scout_submissions set discarded = true where id = $1`, [mine])).rejects.toThrow(DENIED);
    expect(await affected(`update public.matches set red_score = 1`)).toBe(0);
    await expect(
      rows(`insert into public.picklist_entries (id, picking_team, team_id, tier) values ('611:321', '611', '321', 'first')`),
    ).rejects.toThrow(DENIED);
  });

  it('can pit scout, vote, and upload robot photos (not branding)', async () => {
    await asUser(U.scout);
    await rows(`insert into public.pit_reports (id, team_id, author_id, data) values (gen_random_uuid(), '449', $1, '{"oven":"yes"}')`, [
      U.scout,
    ]);
    await rows(
      `insert into public.picklist_votes (id, picking_team, team_id, user_id, value) values ('611:449:${U.scout}', '611', '449', $1, 1)`,
      [U.scout],
    );
    await rows(`insert into storage.objects (bucket_id, name, owner_id) values ('robot-photos', '449/a.jpg', $1)`, [U.scout]);
    await expect(
      rows(`insert into storage.objects (bucket_id, name, owner_id) values ('branding', 'logo.svg', $1)`, [U.scout]),
    ).rejects.toThrow(DENIED);
    await expect(
      rows(`insert into public.picklist_votes (id, picking_team, team_id, user_id, value) values ('fake', '611', '449', $1, 1)`, [
        U.scout2,
      ]),
    ).rejects.toThrow(DENIED);
  });
});

describe('Strategist', () => {
  it('edits picklists + draft board, may import QR scouting for others', async () => {
    await asUser(U.strategist);
    await rows(`insert into public.picklist_entries (id, picking_team, team_id, tier, position) values ('526:3504', '526', '3504', 'first', 1)`);
    await rows(`insert into public.draft_actions (id, seq, action, alliance, team_id) values (gen_random_uuid(), 1, 'pick', 1, '3504')`);
    await rows(`select public.submit_scouting($1::jsonb)`, [bundle(crypto.randomUUID(), U.scout2, '449')]);
    await expect(
      rows(`insert into public.picklist_entries (id, picking_team, team_id, tier) values ('526:9033', '526', '9033', 'dnp')`),
    ).rejects.toThrow(/dnp_needs_reason/);
  });

  it('can lock but not unlock; locked list rejects edits (admin still can)', async () => {
    await asUser(U.strategist);
    expect(await affected(`update public.picklist_meta set locked = true where picking_team = '526'`)).toBe(1);
    expect(await affected(`update public.picklist_entries set position = 5 where id = '526:3504'`)).toBe(0);
    await expect(rows(`update public.picklist_meta set locked = false where picking_team = '526'`)).rejects.toThrow(DENIED);
    await asUser(U.admin);
    expect(await affected(`update public.picklist_entries set position = 5 where id = '526:3504'`)).toBe(1);
    expect(await affected(`update public.picklist_meta set locked = false where picking_team = '526'`)).toBe(1);
  });

  it('cannot change results, teams, settings or roles', async () => {
    await asUser(U.strategist);
    await expect(
      rows(`insert into public.matches (key, comp_level, match_number, label) values ('Q98', 'qm', 98, 'Q98')`),
    ).rejects.toThrow(DENIED);
    expect(await affected(`update public.teams set name = 'x' where id = '449'`)).toBe(0);
    expect(await affected(`update public.settings set value = '"x"' where key = 'tba_url'`)).toBe(0);
    await expect(rows(`update public.profiles set role = 'admin' where id = $1`, [U.strategist])).rejects.toThrow(DENIED);
  });
});

describe('Admin', () => {
  it('writes results/teams/settings, every edit lands in the audit log', async () => {
    await asUser(U.admin);
    await rows(`insert into public.matches (key, comp_level, match_number, label, red, blue, red_score, blue_score, played, source)
                values ('Q1', 'qm', 1, 'Q1', '{611,449,321}', '{526,3504,686}', 50, 40, true, 'manual')`);
    await rows(`insert into public.teams (id, number, name, status) values ('7777', 7777, 'Walk-in', 'expected')`);
    const log = await rows(`select table_name, row_key, action, actor_name from public.audit_log order by id`);
    expect(log.some((l) => l.table_name === 'matches' && l.row_key === 'Q1' && l.actor_name === 'admin')).toBe(true);
    expect(log.some((l) => l.table_name === 'teams' && l.row_key === '7777')).toBe(true);
    // identical re-upsert is NOT logged again
    const before = log.length;
    await rows(`update public.matches set red_score = 50 where key = 'Q1'`);
    expect((await rows(`select id from public.audit_log`)).length).toBe(before);
  });

  it('manages roles, but the last admin cannot be demoted', async () => {
    await asUser(U.admin);
    expect(await affected(`update public.profiles set role = 'scout' where id = $1`, [U.viewer])).toBe(1);
    await expect(rows(`update public.profiles set role = 'viewer' where id = $1`, [U.admin])).rejects.toThrow(/last admin/);
    expect((await rows(`select * from public.admin_list_profiles()`)).length).toBe(5);
  });

  it('can discard a submission', async () => {
    await asUser(U.admin);
    const n = await affected(`update public.scout_submissions set discarded = true, discard_reason = 'outlier' where scout_id = $1`, [
      U.scout,
    ]);
    expect(n).toBeGreaterThan(0);
  });
});

describe('Admin by passcode', () => {
  const claim = async (code: string) => (await rows(`select public.claim_admin($1) as r`, [code]))[0].r;
  const roleOf = async (id: string) => {
    await asSuper();
    return (await rows(`select role from public.profiles where id = $1`, [id]))[0].role;
  };

  it('the passcode itself is unreadable through the API', async () => {
    await asUser(U.viewer);
    await expect(rows(`select * from private.admin_passcode`)).rejects.toThrow(/permission denied/i);
    await asAnon();
    await expect(rows(`select public.claim_admin('SSTI')`)).rejects.toThrow(/permission denied/i);
  });

  it('a wrong passcode changes nothing; the right one (any case) makes a second admin', async () => {
    const fresh = '00000000-0000-4000-8000-0000000000aa';
    await asSuper();
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'fresh@example.com', '{"full_name":"Fresh"}')`, [fresh]);
    expect(await roleOf(fresh)).toBe('viewer');
    await asUser(fresh);
    expect(await claim('nope')).toBeNull();
    expect(await roleOf(fresh)).toBe('viewer');
    await asUser(fresh);
    expect(await claim(' ssti ')).toBe('admin');
    expect(await roleOf(fresh)).toBe('admin');
    // the original admin keeps the role: there are now two
    expect(await roleOf(U.admin)).toBe('admin');
    await asSuper();
    const audit = await rows(`select actor_id from public.audit_log where table_name = 'profiles' and row_key = $1 order by id desc limit 1`, [fresh]);
    expect(audit[0]?.actor_id).toBe(fresh);
  });

  it('locks an account out after 5 wrong guesses in 15 minutes', async () => {
    await asUser(U.scout2);
    for (let i = 0; i < 5; i++) expect(await claim(`bad${i}`)).toBeNull();
    await expect(claim('SSTI')).rejects.toThrow(/too many wrong passcodes/);
    expect(await roleOf(U.scout2)).not.toBe('admin');
  });
});
