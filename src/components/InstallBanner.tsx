'use client';
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { pwaStore } from '@/lib/pwa';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { Button } from './ui';

/** One-time "install to home screen" prompt (Android: native prompt; iOS: Share → Add to Home Screen). */
export function InstallBanner() {
  const pwa = pwaStore.use();
  const prefs = usePrefs();
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setIos(/iphone|ipad|ipod/i.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document));
  }, []);
  if (pwa.standalone || prefs.installDismissed || prefs.demo) return null;
  if (!pwa.installPrompt && !ios) return null;
  return (
    <div className="mx-3 mt-3 flex items-center gap-3 rounded-2xl border border-saxon/50 bg-saxon/10 p-3 text-sm sm:mx-4" role="note">
      <Download size={18} className="shrink-0 text-saxon" />
      <span className="flex-1">
        {pwa.installPrompt ? (
          'Install Saxon Scout so it opens instantly and works with no signal.'
        ) : (
          <>
            Install: tap <b>Share</b> ⬆ then <b>Add to Home Screen</b>. Sign in with e-mail + password inside the app.
          </>
        )}
      </span>
      {pwa.installPrompt && (
        <Button size="sm" variant="primary" onClick={() => void pwa.installPrompt?.prompt()}>
          Install
        </Button>
      )}
      <button aria-label="Dismiss" className="text-muted hover:text-fg" onClick={() => setPrefs({ installDismissed: true })}>
        <X size={16} />
      </button>
    </div>
  );
}
