import { expect, test } from '@playwright/test';
import { demoDevice, setDemoCutoff } from './helpers';

test('pick a team on the live board; a second screen sees it in < 2 s; undo works', async ({ browser }) => {
  const ctx = await browser.newContext();
  await demoDevice(ctx);
  const a = await ctx.newPage();
  await setDemoCutoff(a, 'Q32'); // every qual played, selection not started
  await a.goto('/selection/');
  await expect(a.getByTestId('picking-label')).toContainText('Picking as 611');
  await expect(a.getByTestId('turn')).toContainText('Round 1 · Alliance 1');

  // second "device" (same browser storage → live IndexedDB sync across tabs)
  const b = await ctx.newPage();
  await b.goto('/selection/');
  await expect(b.getByTestId('turn')).toContainText('Round 1 · Alliance 1');

  const firstAvail = await a.locator('[data-testid^="avail-"]').first().getAttribute('data-testid');
  const team = firstAvail!.replace('avail-', '');
  await a.getByTestId(`pick-${team}`).click();
  await expect(a.getByTestId('slot-1-1')).toContainText(team.replace(/b$/, 'B'));
  const t0 = Date.now();
  await expect(b.getByTestId('slot-1-1')).toContainText(team.replace(/b$/, 'B'), { timeout: 2000 });
  expect(Date.now() - t0).toBeLessThan(2000);
  await expect(b.getByTestId('turn')).toContainText('Alliance 2');

  await a.getByTestId('undo').click();
  await expect(b.getByTestId('turn')).toContainText('Round 1 · Alliance 1', { timeout: 2000 });

  // picking-as switches instantly and is remembered per device
  await a.getByTestId('picking-526').click();
  await expect(a.getByTestId('picking-label')).toContainText('Picking as 526');
  await a.reload();
  await expect(a.getByTestId('picking-label')).toContainText('Picking as 526');

  // predictor runs (Web Worker) and the quick card renders
  await a.getByRole('tab', { name: 'Predictor' }).click();
  await expect(a.getByText('Predicted captains')).toBeVisible({ timeout: 15000 });
  await a.getByRole('tab', { name: 'Quick card' }).click();
  await expect(a.getByTestId('quick-card')).toBeVisible();
  await ctx.close();
});
