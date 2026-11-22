'use client';
import { db } from '@/data/db';
import { deleteRows, putRow, queuePhotoUpload } from '@/data/repo';
import type { PhotoRow } from '@/data/types';
import { compressImage } from '@/lib/image';
import { nowIso, uuid } from '@/lib/util';
import { whoAmI } from '@/sync/auth';

/** Compress, keep the blob locally (works offline), queue the Storage upload. */
export async function addTeamPhoto(teamId: string, file: File, makePrimary = false): Promise<PhotoRow> {
  const blob = await compressImage(file);
  const id = uuid();
  const me = whoAmI();
  const existing = await db.photos.where('team_id').equals(teamId).count();
  await db.photo_blobs.put({ id, team_id: teamId, blob, mime: blob.type || 'image/jpeg', uploaded: false, created_at: nowIso() });
  const row: PhotoRow = {
    id,
    team_id: teamId,
    storage_path: null,
    uploaded_by: me.id,
    uploaded_by_name: me.name,
    is_primary: makePrimary || existing === 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  // the row itself is written to the server only after the upload succeeds (sync engine)
  await putRow('photos', row, { sync: false });
  await queuePhotoUpload(id, teamId);
  return row;
}

export async function setPrimaryPhoto(photo: PhotoRow) {
  const all = await db.photos.where('team_id').equals(photo.team_id).toArray();
  for (const p of all) {
    if (p.is_primary !== (p.id === photo.id)) await putRow('photos', { ...p, is_primary: p.id === photo.id }, { sync: !!p.storage_path });
  }
}

export async function removePhoto(photo: PhotoRow) {
  await db.photo_blobs.delete(photo.id);
  await deleteRows('photos', [photo], { sync: !!photo.storage_path });
}
