'use client';
import { db } from '@/data/db';
import { saveScoutingBundle, type ScoutingBundle } from '@/data/repo';
import { authStore, can } from '@/sync/auth';

export type ImportResult = 'new' | 'updated' | 'same';

/**
 * Save a bundle that arrived by QR / JSON. Idempotent by submission id.
 * Strategists+ forward other scouts' data to the server (RLS allows it);
 * scouts keep others' data locally (their own goes up as usual).
 */
export async function importBundle(b: ScoutingBundle): Promise<ImportResult> {
  const existing = await db.scout_submissions.get(b.submission.id);
  if (existing && existing.status === 'submitted') {
    const evCount = await db.scout_events.where('submission_id').equals(b.submission.id).count();
    if (evCount === b.events.length && String(existing.submitted_at) >= String(b.submission.submitted_at)) return 'same';
  }
  const me = authStore.get();
  const mine = !!me.userId && b.submission.scout_id === me.userId;
  await saveScoutingBundle(b, { sync: mine || can.importOthersQr(me.role) });
  return existing ? 'updated' : 'new';
}
