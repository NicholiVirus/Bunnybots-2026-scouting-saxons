'use client';
/**
 * Auto-locks 611's and 526's pick lists at the configured time on event day
 * (default 2:55 PM). Runs on strategist/admin devices; fires once per device,
 * only in the 10 minutes after the lock time (so an admin unlock sticks).
 * The database enforces the lock for everyone.
 */
import { useEffect } from 'react';
import { db, kvGet, kvSet } from '@/data/db';
import { useSettings } from '@/data/hooks';
import { putRow } from '@/data/repo';
import { EVENT, OUR_TEAMS } from '@/config/event';
import { nowIso, todayAt } from '@/lib/util';
import { can, useAuth, whoAmI } from '@/sync/auth';

export function PicklistAutoLock() {
  const settings = useSettings();
  const auth = useAuth();
  useEffect(() => {
    const at = settings.picklistAutoLock;
    if (!at || !can.editPicklist(auth.role)) return;
    const tick = async () => {
      const now = new Date();
      const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (localDate !== EVENT.date) return;
      const lockAt = todayAt(at, now);
      if (now < lockAt || now.getTime() - lockAt.getTime() > 10 * 60_000) return;
      for (const team of OUR_TEAMS) {
        const k = `autolock:${team}:${localDate}`;
        if (await kvGet(k)) continue;
        const meta = await db.picklist_meta.get(team);
        if (!meta?.locked) {
          const me = whoAmI();
          await putRow('picklist_meta', {
            picking_team: team,
            weights_first: meta?.weights_first ?? null,
            weights_second: meta?.weights_second ?? null,
            captain_guesses: meta?.captain_guesses ?? null,
            locked: true,
            locked_by: me.id,
            locked_at: nowIso(),
          });
        }
        await kvSet(k, true);
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 20_000);
    return () => clearInterval(t);
  }, [settings.picklistAutoLock, auth.role]);
  return null;
}
