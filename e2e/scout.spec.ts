import { expect, test } from '@playwright/test';
import { demoDevice, idbCount, waitForDemo } from './helpers';

test('scout a match with 3 robots: taps, undo, post-match, submit, QR to a second device', async ({ browser }) => {
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const page = await ctx.newPage();
  await page.goto('/scout/');
  await waitForDemo(page);
  await page.reload();

  // Setup: red alliance, all 3 robots, coverage shown
  await page.getByRole('button', { name: /^red$/i }).click();
  await page.getByRole('button', { name: 'Select all 3' }).click();
  await expect(page.getByTestId('coverage')).toBeVisible();
  const firstTeam = await page.locator('[data-testid^="robot-"]').first().getAttribute('data-testid');
  const team = firstTeam!.replace('robot-', '');
  await page.getByTestId('start').click();

  // Live: clock running, tap L3 carrot ×3, undo one, cake L2 ×1, taxi, park + haul
  await expect(page.getByTestId('clock')).toBeVisible();
  await page.getByTestId(`${team}-taxi`).click();
  for (let i = 0; i < 3; i++) await page.getByTestId(`${team}-carrot-L3-plus`).click();
  await page.getByTestId(`${team}-carrot-L3-minus`).click();
  await expect(page.getByTestId(`${team}-carrot-L3-count`)).toHaveText('2');
  await page.getByTestId(`${team}-cake-L2-plus`).click();
  await page.getByTestId(`${team}-intake-source`).click();
  await page.getByTestId(`${team}-park`).click();
  await page.getByTestId(`${team}-haul-cake-plus`).click();
  await page.getByTestId(`${team}-flag-died`).click();
  await page.getByTestId('match-ended').click();

  // Post-match: Submit locked until every robot tab was viewed
  await page.getByTestId('note').fill('Fast L3, died briefly');
  const tabs = page.locator('[data-testid^="post-tab-"]');
  const n = await tabs.count();
  expect(n).toBe(3);
  await expect(page.getByTestId('submit')).toBeDisabled();
  for (let i = 1; i < n; i++) await tabs.nth(i).click();
  await tabs.nth(0).click();
  await expect(page.getByTestId('submit')).toBeEnabled();
  await page.getByTestId('submit').click();
  await expect(page.getByText(/^Saved Q\d+/)).toBeVisible();

  expect(await idbCount(page, 'scout_submissions', "x.status === 'submitted' && x.device_id !== undefined && !String(x.app_version).endsWith('-demo')")).toBe(1);
  expect(await idbCount(page, 'scout_events', `x.team_id === '${team}'`)).toBeGreaterThan(0);

  // QR export
  await page.getByRole('button', { name: /Show QR code/ }).click();
  const canvas = page.getByTestId('qr-canvas').first();
  await expect(canvas).toBeVisible();
  const qr = await canvas.getAttribute('data-qr');
  expect(qr).toMatch(/^HH1\//);

  // Second device: import by pasting the code text (camera scan uses the same path)
  const ctx2 = await browser.newContext();
  await demoDevice(ctx2, { scoutName: 'Lead' });
  const p2 = await ctx2.newPage();
  await p2.goto('/transfer/');
  await waitForDemo(p2);
  await p2.getByTestId('qr-paste').fill(qr!);
  await p2.getByRole('button', { name: 'Import' }).click();
  await expect(p2.getByTestId('import-log')).toContainText(/new/);
  expect(await idbCount(p2, 'scout_submissions', "x.source === 'qr'")).toBe(1);
  // re-import is a no-op
  await p2.getByTestId('qr-paste').fill(qr!);
  await p2.getByRole('button', { name: 'Import' }).click();
  await expect(p2.getByTestId('import-log')).toContainText(/already had it/);
  expect(await idbCount(p2, 'scout_submissions', "x.source === 'qr'")).toBe(1);
  await ctx.close();
  await ctx2.close();
});

test('the installed app opens and scouts with no network (service worker cache)', async ({ browser }) => {
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const page = await ctx.newPage();
  await page.goto('/');
  await waitForDemo(page);
  // wait for the service worker to finish precaching
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.goto('/scout/');
  await expect(page.getByTestId('start')).toBeVisible();
  await page.getByRole('button', { name: /^blue$/i }).click();
  await page.locator('[data-testid^="robot-"]').first().click();
  await page.getByTestId('start').click();
  await expect(page.getByTestId('clock')).toBeVisible();
  await page.goto('/teams/');
  await expect(page.getByText('Team catalog')).toBeVisible();
  await ctx.setOffline(false);
  await ctx.close();
});
