'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from './ui';

/** Camera QR scanner (qr-scanner: BarcodeDetector when available, worker fallback). */
export function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<{ stop: () => void; destroy: () => void } | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!on || !video.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const { default: QrScannerLib } = await import('qr-scanner');
        if (cancelled || !video.current) return;
        const s = new QrScannerLib(
          video.current,
          (r: { data: string }) => {
            const now = Date.now();
            // ignore the same code re-read within 2 s
            if (r.data === last.current.text && now - last.current.at < 2000) return;
            last.current = { text: r.data, at: now };
            cb.current(r.data);
          },
          { returnDetailedScanResult: true, highlightScanRegion: true, maxScansPerSecond: 10, preferredCamera: 'environment' },
        );
        scanner.current = s;
        await s.start();
      } catch (e) {
        setErr((e as Error)?.message || 'Camera unavailable (needs https and camera permission).');
        setOn(false);
      }
    })();
    return () => {
      cancelled = true;
      scanner.current?.stop();
      scanner.current?.destroy();
      scanner.current = null;
    };
  }, [on]);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '1 / 1', maxWidth: 420 }}>
        <video ref={video} className="h-full w-full object-cover" muted playsInline />
        {!on && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Camera off</div>}
      </div>
      <Button variant={on ? 'secondary' : 'primary'} onClick={() => setOn((x) => !x)}>
        {on ? <CameraOff size={16} /> : <Camera size={16} />} {on ? 'Stop camera' : 'Start camera'}
      </Button>
      {err && <p className="text-sm text-bad">{err}</p>}
    </div>
  );
}
