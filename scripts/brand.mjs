#!/usr/bin/env node
/**
 * `npm run brand` — generates every installed-app image from your logo:
 *   public/icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png,
 *   favicon-16.png, favicon-32.png, public/favicon.ico,
 *   public/icons/splash/*.png (iOS home-screen launch images),
 *   public/manifest.webmanifest
 * Source: the still image picked by scripts/brand-manifest.mjs
 * (logo-still.png/svg for video/Lottie logos, otherwise the logo itself).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [path.join(root, 'scripts', 'brand-manifest.mjs')], { stdio: 'inherit' });
const brand = JSON.parse(readFileSync(path.join(root, 'src', 'generated', 'brand.json'), 'utf8'));

const BG = '#06261f';
const icons = path.join(root, 'public', 'icons');
const splashDir = path.join(icons, 'splash');
mkdirSync(splashDir, { recursive: true });

let srcPath = brand.still && !brand.still.startsWith('/icons/') ? path.join(root, 'public', brand.still) : null;
if (!srcPath || !existsSync(srcPath)) {
  console.warn('No still logo found — using the placeholder text mark.');
  srcPath = path.join(root, 'public', 'brand', 'logo.svg');
}
const src = readFileSync(srcPath);
// first frame for GIFs, high density for SVGs
const load = () => sharp(src, { density: 384, animated: false });

async function square(size, padRatio, bg) {
  const inner = Math.round(size * (1 - padRatio * 2));
  const logo = await load().resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
}

const out = (name, buf) => writeFileSync(path.join(icons, name), buf);
out('icon-192.png', await square(192, 0.04, BG));
out('icon-512.png', await square(512, 0.04, BG));
out('maskable-512.png', await square(512, 0.16, BG)); // safe zone for Android masks
out('apple-touch-icon.png', await square(180, 0.08, BG));
const f16 = await square(16, 0, BG);
const f32 = await square(32, 0, BG);
const f48 = await square(48, 0, BG);
out('favicon-16.png', f16);
out('favicon-32.png', f32);

// favicon.ico with embedded PNGs (valid ICO since Windows Vista; all browsers)
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}
writeFileSync(
  path.join(root, 'public', 'favicon.ico'),
  ico([
    { size: 16, buf: f16 },
    { size: 32, buf: f32 },
    { size: 48, buf: f48 },
  ]),
);

// iOS launch images (portrait): CSS size × DPR
const devices = [
  [375, 667, 2], // iPhone SE / 8
  [390, 844, 3], // iPhone 12–14
  [393, 852, 3], // iPhone 14 Pro / 15 / 16
  [430, 932, 3], // Pro Max / Plus
  [402, 874, 3], // iPhone 16 Pro
  [440, 956, 3], // iPhone 16 Pro Max
  [768, 1024, 2], // iPad mini / 9.7"
  [810, 1080, 2], // iPad 10.2"
  [820, 1180, 2], // iPad Air
  [1024, 1366, 2], // iPad Pro 12.9"
];
for (const [w, h, dpr] of devices) {
  const W = w * dpr;
  const H = h * dpr;
  const logoSize = Math.round(Math.min(W, H) * 0.42);
  const logo = await load().resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const img = await sharp({ create: { width: W, height: H, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(path.join(splashDir, `splash-${w}x${h}@${dpr}x.png`), img);
}

writeFileSync(
  path.join(root, 'public', 'manifest.webmanifest'),
  JSON.stringify(
    {
      name: 'Harvest Havoc Scouting — Saxon Robotics 611 · 526',
      short_name: 'Saxon Scout',
      description: 'Offline-first scouting + strategy for FRC 611 & 526 at Blair BunnyBots 2026.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: BG,
      theme_color: BG,
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  ) + '\n',
);

// refresh brand.json with the splash list
execFileSync(process.execPath, [path.join(root, 'scripts', 'brand-manifest.mjs')], { stdio: 'inherit' });
console.log(`Icons, favicon, ${devices.length} iOS splash images and manifest generated from ${path.relative(root, srcPath)}.`);
