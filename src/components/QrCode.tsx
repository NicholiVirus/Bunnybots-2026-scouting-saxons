'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { Button } from './ui';

/** Renders one QR. Our payloads use the dense alphanumeric mode; QRScout text uses byte mode. */
export function QrCanvas({ text, size = 320, alphanumeric }: { text: string; size?: number; alphanumeric?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const data = alphanumeric ? [{ data: text, mode: 'alphanumeric' as const }] : text;
    QRCode.toCanvas(ref.current, data as never, { errorCorrectionLevel: 'M', margin: 2, width: size, color: { dark: '#000000', light: '#ffffff' } })
      .then(() => setErr(null))
      .catch((e: Error) => setErr(e.message));
  }, [text, size, alphanumeric]);
  return (
    <div className="inline-block rounded-2xl bg-white p-2">
      <canvas ref={ref} aria-label="QR code" data-testid="qr-canvas" data-qr={text} />
      {err && <p className="max-w-xs text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** Multi-part QR display: auto-advances so the receiver can scan all parts. */
export function QrSequence({ parts, alphanumeric = true }: { parts: string[]; alphanumeric?: boolean }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(parts.length > 1);
  useEffect(() => setI(0), [parts]);
  useEffect(() => {
    if (!playing || parts.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % parts.length), 1600);
    return () => clearInterval(t);
  }, [playing, parts.length]);
  if (!parts.length) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <QrCanvas text={parts[Math.min(i, parts.length - 1)]} alphanumeric={alphanumeric} />
      {parts.length > 1 && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setI((x) => (x - 1 + parts.length) % parts.length)} aria-label="Previous part">
            <ChevronLeft size={16} />
          </Button>
          <span className="tnum text-sm font-semibold">
            part {i + 1} / {parts.length}
          </span>
          <Button size="sm" onClick={() => setI((x) => (x + 1) % parts.length)} aria-label="Next part">
            <ChevronRight size={16} />
          </Button>
          <Button size="sm" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </Button>
        </div>
      )}
    </div>
  );
}
