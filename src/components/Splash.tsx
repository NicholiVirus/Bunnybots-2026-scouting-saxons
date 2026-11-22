'use client';
/**
 * Launch splash. Plays ONCE per app launch (module flag survives client-side
 * navigation, resets on a real launch/reload). Tap to skip. Never blocks: any
 * load error goes straight into the app; hard cap 3.5 s. Reduced motion → static
 * logo for 0.5 s. Admin-uploaded logos (cached in IndexedDB) override the file
 * in public/brand/.
 */
import { useEffect, useRef, useState } from 'react';
import brand from '@/generated/brand.json';
import { db } from '@/data/db';
import { getPrefs } from '@/lib/prefs';

let shownThisLaunch = false;

type Src = { url: string; type: 'svg' | 'png' | 'gif' | 'video' | 'lottie' };

const STATIC_MS = 1500;
const MEDIA_CAP_MS = 3000;
const REDUCED_MS = 500;

export function Splash() {
  const [src, setSrc] = useState<Src | null>(null);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const lottieRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(() => setVisible(false), 350);
  };

  useEffect(() => {
    if (shownThisLaunch) return;
    shownThisLaunch = true;
    if (!getPrefs().splashEnabled) return;
    let hint: { enabled?: boolean } = {};
    try {
      hint = JSON.parse(localStorage.getItem('hh:splash') || '{}');
    } catch {
      /* ignore */
    }
    if (hint.enabled === false) return; // admin turned the splash off for everyone
    setVisible(true);
    const hardCap = setTimeout(finish, 3500);
    (async () => {
      try {
        const uploaded = await db.assets.get('logo');
        if (uploaded) {
          const url = URL.createObjectURL(uploaded.blob);
          setSrc({ url, type: (uploaded.source as Src['type']) || 'png' });
          return;
        }
      } catch {
        /* IndexedDB unavailable → bundled logo */
      }
      if (brand.file && brand.type) setSrc({ url: `${brand.file}?v=${brand.version}`, type: brand.type as Src['type'] });
      else finish();
    })();
    return () => clearTimeout(hardCap);
     
  }, []);

  useEffect(() => {
    if (!src) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const t = setTimeout(finish, REDUCED_MS);
      return () => clearTimeout(t);
    }
    if (src.type === 'svg' || src.type === 'png') {
      const t = setTimeout(finish, STATIC_MS);
      return () => clearTimeout(t);
    }
    const cap = setTimeout(finish, MEDIA_CAP_MS);
    if (src.type === 'lottie' && lottieRef.current) {
      let anim: { destroy: () => void } | null = null;
      (async () => {
        try {
          const [{ default: lottie }, data] = await Promise.all([
            import('lottie-web/build/player/lottie_light'),
            fetch(src.url).then((r) => r.json()),
          ]);
          if (doneRef.current || !lottieRef.current) return;
          const a = lottie.loadAnimation({ container: lottieRef.current, renderer: 'svg', loop: false, autoplay: true, animationData: data });
          a.addEventListener('complete', finish);
          a.addEventListener('data_failed', finish);
          anim = a;
        } catch {
          finish();
        }
      })();
      return () => {
        clearTimeout(cap);
        anim?.destroy();
      };
    }
    return () => clearTimeout(cap);
     
  }, [src]);

  if (!visible) return null;
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      data-testid="splash"
      onClick={finish}
      className={`fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-[#0b0e13] ${leaving ? 'hh-splash-out' : ''}`}
      aria-label="Loading — tap to skip"
      role="button"
    >
      {src && (src.type === 'svg' || src.type === 'png' || src.type === 'gif') && (
         
        <img
          src={src.url}
          alt="Saxon Robotics"
          onError={finish}
          className={`h-56 w-56 object-contain sm:h-72 sm:w-72 ${src.type !== 'gif' && !reduced ? 'hh-splash-anim' : ''}`}
        />
      )}
      {src && src.type === 'video' && !reduced && (
        <video src={src.url} autoPlay muted playsInline onEnded={finish} onError={finish} className="h-64 w-64 object-contain sm:h-80 sm:w-80" />
      )}
      {src && src.type === 'video' && reduced && (
         
        <img src={brand.still ?? '/icons/icon-512.png'} alt="Saxon Robotics" className="h-56 w-56 object-contain" onError={finish} />
      )}
      {src && src.type === 'lottie' && <div ref={lottieRef} className="h-64 w-64 sm:h-80 sm:w-80" />}
      <span className="absolute bottom-8 text-xs text-[#8d98ab] safe-bottom">Tap to skip</span>
    </div>
  );
}
