import { expect, test } from '@playwright/test';
import { demoDevice, waitForDemo } from './helpers';

const ROUTES: [string, RegExp][] = [
  ['/', /Saxon Robotics/],
  ['/scout/', /Scout/],
  ['/matches/', /Matches/],
  ['/match/?key=Q1', /Q1/],
  ['/rankings/', /Rankings/],
  ['/teams/', /Team catalog/],
  ['/team/?id=611', /611/],
  ['/pit/', /Pit scouting/],
  ['/pit/?id=526', /Pit scout 526/],
  ['/transfer/', /QR transfer/],
  ['/preview/', /Preview/],
  ['/selection/', /Alliance selection/],
  ['/compare/?teams=611,526,3504', /Compare teams/],
  ['/leaderboard/', /Scout leaderboard/],
  ['/admin/', /Admin/],
  ['/settings/', /Settings/],
];

test('every screen renders in demo mode without errors', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
  await page.goto('/');
  await waitForDemo(page);
  for (const [route, heading] of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first(), route).toHaveText(heading, { timeout: 15_000 });
  }
  expect(errors).toEqual([]);
  await ctx.close();
});

test('admin is locked behind the team passcode', async ({ browser }) => {
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const page = await ctx.newPage();
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Admin locked/);
  await expect(page.getByRole('button', { name: 'Reload demo' })).toHaveCount(0);
  await page.getByTestId('admin-passcode').fill('nope');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText(/Wrong passcode/)).toBeVisible();
  await page.getByTestId('admin-passcode').fill('ssti');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: 'Reload demo' })).toBeVisible();
  // stays unlocked for the rest of the session
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reload demo' })).toBeVisible();
  await ctx.close();
});
