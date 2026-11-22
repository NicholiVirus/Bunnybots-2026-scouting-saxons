#!/usr/bin/env node
/** Tiny static server for the `out/` export (npm start, Playwright). Usage: node scripts/serve.mjs [port] */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const port = Number(process.argv[2] || process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, 'index.html');
  else if (!existsSync(p) && existsSync(p + '.html')) p += '.html';
  if (!existsSync(p)) {
    const notFound = path.join(root, '404.html');
    res.writeHead(404, { 'content-type': types['.html'] });
    if (existsSync(notFound)) createReadStream(notFound).pipe(res);
    else res.end('Not found');
    return;
  }
  const ext = path.extname(p);
  res.writeHead(200, {
    'content-type': types[ext] || 'application/octet-stream',
    'cache-control': p.endsWith('sw.js') || ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(p).pipe(res);
}).listen(port, () => console.log(`Serving out/ on http://localhost:${port}`));
