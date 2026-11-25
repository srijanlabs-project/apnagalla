import { createHmac } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeIndianMobile, type VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { BillingService, referralCodeOf } from '../src/billing/billing';
import { openDatabase, type Database } from '../src/db/client';
import { otpRequests, platformPayments } from '../src/db/schema';
import { loadEnv } from '../src/env';
import type { OtpSender } from '../src/sms';

class FakeSender implements OtpSender {
  readonly name = 'fake';
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

let app: FastifyInstance;
let database: Database;
const sender = new FakeSender();
let ip = 0;
const env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  OTP_FIXED_CODE: '',
  RAZORPAY_WEBHOOK_SECRET: 'whsec',
  PLANS_ENFORCED: 'true',
  ADMIN_PHONES: '9870410001',
});

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env, database, otpSender: sender, billScanner: null, logger: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});

async function login(phone: string, client: 'mobile' | 'web' = 'mobile'): Promise<VerifyOtpResponse> {
  await database.db.delete(otpRequests).where(eq(otpRequests.phone, normalizeIndianMobile(phone)!));
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: `10.8.0.${++ip}` });
  return (await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(normalizeIndianMobile(phone)!)!, client } })).json();
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('plans and billing', () => {
  it('a new store is on a trial; codes are checked; a signed payment extends the plan once', async () => {
    const owner = await login('9870410101');
    const oH = bearer(owner.accessToken);
    const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: oH, payload: { name: 'Plan Shop' } })).json<{ id: string }>();
    const b = (await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/billing`, headers: oH })).json();
    expect(b.status).toMatchObject({ state: 'trial', planId: 'pro', daysLeft: 30, enforced: true, canPay: false });
    expect(b.plans.map((p: { id: string }) => p.id)).toEqual(['free', 'basic', 'pro']);

    const quote = (code?: string) => app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/billing/quote`, headers: oH, payload: { planId: 'basic', period: 'month', code } });
    expect((await quote()).json()).toMatchObject({ amount: 29900, gst: 5382, total: 35282 });
    expect((await quote('NOPE')).statusCode).toBe(400);
    expect((await quote(referralCodeOf(biz.id))).statusCode).toBe(400); // not your own code

    // Admin makes a 50% partner coupon.
    const admin = bearer((await login('9870410001', 'web')).accessToken);
    expect((await app.inject({ method: 'POST', url: '/v1/admin/coupons', headers: admin, payload: { code: 'DIST50', kind: 'pct', value: 50, partner: 'Ramesh Distributors' } })).statusCode).toBe(200);
    expect((await quote('dist50')).json()).toMatchObject({ amount: 14950, code: 'DIST50' });
    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/billing/pay`, headers: oH, payload: { planId: 'basic', period: 'month' } })).statusCode).toBe(400);

    // A payment link (made as if by Razorpay) gets paid: the webhook must be signed.
    await database.db.insert(platformPayments).values({ businessId: biz.id, planId: 'basic', period: 'year', amount: 299900, gst: 53982, total: 353882, code: 'DIST50', linkId: 'plink_1' });
    const body = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_1' } } } });
    const hook = (sig: string) => app.inject({ method: 'POST', url: '/v1/billing/razorpay-webhook', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig }, payload: body });
    expect((await hook('bad')).statusCode).toBe(400);
    const sig = createHmac('sha256', 'whsec').update(body).digest('hex');
    expect((await hook(sig)).json()).toEqual({ result: 'ok' });
    expect((await hook(sig)).json()).toEqual({ result: 'ok' });
    const after = (await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/billing`, headers: oH })).json().status;
    expect(after).toMatchObject({ state: 'active', planId: 'basic' });
    expect(after.daysLeft).toBeGreaterThan(360);
    const inv = (await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/billing/invoices`, headers: oH })).json().invoices;
    expect(inv).toHaveLength(1);
    expect(inv[0].invoiceNo).toMatch(/^AG\/\d{2}-\d{2}\/00001$/);
    const coupons = (await app.inject({ method: 'GET', url: '/v1/admin/coupons', headers: admin })).json().coupons;
    expect(coupons[0]).toMatchObject({ code: 'DIST50', used: 1 });
  });

  it('with limits on: staff and bills above the plan are refused; a lapsed plan falls back to Free', async () => {
    const owner = await login('9870410201');
    const oH = bearer(owner.accessToken);
    const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: oH, payload: { name: 'Small Shop' } })).json<{ id: string }>();
    const admin = bearer((await login('9870410001', 'web')).accessToken);
    // Put the store on Free (1 staff) and let the time run out.
    await app.inject({ method: 'POST', url: `/v1/admin/stores/${biz.id}/plan`, headers: admin, payload: { planId: 'free', days: 0 } });
    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: oH, payload: { phone: '9870410202' } })).statusCode).toBeLessThan(300);
    const second = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: oH, payload: { phone: '9870410203' } });
    const staffCount = second.statusCode;
    // One invite is not yet a member, so a second invite is still fine; accept one and try again.
    expect(staffCount).toBeLessThan(300);
    const staff = await login('9870410202');
    await app.inject({ method: 'POST', url: `/v1/invites/${staff.me.invites[0]!.id}/accept`, headers: bearer(staff.accessToken) });
    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: oH, payload: { phone: '9870410204' } })).statusCode).toBe(400);

    // Bills: Free allows 300 a month; set it to 1 for the test.
    await app.inject({ method: 'PUT', url: '/v1/admin/plans', headers: admin, payload: { id: 'free', name: 'Free', priceMonthly: 0, priceYearly: 0, limits: { stores: 1, staff: 1, billsPerMonth: 1, scansPerDay: 5 }, active: true, sort: 0 } });
    const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const bill = (id: string) => ({ table: 'invoices', id, data: { id, status: 'saved', number: `INV/${id}`, date, lines: [], totals: { grandTotal: 100 }, updatedAt: new Date().toISOString() } });
    const pushed = (await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/sync/push`, headers: oH, payload: { changes: [bill('a'), bill('b')] } })).json().results;
    expect(pushed.map((r: { status: string }) => r.status)).toEqual(['ok', 'rejected']);

    // A paid plan that ended: grace days, then the Free plan's limits.
    const service = new BillingService(database.db, env);
    await app.inject({ method: 'POST', url: `/v1/admin/stores/${biz.id}/plan`, headers: admin, payload: { planId: 'basic', days: 0 } });
    expect((await service.status(biz.id, new Date(Date.now() + 33 * 86_400_000))).state).toBe('grace');
    const lapsed = await service.status(biz.id, new Date(Date.now() + 40 * 86_400_000));
    expect(lapsed).toMatchObject({ state: 'expired', limits: { staff: 1, billsPerMonth: 1 } });
  });
});
