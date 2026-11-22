import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the real static export (`npm run build` first), served by
 * scripts/serve.mjs — the same files that ship to Vercel / Cloudflare Pages.
 *   npm run build && npm run test:e2e
 */
const PORT = Number(process.env.E2E_PORT || 3210);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node scripts/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
