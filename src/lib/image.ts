'use client';
/**
 * Client-side photo compression: ≤ 500 KB JPEG (28 teams × ~3 photos ≈ 40 MB,
 * far under Supabase Free's 1 GB). Downscales to ≤ 1600 px, then lowers quality.
 */
export const MAX_PHOTO_BYTES = 500 * 1024;

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through (older Safari) */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

export async function compressImage(file: Blob, maxBytes = MAX_PHOTO_BYTES, maxDim = 1600): Promise<Blob> {
  const src = await loadBitmap(file);
  const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height;
  let scale = Math.min(1, maxDim / Math.max(w0, h0));
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    for (const q of [0.82, 0.72, 0.62, 0.5, 0.4]) {
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= maxBytes) return blob;
    }
    scale *= 0.75;
  }
  throw new Error('Could not compress the photo under 500 KB');
}
