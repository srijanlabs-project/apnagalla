import { expect, test } from '@playwright/test';

/**
 * After every deploy: is production up and answering, and does the test login still work end to end?
 *   npm run sanity:prod
 * The test login needs E2E_PHONE and E2E_OTP in e2e/.env.e2e (not committed). Without them only the
 * public checks run.
 */
const BASE = process.env.E2E_PROD ?? 'https://invoiceserver-production.up.railway.app';

test.describe.configure({ mode: 'serial' });

test('server and database are up', async ({ request }) => {
  const r = await request.get(`${BASE}/health`);
  expect(r.ok()).toBeTruthy();
  expect(await r.json()).toMatchObject({ ok: true, db: 'postgres' });
});

test('the web app opens to the login screen with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await expect(page.getByText('ApnaGalla').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder('98765 43210').or(page.getByText(/new sale|invoices/i)).first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('admin console opens; signed-out API calls are refused', async ({ request }) => {
  expect((await request.get(`${BASE}/admin`, { headers: { accept: 'text/html' } })).status()).toBeLessThan(400);
  // Signed-out API calls are refused, not crashed.
  expect((await request.get(`${BASE}/v1/me`)).status()).toBe(401);
});

// Production signs in with real SMS codes (MSG91) since 27 Nov 2026, so this runs only when a code is
// given for the run:  $env:E2E_OTP = "<code from the SMS>"  (after requesting one for E2E_PHONE).
test('test login: sign in, read the store, push and pull a record', async ({ request }) => {
  const phone = process.env.E2E_PHONE;
  const code = process.env.E2E_OTP;
  test.skip(!phone || !code, 'Production uses real SMS codes: give E2E_PHONE and a fresh E2E_OTP to run the test login');
  const v = await request.post(`${BASE}/v1/auth/otp/verify`, { data: { phone, code, client: 'mobile' } });
  expect(v.ok(), await v.text()).toBeTruthy();
  const { accessToken, me } = (await v.json()) as { accessToken: string; me: { memberships: { businessId: string; businessName: string }[] } };
  const headers = { authorization: `Bearer ${accessToken}` };
  const store = me.memberships.find((m) => /sanity|test/i.test(m.businessName)) ?? me.memberships[0];
  test.skip(!store, 'The test login has no store yet: open the app once with it and create "Sanity Test Store"');
  const biz = store!.businessId;
  const pull = await request.get(`${BASE}/v1/businesses/${biz}/sync/pull?since=0`, { headers });
  expect(pull.ok()).toBeTruthy();
  const id = `sanity-${Date.now()}`;
  const push = await request.post(`${BASE}/v1/businesses/${biz}/sync/push`, {
    headers,
    data: { changes: [{ table: 'customers', id, data: { id, name: `Sanity ${id}`, billingAddress: {}, openingBalance: 0, updatedAt: new Date().toISOString() } }] },
  });
  expect(push.ok()).toBeTruthy();
  expect((await push.json()).results[0].status).toBe('ok');
  // Tidy up: the test customer is deleted again.
  await request.post(`${BASE}/v1/businesses/${biz}/sync/push`, {
    headers,
    data: { changes: [{ table: 'customers', id, data: { id, name: `Sanity ${id}`, billingAddress: {}, openingBalance: 0, deleted: true, updatedAt: new Date(Date.now() + 1000).toISOString() } }] },
  });
  // The live voucher check answers (unknown code → none).
  const gv = await request.get(`${BASE}/v1/businesses/${biz}/vouchers/GV000000`, { headers });
  expect(gv.ok()).toBeTruthy();
  expect((await gv.json()).voucher).toBeNull();
});
