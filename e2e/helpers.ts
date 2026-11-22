import type { BrowserContext, Page } from '@playwright/test';

/** Start a device in the demo sandbox (449's simulated event, local-only). */
export async function demoDevice(ctx: BrowserContext, extra: Record<string, unknown> = {}) {
  await ctx.addInitScript((prefs) => {
    if (!localStorage.getItem('hh:prefs:v1')) localStorage.setItem('hh:prefs:v1', JSON.stringify(prefs));
  }, { demo: true, splashEnabled: false, scoutName: 'E2E Scout', localRole: 'admin', ...extra });
}

/** Wait until demo data has been loaded into IndexedDB. */
export async function waitForDemo(page: Page) {
  await page.waitForFunction(
    async () => {
      const open = indexedDB.open('hh-scouting-demo');
      const db: IDBDatabase = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      if (!db.objectStoreNames.contains('matches')) return false;
      const count: number = await new Promise((res) => {
        const r = db.transaction('matches').objectStore('matches').count();
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(0);
      });
      db.close();
      return count >= 32;
    },
    undefined,
    { timeout: 30_000 },
  );
}

export async function idbCount(page: Page, store: string, filter?: string): Promise<number> {
  return page.evaluate(
    async ({ store, filter }) => {
      const open = indexedDB.open('hh-scouting-demo');
      const db: IDBDatabase = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const all: Record<string, unknown>[] = await new Promise((res) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result);
      });
      db.close();
      // eslint-disable-next-line no-new-func
      const f = filter ? (new Function('x', `return ${filter}`) as (x: Record<string, unknown>) => boolean) : () => true;
      return all.filter(f).length;
    },
    { store, filter },
  );
}

/** Replay the demo event up to a qual (no playoffs / alliances yet) via Admin → Data sources. */
export async function setDemoCutoff(page: Page, label: string) {
  await page.goto('/admin/');
  await waitForDemo(page);
  await page.getByRole('combobox').first().selectOption({ label });
  await page.getByRole('button', { name: 'Reload demo' }).click();
  await page.getByText(/^Loaded \d+ quals/).waitFor({ timeout: 30_000 });
}
