// Screenshots of the main screens in each language, at phone size, using the sanity test login.
//   node e2e/lang-shots.mjs <out-folder> [hi,gu,pa]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = process.argv[2] ?? 'lang-shots';
const langs = (process.argv[3] ?? 'hi,gu,pa').split(',');
const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const profile = resolve('e2e/.profile', new URL(base).host.replace(/[^\w.-]/g, '_'));
mkdirSync(out, { recursive: true });

const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 375, height: 812 }, hasTouch: true, baseURL: base });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const go = async (path) => {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
};
for (const lang of langs) {
  await go('/tabs/home');
  await page.evaluate((l) => localStorage.setItem('CapacitorStorage.app.language', JSON.stringify(l)), lang);
  const shots = [
    ['home', '/tabs/home'],
    ['sale', '/tabs/sale'],
    ['invoices', '/tabs/invoices'],
    ['new-invoice', '/tabs/invoices/new'],
    ['customers', '/tabs/customers'],
    ['items', '/tabs/items'],
    ['new-item', '/tabs/items/new'],
    ['cash-book', '/tabs/cash-book'],
    ['reports', '/tabs/reports'],
    ['more', '/tabs/more'],
  ];
  for (const [name, path] of shots) {
    await go(path);
    if (name === 'sale') {
      const chip = page.locator('.sale-quick ion-button').first();
      if (await chip.isVisible().catch(() => false)) await chip.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(out, `${lang}-${name}.png`) });
  }
  // A bill's detail page and its More menu.
  await go('/tabs/invoices');
  const first = page.locator('ion-item').filter({ hasText: /INV/ }).first();
  if (await first.isVisible().catch(() => false)) {
    await first.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, `${lang}-bill.png`) });
    await page.locator('.action-bar .more-btn').last().click().catch(() => undefined);
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `${lang}-bill-menu.png`) });
  }
}
await go('/tabs/home');
await page.evaluate(() => localStorage.setItem('CapacitorStorage.app.language', JSON.stringify('en')));
await ctx.close();
console.log('done', out);
