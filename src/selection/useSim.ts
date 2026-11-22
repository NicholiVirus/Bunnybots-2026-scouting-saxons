'use client';
/** Runs simulations in a Web Worker (falls back to the main thread if workers are unavailable). */
import { useEffect, useRef } from 'react';
import { acceptOrDecline, predictBracket, predictEvent } from './eventSim';

type Fns = {
  predictEvent: typeof predictEvent;
  predictBracket: typeof predictBracket;
  acceptOrDecline: typeof acceptOrDecline;
};

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    // bundled by scripts/build-worker.mjs (esbuild) → served from public/, precached offline
    worker = new Worker('/workers/sim.worker.js', { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    worker.onerror = () => {
      // worker failed to load: run everything on the main thread from now on
      worker = null;
      for (const [id, p] of pending) {
        pending.delete(id);
        p.reject(new Error('worker-failed'));
      }
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function runSim<K extends keyof Fns>(type: K, ...args: Parameters<Fns[K]>): Promise<ReturnType<Fns[K]>> {
  const w = typeof window !== 'undefined' ? getWorker() : null;
  if (!w) {
    const fns: Fns = { predictEvent, predictBracket, acceptOrDecline };
    return Promise.resolve((fns[type] as (...a: unknown[]) => ReturnType<Fns[K]>)(...args));
  }
  const id = nextId++;
  const viaWorker = new Promise<ReturnType<Fns[K]>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, type, payload: args });
  });
  return viaWorker.catch((e: Error) => {
    if (e.message !== 'worker-failed') throw e;
    const fns: Fns = { predictEvent, predictBracket, acceptOrDecline };
    return (fns[type] as (...a: unknown[]) => ReturnType<Fns[K]>)(...args);
  });
}

/** Debounced re-run whenever `key` changes (results arrive via callback). */
export function useSimOnChange<T>(key: string, enabled: boolean, start: () => Promise<T>, done: (r: T) => void) {
  const latest = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const id = ++latest.current;
    const t = setTimeout(() => {
      void start().then((r) => {
        if (id === latest.current) done(r);
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}
