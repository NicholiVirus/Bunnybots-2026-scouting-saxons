/**
 * The ONLY write path. Every write lands in IndexedDB first (instant, offline)
 * and — when a Supabase project is configured and someone is signed in — is
 * queued in the outbox for the sync engine to push. Same row ids everywhere,
 * so re-sends and QR re-imports are idempotent (no duplicates).
 */
import type { Table } from 'dexie';
import { db } from './db';
import type { OutboxItem, RobotReport, ScoutEvent, ScoutSubmission, SyncedTable } from './types';
import { nowIso } from '@/lib/util';
import { rowKey, TABLE_KEY } from '@/sync/tables';
import { syncStatus } from '@/sync/status';

type AnyRow = Record<string, unknown>;

let pushKick: (() => void) | null = null;
/** The sync engine registers itself here so writes trigger an immediate push. */
export function registerPushKick(fn: (() => void) | null) {
  pushKick = fn;
}

/** True when writes should be queued for the server. */
export function serverSyncActive(): boolean {
  return syncStatus.get().active;
}

function table(name: SyncedTable): Table<AnyRow, string | number> {
  return (db as unknown as Record<string, Table<AnyRow, string | number>>)[name];
}

async function enqueue(item: Omit<OutboxItem, 'id' | 'created_at' | 'attempts' | 'last_error' | 'status'>) {
  await db.transaction('rw', db.outbox, async () => {
    // Coalesce: only the newest pending version of a row needs to be sent.
    await db.outbox.where('[table+key]').equals([item.table, item.key]).filter((o) => o.status === 'pending' && o.kind === item.kind).delete();
    await db.outbox.add({ ...item, created_at: nowIso(), attempts: 0, last_error: null, status: 'pending' });
  });
  syncStatus.set((s) => ({ pending: s.pending + 1 }));
  pushKick?.();
}

export interface WriteOpts {
  /** false = local only (demo data, server-sourced rows). Otherwise queued whenever server sync is active. */
  sync?: boolean;
}

/** Insert/update rows locally and queue them for the server. */
export async function putRows<T extends object>(name: SyncedTable, rows: T[], opts: WriteOpts = {}) {
  if (!rows.length) return;
  const stamped = rows.map((r) => ({ ...(r as AnyRow), updated_at: nowIso() }));
  await table(name).bulkPut(stamped);
  if (opts.sync !== false && serverSyncActive()) {
    for (const r of stamped) {
      const payload: AnyRow = { ...r };
      delete payload.updated_at; // server clock owns updated_at
      await enqueue({ kind: 'upsert', table: name, key: rowKey(name, r), payload });
    }
  }
}

export const putRow = <T extends object>(name: SyncedTable, row: T, opts?: WriteOpts) => putRows(name, [row], opts);

/** Soft delete: removed locally, tombstoned on the server so other devices drop it too. */
export async function deleteRows(name: SyncedTable, items: object[], opts: WriteOpts = {}) {
  if (!items.length) return;
  const keyField = TABLE_KEY[name];
  const t = table(name);
  for (const r of items as AnyRow[]) {
    await t.delete(r[keyField] as string | number);
    if (opts.sync !== false && serverSyncActive()) {
      const payload: AnyRow = { ...r, deleted_at: nowIso() };
      delete payload.updated_at;
      await enqueue({ kind: 'upsert', table: name, key: rowKey(name, r), payload });
    }
  }
}

export interface ScoutingBundle {
  submission: ScoutSubmission;
  reports: RobotReport[];
  events: ScoutEvent[];
}

/** Save a whole scouting submission (autosaved on every tap). */
export async function saveScoutingBundle(b: ScoutingBundle, opts: WriteOpts & { push?: boolean } = {}) {
  const ts = nowIso();
  const submission = { ...b.submission, updated_at: ts };
  const reports = b.reports.map((r) => ({ ...r, updated_at: ts }));
  await db.transaction('rw', [db.scout_submissions, db.robot_reports, db.scout_events], async () => {
    await db.scout_submissions.put(submission);
    await db.robot_reports.where('submission_id').equals(submission.id).delete();
    await db.scout_events.where('submission_id').equals(submission.id).delete();
    if (reports.length) await db.robot_reports.bulkPut(reports);
    if (b.events.length) await db.scout_events.bulkPut(b.events);
  });
  // Live taps are kept local (autosave); the bundle is queued on status changes
  // (draft → live → submitted) and on post-submit edits.
  if ((opts.push ?? true) && opts.sync !== false && serverSyncActive()) {
    const strip = <T extends AnyRow>(r: T) => {
      const c: AnyRow = { ...r };
      delete c.updated_at;
      return c;
    };
    await enqueue({
      kind: 'scouting',
      table: 'scouting_bundle',
      key: submission.id,
      payload: { submission: strip(submission as unknown as AnyRow), reports: reports.map((r) => strip(r as unknown as AnyRow)), events: b.events },
    });
  }
}

export async function loadScoutingBundle(id: string): Promise<ScoutingBundle | null> {
  const submission = await db.scout_submissions.get(id);
  if (!submission) return null;
  const [reports, events] = await Promise.all([
    db.robot_reports.where('submission_id').equals(id).toArray(),
    db.scout_events.where('submission_id').equals(id).toArray(),
  ]);
  return { submission, reports, events };
}

/** Queue a photo upload (blob stays in IndexedDB until it reaches Storage). */
export async function queuePhotoUpload(photoId: string, teamId: string) {
  if (!serverSyncActive()) return;
  await enqueue({ kind: 'photo', table: 'storage', key: photoId, payload: { photoId, teamId } });
}
