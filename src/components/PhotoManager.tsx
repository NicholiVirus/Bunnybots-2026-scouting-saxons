'use client';
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Star, Trash2 } from 'lucide-react';
import { db } from '@/data/db';
import { addTeamPhoto, removePhoto, setPrimaryPhoto } from '@/catalog/photos';
import { publicStorageUrl } from '@/sync/supabase';
import { useAuth, can } from '@/sync/auth';
import { useSyncStatus } from '@/sync/status';
import { Badge, Spinner } from './ui';

const urls = new Map<string, string>();

export function PhotoManager({ team }: { team: string }) {
  const auth = useAuth();
  const sync = useSyncStatus();
  const photos = useLiveQuery(() => db.photos.where('team_id').equals(team).toArray(), [team], []);
  const blobs = useLiveQuery(() => db.photo_blobs.where('team_id').equals(team).toArray(), [team], []);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blobBy = new Map(blobs.map((b) => [b.id, b]));
  const urlFor = (id: string, path: string | null) => {
    const b = blobBy.get(id);
    if (b) {
      if (!urls.has(id)) urls.set(id, URL.createObjectURL(b.blob));
      return urls.get(id)!;
    }
    return path ? publicStorageUrl('robot-photos', path) : null;
  };
  const sorted = [...photos].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.created_at.localeCompare(a.created_at));

  return (
    <div>
      <div className="scroll-x flex gap-2 pb-1">
        {sorted.map((p) => {
          const u = urlFor(p.id, p.storage_path);
          return (
            <figure key={p.id} className="relative shrink-0">
              {u ? (
                 
                <img src={u} alt={`Team ${team}`} className="h-40 w-40 rounded-xl object-cover sm:h-48 sm:w-48" />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-surface-2 text-xs text-muted">photo</div>
              )}
              <figcaption className="absolute inset-x-1 bottom-1 flex items-center justify-between">
                {p.is_primary ? <Badge tone="saxon">primary</Badge> : <span />}
                {!p.storage_path && <Badge tone="warn">{sync.active ? 'uploading…' : 'on this device'}</Badge>}
              </figcaption>
              {can.pitScout(auth.role) && (
                <div className="absolute right-1 top-1 flex gap-1">
                  {!p.is_primary && (
                    <button className="rounded-lg bg-black/60 p-1.5 text-white" onClick={() => void setPrimaryPhoto(p)} aria-label="Make primary">
                      <Star size={14} />
                    </button>
                  )}
                  <button
                    className="rounded-lg bg-black/60 p-1.5 text-white"
                    onClick={() => confirm('Delete this photo?') && void removePhoto(p)}
                    aria-label="Delete photo"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </figure>
          );
        })}
        {can.pitScout(auth.role) && (
          <button
            className="flex h-40 w-40 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-muted hover:border-saxon sm:h-48 sm:w-48"
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Camera />}
            <span className="text-sm">{busy ? 'Compressing…' : 'Add photo'}</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          setErr(null);
          try {
            await addTeamPhoto(team, f);
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {err && <p className="mt-1 text-sm text-bad">{err}</p>}
      {sorted.length === 0 && !can.pitScout(auth.role) && <p className="text-sm text-muted">No photos yet.</p>}
    </div>
  );
}
