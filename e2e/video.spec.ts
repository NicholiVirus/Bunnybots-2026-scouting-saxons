import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { demoDevice, idbCount, unlockAdmin, waitForDemo } from './helpers';

/**
 * Automatic video scouting, end to end with real output of the video scout (BunnyBotsAutomaticScouting):
 * its simulator played Q1-Q3 with the demo schedule's lineups as a split-screen livestream (score-bar clock,
 * start / end sounds), `add-stream` split the stream into matches, `run` tracked the robots and read the
 * shelves, and `saxon-export` wrote this file. Q3 has 449B, which the video PC reports as 9449.
 */
const FIXTURE = 'e2e/fixtures/saxon_video.json';
const file = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: { match_key: string; team_id: string }[] };

async function openAdmin(page: Page) {
  await page.goto('/admin/');
  await page.getByTestId('admin-passcode').or(page.getByRole('button', { name: 'Reload demo' })).first().waitFor();
  await unlockAdmin(page);
  await waitForDemo(page);
}

test('import the video scout file; results show on match and team pages', async ({ browser }) => {
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openAdmin(page);

  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Video scouting/ }) });
  await expect(card.getByText('0 robot-matches stored')).toBeVisible();
  await card.locator('input[type="file"]').setInputFiles(FIXTURE);
  const n = file.rows.length;
  await expect(card.getByText(new RegExp(`^${n} robot-matches .* in 3 matches\\.`))).toBeVisible();
  // every team the video read is in the schedule (9449 = 449B is not a "misread bumper")
  await expect(card.getByText(/not in this match/)).toHaveCount(0);
  await card.getByRole('button', { name: 'Import' }).click();
  await expect(card.getByText(`Imported ${n} robot-matches from the video scout.`)).toBeVisible();
  await expect(card.getByText(`${n} robot-matches stored`)).toBeVisible();
  expect(await idbCount(page, 'video_reports')).toBe(n);

  // match page: one row per robot the video identified, next to the (absent) human scouting
  for (const key of ['Q1', 'Q2', 'Q3']) {
    await page.goto(`/match/?key=${key}`);
    const vc = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Video scouting (automatic)' }) });
    await expect(vc).toBeVisible();
    const teams = file.rows.filter((r) => r.match_key === key).map((r) => r.team_id);
    await expect(vc.locator('tbody tr')).toHaveCount(teams.length);
    await expect(vc.getByText('video only').first()).toBeVisible();
  }
  const q3 = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Video scouting (automatic)' }) });
  if (file.rows.some((r) => r.match_key === 'Q3' && ['9449', '449b'].includes(r.team_id))) {
    await expect(q3.locator('tbody td', { hasText: /^449b$/i })).toHaveCount(1);
  }

  // team page: the Video column in match history
  const t = file.rows.find((r) => r.match_key === 'Q1')!.team_id;
  await page.goto(`/team/?id=${t}`);
  const hist = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Match history (scouted + video)' }) });
  await expect(hist.getByRole('columnheader', { name: 'Video' })).toBeVisible();
  // the demo sandbox has a human scout's report for this robot in Q1: the video's points sit next to it
  // (with a +N flag where they disagree) instead of replacing it
  await expect(hist.getByRole('row', { name: /^Q1\b/ }).getByRole('cell').nth(2)).toHaveText(/^\d+(\.\d)?/);

  // remove all
  await page.goto('/admin/');
  await unlockAdmin(page);
  page.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Remove all' }).click();
  await expect(card.getByText(`Removed ${n} robot-matches.`)).toBeVisible();
  await page.goto('/match/?key=Q1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Q1/);
  await expect(page.getByRole('heading', { name: 'Video scouting (automatic)' })).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('live streams: add a YouTube link, stop it, remove it', async ({ browser }) => {
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const page = await ctx.newPage();
  await openAdmin(page);
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Live streams/ }) });
  // demo sandbox never syncs, so the app says the video PC can't see links added here
  await expect(card.getByText(/Server sync is off/)).toBeVisible();

  const add = card.getByRole('button', { name: 'Add stream' });
  await card.getByPlaceholder(/youtube\.com/).fill('https://example.com/not-a-stream');
  await expect(add).toBeDisabled();
  await card.getByPlaceholder(/youtube\.com/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await card.getByPlaceholder('Q12').fill('Q1');
  await card.getByPlaceholder('1:02:05').fill('0:28');
  await expect(add).toBeEnabled();
  await add.click();

  const row = card.getByTestId('video-stream');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('youtube.com/watch?v=dQw4w9WgXcQ');
  await expect(row).toContainText('waiting for the video PC');
  await row.getByRole('button', { name: 'Stop' }).click();
  await expect(row).toContainText('stopping');
  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Remove' }).click();
  await expect(card.getByTestId('video-stream')).toHaveCount(0);
  await ctx.close();
});
