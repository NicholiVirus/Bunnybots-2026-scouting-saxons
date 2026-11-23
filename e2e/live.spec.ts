import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';

/** A stand-in for 449's "The Bunnybots Alliance" API (same paths + CORS). */
function mockApi(port: number) {
  const state = { q2Played: false, hits: 0 };
  const match = (n: number, played: boolean) => ({
    match_number: n,
    match_label: `Q${n}`,
    played,
    red1: 611,
    red2: 449,
    red3: 9449, // field-system encoding of 449b
    blue1: 526,
    blue2: 3504,
    blue3: 686,
    red_score: played ? 61 + n : null,
    blue_score: played ? 40 : null,
    stocked_rp_red: played,
    baked_rp_red: false,
    dinner_rp_red: false,
    stocked_rp_blue: false,
    baked_rp_blue: false,
    dinner_rp_blue: false,
  });
  const server: Server = createServer((req, res) => {
    state.hits++;
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const path = url.searchParams.get('api') ?? url.pathname.replace(/^\/api\//, '');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('content-type', 'application/json');
    if (path.startsWith('matches/qualification')) return res.end(JSON.stringify([match(1, true), match(2, state.q2Played)]));
    if (path.startsWith('matches/playoff')) return res.end('[]');
    if (path.startsWith('rankings')) return res.end('[]');
    if (path.startsWith('alliances')) return res.end('[]');
    res.statusCode = 404;
    res.end('{"error":"Unknown endpoint."}');
  });
  server.listen(port);
  return { server, state };
}

test('live mode: pulls from the results API and picks up a new result within 30 s', async ({ browser }) => {
  test.setTimeout(90_000);
  const port = 3299;
  const api = mockApi(port);
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      if (!localStorage.getItem('hh:prefs:v1')) localStorage.setItem('hh:prefs:v1', JSON.stringify({ splashEnabled: false, localRole: 'admin', scoutName: 'Lead' }));
    });
    const page = await ctx.newPage();
    await page.goto('/admin/');
    await page.getByTestId('admin-passcode').fill('SSTI');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByPlaceholder('https://…').fill(`http://localhost:${port}`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // fastest allowed poll for the test
    const poll = page.locator('input[type=number]').first();
    await poll.fill('10');
    await poll.blur();

    await page.goto('/matches/');
    await expect(page.getByText('Q1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('62', { exact: true })).toBeVisible();
    await expect(page.getByTestId('freshness')).toContainText('Bunnybots Alliance');
    // 9449 arrived as the B robot
    await expect(page.getByText('449B').first()).toBeVisible();

    api.state.q2Played = true;
    const t0 = Date.now();
    await expect(page.getByText('63', { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - t0).toBeLessThan(30_000);
    await ctx.close();
  } finally {
    api.server.close();
  }
});
