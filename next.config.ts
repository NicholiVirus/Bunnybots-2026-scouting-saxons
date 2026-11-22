import type { NextConfig } from 'next';

/**
 * Static export: the whole app is plain HTML/JS/CSS in `out/`, so it
 *  - runs from the PWA cache with zero connectivity (event rule E6 bans hotspots),
 *  - deploys unchanged to Vercel Hobby OR Cloudflare Pages (any static host).
 * All data comes from IndexedDB (offline) + Supabase/Bunnybots Alliance (online).
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
