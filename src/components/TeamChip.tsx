'use client';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '@/data/db';
import { isOurTeam } from '@/config/event';
import { displayTeam } from '@/lib/teamIds';
import { publicStorageUrl } from '@/sync/supabase';
import { useTeamMap } from '@/data/hooks';
import { cx } from './ui';

const blobUrls = new Map<string, string>();

/** teamId → best photo URL (primary first; offline-queued photos come from IndexedDB). */
export function usePhotoMap(): Map<string, string> {
  const photos = useLiveQuery(() => db.photos.toArray(), [], []);
  const blobs = useLiveQuery(() => db.photo_blobs.toArray(), [], []);
  return useMemo(() => {
    const byId = new Map(blobs.map((b) => [b.id, b]));
    const m = new Map<string, string>();
    const sorted = [...photos].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.created_at.localeCompare(a.created_at));
    for (const p of sorted) {
      if (m.has(p.team_id)) continue;
      const blob = byId.get(p.id);
      if (blob) {
        let u = blobUrls.get(p.id);
        if (!u) {
          u = URL.createObjectURL(blob.blob);
          blobUrls.set(p.id, u);
        }
        m.set(p.team_id, u);
      } else if (p.storage_path) {
        const u = publicStorageUrl('robot-photos', p.storage_path);
        if (u) m.set(p.team_id, u);
      }
    }
    return m;
  }, [photos, blobs]);
}

export function TeamAvatar({ team, url, size = 32 }: { team: string; url?: string | null; size?: number }) {
  return url ? (
     
    <img src={url} alt={`Team ${team}`} width={size} height={size} loading="lazy" className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-lg text-[10px] font-bold', isOurTeam(team) ? 'bg-saxon text-saxon-ink' : 'bg-surface-2 text-muted')}
      style={{ width: size, height: size }}
    >
      {displayTeam(team)}
    </span>
  );
}

export function TeamChip({
  team,
  photo,
  showName,
  link = true,
  className,
  alliance,
  size = 28,
}: {
  team: string;
  photo?: string | null;
  showName?: boolean;
  link?: boolean;
  className?: string;
  alliance?: 'red' | 'blue';
  size?: number;
}) {
  const teams = useTeamMap();
  const ours = isOurTeam(team);
  const inner = (
    <span
      className={cx(
        'inline-flex min-w-0 items-center gap-1.5 rounded-lg py-0.5 pr-1.5',
        ours && 'ring-1 ring-saxon',
        alliance === 'red' && 'text-redA',
        alliance === 'blue' && 'text-blueA',
        className,
      )}
    >
      <TeamAvatar team={team} url={photo} size={size} />
      <span className={cx('font-bold tnum', ours && 'text-saxon')}>{displayTeam(team)}</span>
      {showName && <span className="truncate text-xs text-muted">{teams.get(team)?.name}</span>}
    </span>
  );
  if (!team) return <span className="text-muted">—</span>;
  return link ? (
    <Link href={`/team/?id=${encodeURIComponent(team)}`} onClick={(e) => e.stopPropagation()}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
