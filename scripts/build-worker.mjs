#!/usr/bin/env node
/**
 * Bundles the simulation Web Worker into public/workers/sim.worker.js.
 * Done with esbuild (not the Next bundler) so it works identically under
 * Turbopack/webpack, in dev and in the static export, and is precached offline.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'src/workers/sim.worker.ts')],
  outfile: path.join(root, 'public/workers/sim.worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  sourcemap: false,
  alias: { '@': path.join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_TBA_CLONE_URL': '""' },
  logLevel: 'warning',
});
console.log('worker: public/workers/sim.worker.js');
