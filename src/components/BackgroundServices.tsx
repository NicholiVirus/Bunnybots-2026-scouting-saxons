'use client';
/** App-wide background jobs (mounted once in Providers). */
import { useEffect } from 'react';
import { db } from '@/data/db';
import { useSettings } from '@/data/hooks';
import { publicStorageUrl } from '@/sync/supabase';
import { nowIso } from '@/lib/util';
import { OfficialDataPoller } from './OfficialDataPoller';
import { PicklistAutoLock } from './PicklistAutoLock';

export function BackgroundServices() {
  const settings = useSettings();

  // Mirror the admin splash toggle so the next cold launch can read it synchronously.
  useEffect(() => {
    try {
      localStorage.setItem('hh:splash', JSON.stringify({ enabled: settings.splashEnabled }));
    } catch {
      /* ignore */
    }
  }, [settings.splashEnabled]);

  // Cache an admin-uploaded logo in IndexedDB so the splash works offline.
  const brandingKey = settings.branding ? `${settings.branding.path}@${settings.branding.updated_at}` : '';
  useEffect(() => {
    void (async () => {
      const b = settings.branding;
      if (!b) {
        const existing = await db.assets.get('logo');
        if (existing?.source && existing.updated_at !== 'local') await db.assets.delete('logo');
        return;
      }
      const cached = await db.assets.get('logo');
      if (cached && cached.updated_at === b.updated_at) return;
      const url = publicStorageUrl('branding', b.path);
      if (!url || !navigator.onLine) return;
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) return;
        const blob = await res.blob();
        await db.assets.put({ key: 'logo', blob, mime: blob.type, updated_at: b.updated_at || nowIso(), source: b.type });
      } catch {
        /* offline: keep whatever is cached */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandingKey]);

  return (
    <>
      <OfficialDataPoller />
      <PicklistAutoLock />
    </>
  );
}
