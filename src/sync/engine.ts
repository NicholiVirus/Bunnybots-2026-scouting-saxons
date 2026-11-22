'use client';
/**
 * Sync engine: IndexedDB ⇄ Supabase.
 *  - PUSH: outbox FIFO (coalesced per row). Network errors pause and retry with
 *    backoff; permission/validation errors park the item as "failed" (shown in
 *    the sync panel) so one bad row never blocks the queue.
 *  - PULL: per table, rows with updated_at >= cursor (server clock). Scouting
 *    submissions pull their reports + event log as one unit.
 *  - REALTIME: postgres_changes on every synced table → applied instantly
 *    ("picked" shows on a second device in < 2 s).
 * Local rows with unsent changes are never overwritten by older server copies.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Table } from 'dexie';
import { db, kvGet, kvSet } from '@/data/db';
import { registerPushKick } from '@/data/repo';
import type { OutboxItem, SyncedTable } from '@/data/types';
import { classifyError, getSupabase, publicStorageUrl, type SbError } from './supabase';
import { syncStatus } from './status';
import { SYNC_TABLES, TABLE_KEY, type TableSpec } from './tables';

type AnyRow = Record<string, unknown>;
const tableOf = (name: string) => (db as unknown as Record<string, Table<AnyRow, string | number>>)[name];

const EPOCH = '1970-01-01T00:00:00.000Z';
const PAGE = 1000;

class SyncEngine {
  private sb: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private pushing = false;
  private pushAgain = false;
  private backoffMs = 2000;
  private nextPushAt = 0;
  private running = false;

  start() {
    if (this.running) return;
    this.sb = getSupabase();
    if (!this.sb) return;
    this.running = true;
    syncStatus.set({ active: true, configured: true, online: navigator.onLine });
    registerPushKick(() => void this.push());
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.timers.push(setInterval(() => void this.push(), 5000));
    this.timers.push(setInterval(() => void this.pullAll(), 60_000));
    this.timers.push(setInterval(() => void this.pullAll(true), 10 * 60_000));
    void this.refreshCounts();
    void this.pullAll().then(() => this.push());
    this.subscribeRealtime();
  }

  stop() {
    this.running = false;
    registerPushKick(null);
    this.timers.forEach(clearInterval);
    this.timers = [];
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.channel && this.sb) void this.sb.removeChannel(this.channel);
    this.channel = null;
    syncStatus.set({ active: false, realtime: 'off' });
  }

  private onOnline = () => {
    syncStatus.set({ online: true });
    this.backoffMs = 2000;
    this.nextPushAt = 0;
    void this.pullAll().then(() => this.push());
  };
  private onOffline = () => syncStatus.set({ online: false });
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.pullAll().then(() => this.push());
  };

  async refreshCounts() {
    const [pending, failed] = await Promise.all([
      db.outbox.where('status').equals('pending').count(),
      db.outbox.where('status').equals('failed').count(),
    ]);
    syncStatus.set({ pending, failed });
  }

  // ── PUSH ──────────────────────────────────────────────────────────────────
  async push() {
    if (!this.sb || !this.running) return;
    if (this.pushing) {
      this.pushAgain = true;
      return;
    }
    if (Date.now() < this.nextPushAt || !navigator.onLine) return;
    this.pushing = true;
    syncStatus.set({ pushing: true });
    try {
      for (;;) {
        const item = await db.outbox.where('status').equals('pending').first();
        if (!item) break;
        const result = await this.sendOne(item);
        if (result === 'ok') {
          await db.outbox.delete(item.id!);
          this.backoffMs = 2000;
          syncStatus.set({ lastPushAt: Date.now(), lastError: null });
        } else if (result === 'retry') {
          await db.outbox.update(item.id!, { attempts: item.attempts + 1 });
          this.nextPushAt = Date.now() + this.backoffMs;
          this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
          break;
        }
      }
    } finally {
      this.pushing = false;
      syncStatus.set({ pushing: false });
      await this.refreshCounts();
      if (this.pushAgain) {
        this.pushAgain = false;
        void this.push();
      }
    }
  }

  private async sendOne(item: OutboxItem): Promise<'ok' | 'retry' | 'failed'> {
    const sb = this.sb!;
    let error: SbError | null = null;
    let status: number | undefined;
    try {
      if (item.kind === 'scouting') {
        const r = await sb.rpc('submit_scouting', { p: item.payload });
        error = r.error;
        status = r.status;
      } else if (item.kind === 'photo') {
        return await this.sendPhoto(item);
      } else if (item.table === 'profiles') {
        const p = item.payload as AnyRow;
        const r = await sb.from('profiles').update({ display_name: p.display_name }).eq('id', p.id as string);
        error = r.error;
        status = r.status;
      } else {
        const r = await sb.from(item.table).upsert(item.payload as AnyRow, { onConflict: TABLE_KEY[item.table as SyncedTable] });
        error = r.error;
        status = r.status;
      }
    } catch (e) {
      error = { message: String((e as Error)?.message ?? e) };
      status = 0;
    }
    if (!error) return 'ok';
    const kind = classifyError(error, status);
    syncStatus.set({ lastError: `${item.table}: ${error.message}` });
    if (kind === 'network' || kind === 'server') return 'retry';
    if (kind === 'auth') {
      await sb.auth.refreshSession().catch(() => undefined);
      return item.attempts >= 3 ? this.park(item, error.message) : 'retry';
    }
    return this.park(item, error.message);
  }

  private async park(item: OutboxItem, message: string): Promise<'failed'> {
    await db.outbox.update(item.id!, { status: 'failed', last_error: message, attempts: item.attempts + 1 });
    return 'failed';
  }

  private async sendPhoto(item: OutboxItem): Promise<'ok' | 'retry' | 'failed'> {
    const sb = this.sb!;
    const { photoId, teamId } = item.payload as { photoId: string; teamId: string };
    const blob = await db.photo_blobs.get(photoId);
    const row = await db.photos.get(photoId);
    if (!blob || !row) return 'ok'; // deleted meanwhile
    const ext = blob.mime === 'image/png' ? 'png' : blob.mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${teamId}/${photoId}.${ext}`;
    const up = await sb.storage.from('robot-photos').upload(path, blob.blob, { contentType: blob.mime, upsert: true });
    if (up.error) {
      const kind = classifyError({ message: up.error.message, status: (up.error as { statusCode?: number }).statusCode });
      if (kind === 'network' || kind === 'server') return 'retry';
      return this.park(item, up.error.message);
    }
    const updated = { ...row, storage_path: path };
    await db.photos.put(updated);
    await db.photo_blobs.update(photoId, { uploaded: true });
    const payload: AnyRow = { ...updated };
    delete payload.updated_at;
    const r = await sb.from('photos').upsert(payload, { onConflict: 'id' });
    if (r.error) {
      const kind = classifyError(r.error, r.status);
      if (kind === 'network' || kind === 'server') return 'retry';
      return this.park(item, r.error.message);
    }
    // warm the offline cache for this photo
    const url = publicStorageUrl('robot-photos', path);
    if (url && 'caches' in window) void caches.open('hh-photos').then((c) => c.put(url, new Response(blob.blob)));
    return 'ok';
  }

  /** Retry everything that failed (after a role change, for example). */
  async retryFailed() {
    await db.outbox.where('status').equals('failed').modify({ status: 'pending', attempts: 0 });
    this.nextPushAt = 0;
    await this.refreshCounts();
    void this.push();
  }

  // ── PULL ──────────────────────────────────────────────────────────────────
  private pullingNow = false;

  async pullAll(full = false) {
    if (!this.sb || !this.running || this.pullingNow || !navigator.onLine) return;
    this.pullingNow = true;
    syncStatus.set({ pulling: true });
    let ok = true;
    try {
      for (const spec of SYNC_TABLES) {
        const done = await this.pullTable(spec, full);
        ok = ok && done;
      }
      if (ok) syncStatus.set({ lastPullAt: Date.now(), lastError: null });
    } finally {
      this.pullingNow = false;
      syncStatus.set({ pulling: false });
    }
  }

  private async pendingKeys(table: string): Promise<Set<string>> {
    const items = await db.outbox
      .where('status')
      .equals('pending')
      .filter((o) => o.table === table || (table === 'scout_submissions' && o.table === 'scouting_bundle'))
      .toArray();
    return new Set(items.map((i) => i.key));
  }

  private async pullTable(spec: TableSpec, full: boolean): Promise<boolean> {
    const sb = this.sb!;
    const cursorKey = `cursor:${spec.name}`;
    let from = full ? EPOCH : ((await kvGet<string>(cursorKey)) ?? EPOCH);
    for (;;) {
      const { data, error, status } = await sb
        .from(spec.name)
        .select(spec.select ?? '*')
        .gte('updated_at', from)
        .order('updated_at', { ascending: true })
        .limit(PAGE);
      if (error) {
        if (classifyError(error, status) !== 'network') syncStatus.set({ lastError: `${spec.name}: ${error.message}` });
        return false;
      }
      const rows = (data ?? []) as unknown as AnyRow[];
      if (rows.length) {
        await this.applyRows(spec.name, rows);
        const last = String(rows[rows.length - 1].updated_at);
        await kvSet(cursorKey, last);
        if (rows.length < PAGE || last === from) break;
        from = last;
      } else break;
    }
    return true;
  }

  /** Apply server rows locally (skipping rows with unsent local edits). */
  async applyRows(name: SyncedTable, rows: AnyRow[]) {
    const keyField = TABLE_KEY[name];
    const pending = await this.pendingKeys(name);
    const t = tableOf(name);
    const upserts: AnyRow[] = [];
    const deletes: (string | number)[] = [];
    for (const r of rows) {
      const k = String(r[keyField]);
      if (pending.has(k)) continue;
      if (r.deleted_at) deletes.push(r[keyField] as string | number);
      else upserts.push(r);
    }
    if (name === 'scout_submissions') {
      await this.applySubmissions(upserts, deletes as string[]);
      return;
    }
    await db.transaction('rw', t, async () => {
      if (deletes.length) await t.bulkDelete(deletes);
      if (upserts.length) await t.bulkPut(upserts);
    });
  }

  private async applySubmissions(upserts: AnyRow[], deletes: string[]) {
    const sb = this.sb!;
    const ids = upserts.map((r) => String(r.id));
    const reports: AnyRow[] = [];
    const events: AnyRow[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const [rr, ev] = await Promise.all([
        sb.from('robot_reports').select('*').in('submission_id', chunk),
        sb.from('scout_events').select('*').in('submission_id', chunk),
      ]);
      if (rr.error || ev.error) return; // try again next pull (cursor not advanced past these)
      reports.push(...((rr.data ?? []) as AnyRow[]));
      events.push(...((ev.data ?? []) as AnyRow[]));
    }
    await db.transaction('rw', [db.scout_submissions, db.robot_reports, db.scout_events], async () => {
      const all = [...ids, ...deletes];
      if (all.length) {
        await db.robot_reports.where('submission_id').anyOf(all).delete();
        await db.scout_events.where('submission_id').anyOf(all).delete();
      }
      if (deletes.length) await db.scout_submissions.bulkDelete(deletes);
      if (upserts.length) await db.scout_submissions.bulkPut(upserts as never[]);
      if (reports.length) await db.robot_reports.bulkPut(reports as never[]);
      if (events.length) await db.scout_events.bulkPut(events as never[]);
    });
  }

  // ── REALTIME ──────────────────────────────────────────────────────────────
  private subscribeRealtime() {
    const sb = this.sb!;
    let ch = sb.channel('hh-db');
    for (const spec of SYNC_TABLES.filter((t) => t.realtime)) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: spec.name }, (payload) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as AnyRow;
        if (!row) return;
        if (payload.eventType === 'DELETE') void this.applyRows(spec.name, [{ ...row, deleted_at: new Date().toISOString() }]);
        else void this.applyRows(spec.name, [row]);
      });
    }
    syncStatus.set({ realtime: 'connecting' });
    this.channel = ch.subscribe((state) => {
      if (state === 'SUBSCRIBED') syncStatus.set({ realtime: 'live' });
      else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') syncStatus.set({ realtime: 'error' });
      else if (state === 'CLOSED') syncStatus.set({ realtime: 'off' });
    });
  }
}

export const syncEngine = new SyncEngine();
