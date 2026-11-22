'use client';
/**
 * Service worker registration + "update ready" flow. A new version installs in
 * the background and waits; it activates only when the user taps "Update" (never
 * mid-match) or on the next cold launch.
 */
import { createStore } from './store';

export const pwaStore = createStore<{
  updateReady: boolean;
  installPrompt: (Event & { prompt: () => Promise<void> }) | null;
  standalone: boolean;
  swActive: boolean;
}>({ updateReady: false, installPrompt: null, standalone: false, swActive: false });

let waiting: ServiceWorker | null = null;

export function registerServiceWorker() {
  if (typeof window === 'undefined') return;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  pwaStore.set({ standalone });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pwaStore.set({ installPrompt: e as Event & { prompt: () => Promise<void> } });
  });

  if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      pwaStore.set({ swActive: !!reg.active });
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            pwaStore.set({ updateReady: true });
          }
          if (w.state === 'activated') pwaStore.set({ swActive: true });
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        pwaStore.set({ updateReady: true });
      }
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      // check for a new deploy every 30 minutes while open
      setInterval(() => reg.update().catch(() => undefined), 30 * 60_000);
    } catch {
      /* SW unsupported (e.g. Firefox private) — app still works online */
    }
  };
  // hydration usually happens after `load` already fired
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', () => void register(), { once: true });

  let reloaded = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    // Only after the user tapped "Update now" — never on first install or mid-match.
    if (reloaded || !updateRequested) return;
    reloaded = true;
    window.location.reload();
  });
}

let updateRequested = false;

export function applyUpdate() {
  updateRequested = true;
  waiting?.postMessage({ type: 'SKIP_WAITING' });
}
