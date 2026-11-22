'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Upload } from 'lucide-react';
import brand from '@/generated/brand.json';
import { db } from '@/data/db';
import { useSettings } from '@/data/hooks';
import { getSupabase, isSupabaseConfigured } from '@/sync/supabase';
import { nowIso } from '@/lib/util';
import { Button, Card } from '@/components/ui';
import { saveSetting } from './SettingsAdmin';

const TYPES: Record<string, string> = { svg: 'svg', png: 'png', gif: 'gif', mp4: 'video', webm: 'video', json: 'lottie' };

/** Settings → Branding: upload a logo (overrides public/brand/), cached for offline. */
export function BrandingAdmin() {
  const s = useSettings();
  const cached = useLiveQuery(() => db.assets.get('logo'), []);
  const [msg, setMsg] = useState<string | null>(null);
  const upload = async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    const type = TYPES[ext];
    if (!type) return setMsg('Use SVG, PNG, GIF, MP4, WebM or Lottie JSON.');
    if (f.size > 8 * 1024 * 1024) return setMsg('Max 8 MB.');
    const updated_at = nowIso();
    if (isSupabaseConfigured()) {
      const sb = getSupabase()!;
      const path = `logo-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from('branding').upload(path, f, { contentType: f.type || undefined, upsert: true });
      if (error) return setMsg(error.message);
      await saveSetting('branding', { path, type, updated_at });
    }
    // cache immediately on this device (others download it on their next sync)
    await db.assets.put({ key: 'logo', blob: f, mime: f.type, updated_at: isSupabaseConfigured() ? updated_at : 'local', source: type });
    setMsg('Logo saved. It plays on the next app launch (tap to skip).');
  };
  return (
    <Card title="Branding — launch logo">
      <p className="mb-3 text-sm text-muted">
        Default: <code>{brand.file ?? 'none'}</code> (drop a file in <code>public/brand/</code> to change it for every build — see README). An uploaded logo
        overrides it and is cached for offline use. Accepted: SVG, PNG, animated GIF, MP4/WebM, Lottie JSON.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="tap inline-flex cursor-pointer items-center gap-2 rounded-xl bg-saxon px-4 font-semibold text-saxon-ink">
          <Upload size={16} /> Upload logo
          <input type="file" accept=".svg,.png,.gif,.mp4,.webm,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        </label>
        {(s.branding || cached) && (
          <Button
            onClick={async () => {
              if (s.branding) await saveSetting('branding', null);
              await db.assets.delete('logo');
              setMsg('Back to the default logo.');
            }}
          >
            Use default logo
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Current: {cached ? `uploaded ${cached.source} (${Math.round(cached.blob.size / 1024)} KB)` : 'default'}
      </p>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  );
}
