#!/usr/bin/env node
/**
 * Event-day load test: 25 simulated devices against YOUR Supabase project.
 * Each device pulls every table, submits scouting bundles through the
 * submit_scouting RPC, and listens on Realtime; one device writes draft-board
 * picks so we can measure "picked shows on a second device" latency.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   LOADTEST_EMAIL=admin@team.org LOADTEST_PASSWORD=... npm run loadtest
 *
 * Use an ADMIN account: it cleans up every row it creates at the end.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL_ = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.LOADTEST_EMAIL;
const PASSWORD = process.env.LOADTEST_PASSWORD;
const USERS = Number(process.env.LOADTEST_USERS || 25);
const SUBMISSIONS = Number(process.env.LOADTEST_SUBMISSIONS || 6);
if (!URL_ || !KEY || !EMAIL || !PASSWORD) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY, LOADTEST_EMAIL, LOADTEST_PASSWORD (an admin account).');
  process.exit(1);
}

const TABLES = ['settings', 'teams', 'team_aliases', 'matches', 'rankings', 'official_alliances', 'scout_submissions', 'pit_reports', 'photos', 'picklist_meta', 'picklist_entries', 'draft_actions', 'strategy_notes', 'pit_checks', 'scout_assignments'];
const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : NaN);
const lat = { pull: [], submit: [], realtime: [] };
let errors = 0;

const auth = createClient(URL_, KEY, { auth: { persistSession: false } });
const { data: session, error: authErr } = await auth.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) {
  console.error('Sign-in failed:', authErr.message);
  process.exit(1);
}
const token = session.session.access_token;
const uid = session.user.id;
const client = () => createClient(URL_, KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
const created = [];

async function device(i) {
  const sb = client();
  for (const t of TABLES) {
    const t0 = Date.now();
    const { error } = await sb.from(t).select('*').limit(1000);
    lat.pull.push(Date.now() - t0);
    if (error) errors++;
  }
  for (let k = 0; k < SUBMISSIONS; k++) {
    const id = randomUUID();
    created.push(id);
    const events = Array.from({ length: 40 }, (_, e) => ({ id: randomUUID(), team_id: '611', t_ms: 16000 + e * 2500, phase: 'teleop', action: 'score', piece: e % 3 ? 'carrot' : 'cake', target: ['L1', 'L2', 'L3', 'oven'][e % 4], detail: null }));
    const p = {
      submission: { id, match_key: `LOADTEST-${i}-${k}`, alliance: 'red', teams: ['611'], stations: ['red1'], robot_count: 1, scout_id: uid, scout_name: `loadtest-${i}`, device_id: `lt-${i}`, status: 'submitted', started_at: Date.now(), submitted_at: new Date().toISOString(), source: 'app', discarded: false, discard_reason: null, app_version: 'loadtest', created_at: new Date().toISOString() },
      reports: [{ id: `${id}:611`, team_id: '611', station: 'red1', note: 'load test', flags: [], mechanisms: {} }],
      events,
    };
    const t0 = Date.now();
    const { error } = await sb.rpc('submit_scouting', { p });
    lat.submit.push(Date.now() - t0);
    if (error) {
      errors++;
      console.error('submit error:', error.message);
    }
  }
}

// realtime: device B listens, device A writes a draft pick
const listener = client();
const pending = new Map();
await new Promise((resolve) => {
  listener
    .channel('lt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'draft_actions' }, (msg) => {
      const t0 = pending.get(msg.new.id);
      if (t0) lat.realtime.push(Date.now() - t0);
    })
    .subscribe((s) => s === 'SUBSCRIBED' && resolve());
});
const writer = client();
const draftIds = [];
const realtimeProbe = (async () => {
  for (let k = 0; k < 5; k++) {
    const id = randomUUID();
    draftIds.push(id);
    pending.set(id, Date.now());
    await writer.from('draft_actions').insert({ id, seq: Date.now(), action: 'decline', alliance: 8, team_id: 'loadtest', created_by: uid, created_by_name: 'loadtest' });
    await new Promise((r) => setTimeout(r, 800));
  }
})();

const t0 = Date.now();
await Promise.all([...Array.from({ length: USERS }, (_, i) => device(i)), realtimeProbe]);
await new Promise((r) => setTimeout(r, 2500));
const total = Date.now() - t0;

// clean up
const admin = client();
for (let i = 0; i < created.length; i += 100) await admin.from('scout_submissions').delete().in('id', created.slice(i, i + 100));
await admin.from('draft_actions').delete().in('id', draftIds);
await listener.removeAllChannels();

console.log(`\n${USERS} devices · ${created.length} submissions · ${total} ms total · ${errors} errors`);
console.log(`pull   p50 ${pct(lat.pull, 0.5)} ms  p95 ${pct(lat.pull, 0.95)} ms`);
console.log(`submit p50 ${pct(lat.submit, 0.5)} ms  p95 ${pct(lat.submit, 0.95)} ms`);
console.log(`realtime "picked on 2nd device": ${lat.realtime.map((x) => `${x} ms`).join(', ') || 'no events received (enable Realtime for public tables)'}`);
const ok = errors === 0 && lat.realtime.length > 0 && pct(lat.realtime, 0.95) < 2000;
console.log(ok ? '\nPASS ✅' : '\nCHECK ⚠️  (see numbers above)');
process.exit(ok ? 0 : 1);
