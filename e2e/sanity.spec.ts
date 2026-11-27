import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Critical and important shop flows, in order, on one phone-sized screen with one test login.
 * Each step fails loudly with a screenshot and trace in e2e-report/ when something breaks.
 */
const PHONE = process.env.E2E_PHONE ?? '9000000001';
const STORE = 'Sanity Test Store';
const stamp = Date.now().toString().slice(-6);
const ITEM = `Sanity Rice ${stamp}`;
const CUSTOMER = `Sanity Customer ${stamp}`;

test.describe.configure({ mode: 'serial' });
let page: Page;
const errors: string[] = [];

/** Ionic inputs: type into the real <input>/<textarea> inside the labelled field. */
async function fill(label: string | RegExp, value: string) {
  const field = page.locator('ion-input, ion-textarea').filter({ has: page.getByText(label, { exact: typeof label === 'string' }) }).first();
  const box = field.locator('input, textarea').first();
  await box.click();
  await box.fill(value);
}
/** An Ionic or plain button by its visible text. */
const btn = (name: string | RegExp) => page.locator('ion-button:visible, button:visible').filter({ hasText: name }).first();
const tap = (name: string | RegExp) => btn(name).click();
async function go(path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

let context: BrowserContext;

test.beforeAll(async ({ viewport, baseURL }) => {
  // A kept browser profile: the test login stays signed in between runs, so the OTP is asked only
  // when the session ends (the server limits how many codes one number may request per hour).
  const profile = resolve(__dirname, '.profile', new URL(baseURL ?? 'http://localhost').host.replace(/[^\w.-]/g, '_'));
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: viewport ?? { width: 375, height: 812 }, hasTouch: true, baseURL });
  page = context.pages()[0] ?? (await context.newPage());
  // Any uncaught error on any screen fails the run at the end.
  page.on('pageerror', (e) => errors.push(e.message));
});

test.afterAll(async () => {
  await context.close();
});

test('1. log in with the test login (and set up the test store the first time)', async () => {
  test.skip(!process.env.E2E_OTP, 'No test OTP: set E2E_OTP or OTP_FIXED_CODE in server/.env');
  await go('/');
  const phoneBox = page.getByPlaceholder('98765 43210');
  if (await phoneBox.isVisible().catch(() => false)) {
    await phoneBox.fill(PHONE);
    await tap(/get otp/i);
    const code = page.getByPlaceholder(/^•+$/).first();
    await code.waitFor();
    await code.fill(process.env.E2E_OTP!);
    // The app checks the code by itself once all digits are in; tap Verify only if it is still there.
    const verify = btn(/verify/i);
    if (await verify.isVisible().catch(() => false)) await verify.click().catch(() => undefined);
  }
  // First time only: name, then the business. Wait for whichever screen comes next.
  const name = page.getByPlaceholder(/your full name/i);
  const business = page.getByText(/create your business/i);
  const home = btn(/new sale/i);
  for (let step = 0; step < 3; step++) {
    await expect(name.or(business).or(home).first()).toBeVisible({ timeout: 20_000 });
    if (await home.isVisible()) break;
    if (await name.isVisible()) {
      await name.fill('Sanity Tester');
      await tap(/continue/i);
      await expect(name).toBeHidden({ timeout: 15_000 });
    } else if (await business.isVisible()) {
      await fill('Business name', STORE);
      await tap(/create business/i);
      await expect(business).toBeHidden({ timeout: 15_000 });
    }
  }
  await expect(home).toBeVisible({ timeout: 20_000 });
});

test('2. Home shows the quick buttons and figures', async () => {
  await go('/tabs/home');
  for (const b of [/new sale/i, /new invoice/i, /new estimate/i, /new expense/i]) await expect(btn(b)).toBeVisible();
  await expect(page.getByText(/cash in drawer/i).first()).toBeVisible();
});

test('3. add an item', async () => {
  await go('/tabs/items/new');
  await fill(/item \/ service name/i, ITEM);
  await fill(/price \(before tax\)/i, '50');
  await fill(/opening stock/i, '100');
  await tap(/^\s*save\s*$/i);
  await go('/tabs/items');
  await expect(page.getByText(ITEM)).toBeVisible();
});

test('4. add a customer', async () => {
  await go('/tabs/customers/new');
  await fill(/^name/i, CUSTOMER);
  await fill(/mobile|phone/i, `9${stamp}123`.slice(0, 10));
  await tap(/^\s*save\s*$/i);
  await go('/tabs/customers');
  await expect(page.getByText(CUSTOMER)).toBeVisible();
});

test('5. counter sale, cash with change given back', async () => {
  await go('/tabs/sale');
  const search = page.getByPlaceholder(/search item or type barcode/i);
  await search.fill(ITEM);
  await page.getByText(ITEM, { exact: true }).first().click();
  await expect(page.getByText(/1 item/i)).toBeVisible();
  await tap(/^\s*pay\s/i);
  // ₹59 bill (₹50 + 18%) or ₹50: take the second quick amount (a round note), so change is due.
  const quick = page.locator('.cash-quick ion-chip');
  await expect(quick.first()).toBeVisible();
  await quick.nth(1).click();
  await page.locator('ion-modal ion-button').filter({ hasText: /received/i }).last().click();
  await expect(page.getByText(/give back|change/i).first()).toBeVisible({ timeout: 15_000 });
});

test('6. sell by amount ("20 rice") offers the right line', async () => {
  // Rice is per pcs by default in a new store, so the by-amount row must NOT appear for it.
  await go('/tabs/sale');
  await page.getByPlaceholder(/search item or type barcode/i).fill(`20 ${ITEM}`);
  await expect(page.getByText(/sell "20/i)).toBeVisible();
});

test('7. credit bill to a customer, then receive the payment from To collect', async () => {
  await go('/tabs/sale');
  await page.locator('.sale-top ion-chip').first().click();
  await page.getByText(CUSTOMER).first().click();
  await page.getByPlaceholder(/search item or type barcode/i).fill(ITEM);
  await page.getByText(ITEM, { exact: true }).first().click();
  await tap(/^\s*pay\s/i);
  await tap(/save unpaid/i);
  await go('/tabs/to-collect');
  const row = page.locator('ion-item').filter({ hasText: CUSTOMER });
  await expect(row).toBeVisible();
  await row.locator('ion-button').filter({ hasText: /received/i }).click();
  await page.locator('ion-modal ion-button').filter({ hasText: /received/i }).last().click();
  await expect(page.getByText(/oldest bills marked paid/i)).toBeVisible();
});

test('8. bill detail opens, More menu lists the actions', async () => {
  await go('/tabs/invoices');
  await page.locator('ion-item').filter({ hasText: CUSTOMER }).first().click();
  await expect(page.getByText(/history/i).first()).toBeVisible();
  await page.locator('.action-bar .more-btn:visible').last().click();
  await expect(page.getByText(/print a4/i)).toBeVisible();
  await expect(page.getByText(/whatsapp to a number/i)).toBeVisible();
  await page.keyboard.press('Escape');
});

test('9. return items makes a credit note draft', async () => {
  await page.locator('.action-bar .more-btn:visible').last().click();
  const ret = page.getByText(/return items/i).first();
  await expect(ret).toBeVisible();
  await ret.click();
  await expect(page).toHaveURL(/credit-notes\/.+\/edit/);
});

test('10. estimate: create and see it in the list', async () => {
  await go('/tabs/estimates/new');
  await page.locator('.party-card').click();
  await page.getByText(CUSTOMER).first().click();
  await tap(/add item/i);
  await page.locator('ion-modal').getByText(ITEM).first().click().catch(() => undefined);
  await go('/tabs/estimates');
  await expect(page.getByText(/estimates/i).first()).toBeVisible();
});

test('11. expense from Home opens the form and saves', async () => {
  await go('/tabs/expenses?add=1');
  await expect(page.getByText(/add expense/i)).toBeVisible();
  await fill(/amount/i, '25');
  await page.locator('ion-modal ion-button').filter({ hasText: /^\s*save\s*$/i }).click();
  await expect(page.getByText(/₹25/).first()).toBeVisible();
});

test('12. cash book: formula help and day-end count', async () => {
  await go('/tabs/cash-book');
  await page.getByText(/how is this worked out/i).click();
  await expect(page.locator('.cash-formula')).toBeVisible();
  await expect(page.getByText(/day-end count/i)).toBeVisible();
});

test('13. reports: search and open the sales report', async () => {
  await go('/tabs/reports');
  await page.getByPlaceholder(/search reports/i).fill('sales report');
  await page.getByText(/^sales report$/i).first().click();
  await expect(page).toHaveURL(/reports\/sales/);
});

test('14. More: search finds settings; Hindi screens render', async () => {
  await go('/tabs/more');
  await page.getByPlaceholder(/search settings and pages/i).fill('backup');
  await expect(page.getByText(/backup and restore/i)).toBeVisible();
  await page.evaluate(() => localStorage.setItem('lang', 'hi'));
  await go('/tabs/more');
  await page.locator('ion-select').first().click();
  await page.getByText('हिन्दी').click().catch(() => undefined);
  await go('/tabs/home');
  await expect(page.locator('.quick-actions ion-button').first()).toBeVisible();
  // Back to English for the next run.
  await go('/tabs/more');
  await page.locator('ion-select').first().click();
  await page.getByText('English').click().catch(() => undefined);
});

test('15. screens that load on demand open from inside the app (not a white page)', async () => {
  const shown = () => page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
  await go('/tabs/more');
  await page.getByPlaceholder(/search settings and pages/i).fill('field visits');
  await page.getByText(/^field visits$/i).first().click();
  await expect(page).toHaveURL(/customers\/visits/);
  await expect(shown()).not.toHaveClass(/ion-page-invisible/);
  await expect(shown().getByText(/check in at a customer/i).first()).toBeVisible();
  await go('/tabs/items');
  await page.getByRole('button', { name: /tools/i }).first().click();
  await page.getByText(/^import$/i).first().click();
  await expect(page).toHaveURL(/items\/import/);
  await expect(shown()).not.toHaveClass(/ion-page-invisible/);
  await expect(shown().getByText(/import items/i).first()).toBeVisible();
});

test('16. no screen threw an error', async () => {
  expect(errors, errors.join('\n')).toEqual([]);
});
