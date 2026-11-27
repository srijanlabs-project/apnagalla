import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SyncPushResponse, VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { otpRequests } from '../src/db/schema';
import { loadEnv } from '../src/env';
import type { EInvoiceProvider } from '../src/gst/einvoice';
import type { OtpSender } from '../src/sms';

class FakeSender implements OtpSender {
  readonly name = 'fake';
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

const made: string[] = [];
const fakeEInvoice: EInvoiceProvider = {
  name: 'fake',
  async generate(gstin) {
    made.push(gstin);
    return { irn: 'irn-1', ackNo: '1', ackDate: '2026-11-28', signedQr: 'qr' };
  },
  async cancel(gstin) {
    made.push(`cancel:${gstin}`);
  },
};

const sender = new FakeSender();
let app: FastifyInstance;
let tight: FastifyInstance;
let database: Database;
const base = { NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '' };

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({
    env: loadEnv({ ...base, RESEND_API_KEY: 're_test', EXPORT_EMAIL_FROM: 'bills@example.com' }),
    database,
    otpSender: sender,
    eInvoiceProvider: fakeEInvoice,
    logger: false,
  });
  tight = await buildApp({ env: loadEnv({ ...base, RATE_LIMIT_PER_MINUTE: '20', OTP_DAILY_BUDGET: '3' }), database: await fresh(), otpSender: sender, logger: false });
}, 60_000);

async function fresh() {
  const d = await openDatabase({ pgliteDir: 'memory://' });
  await d.migrate(path.resolve(__dirname, '../drizzle'));
  return d;
}

afterAll(async () => {
  await app?.close();
  await tight?.close();
  await database?.close();
});

let ip = 0;
const nextIp = () => `10.91.${Math.floor(++ip / 200)}.${ip % 200}`;
async function login(phone: string) {
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: nextIp() });
  const r = (await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(`+91${phone}`), client: 'mobile' }, remoteAddress: nextIp() })).json<VerifyOtpResponse>();
  return { h: { authorization: `Bearer ${r.accessToken}` }, r };
}
async function storeWithStaff(ownerPhone: string, staffPhone: string) {
  const owner = await login(ownerPhone);
  const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: owner.h, payload: { name: 'Asha Traders' } })).json<{ id: string }>();
  await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: owner.h, payload: { phone: staffPhone } });
  const staff = await login(staffPhone);
  for (const inv of staff.r.me.invites) await app.inject({ method: 'POST', url: `/v1/invites/${inv.id}/accept`, headers: staff.h });
  return { biz, oH: owner.h, sH: staff.h };
}
const push = async (bizId: string, h: Record<string, string>, table: string, data: Record<string, unknown>) =>
  (
    await app.inject({ method: 'POST', url: `/v1/businesses/${bizId}/sync/push`, headers: h, payload: { changes: [{ table, id: data.id, data: { updatedAt: new Date().toISOString(), ...data } }] } })
  ).json<SyncPushResponse>().results[0]!;

describe('sign-in codes', () => {
  it('many wrong guesses sent at once still count, so a code allows only 5 tries', async () => {
    const phone = '9700000401';
    await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: nextIp() });
    const code = sender.last.get(`+91${phone}`)!;
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 20 }, () => app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: wrong }, remoteAddress: nextIp() })));
    const [row] = await database.db.select({ a: otpRequests.attempts }).from(otpRequests).where(eq(otpRequests.phone, `+91${phone}`));
    expect(row!.a).toBe(5);
    const right = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code }, remoteAddress: nextIp() });
    expect(right.json()).toMatchObject({ error: 'otp_locked' });
  });

  it('a number allows only 10 wrong guesses an hour, across new codes', async () => {
    const phone = '9700000402';
    const guessOnce = async () => {
      await database.db.update(otpRequests).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpRequests.phone, `+91${phone}`));
      await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: nextIp() });
      const code = sender.last.get(`+91${phone}`)!;
      for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: code === '000000' ? '111111' : '000000' }, remoteAddress: nextIp() });
    };
    await guessOnce();
    await guessOnce();
    await database.db.update(otpRequests).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(otpRequests.phone, `+91${phone}`));
    await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: nextIp() });
    const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(`+91${phone}`) }, remoteAddress: nextIp() });
    expect(r.json()).toMatchObject({ error: 'otp_locked', message: expect.stringContaining('hour') });
  });

  it('stops sending codes once the daily SMS budget is used', async () => {
    const send = (i: number) => tight.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: `970000050${i}` }, remoteAddress: `10.92.0.${i}` });
    for (let i = 1; i <= 3; i++) expect((await send(i)).statusCode).toBe(200);
    expect((await send(4)).statusCode).toBe(429);
  });
});

describe('request limits', () => {
  it('a made-up login token does not get a fresh allowance', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await tight.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer fake.${i}.token` }, remoteAddress: '10.93.0.1' })).statusCode;
    expect(last).toBe(429);
  });

  it('a made-up X-Forwarded-For does not change who is counted', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await tight.inject({ method: 'GET', url: '/v1/me', headers: { 'x-forwarded-for': `1.2.3.${i}, 10.93.0.2` }, remoteAddress: '10.93.0.250' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('store data checks', () => {
  it('only the owner can create or change gift vouchers', async () => {
    const { biz, oH, sH } = await storeWithStaff('9700000601', '9700000602');
    const v = { id: 'v1', code: 'GIFT-1', amount: 500, balance: 500, createdAt: new Date().toISOString() };
    expect((await push(biz.id, sH, 'vouchers', v)).status).toBe('rejected');
    expect((await push(biz.id, oH, 'vouchers', v)).status).not.toBe('rejected');
  });

  it('a photo must be a picture, not a link that runs code', async () => {
    const { biz, oH } = await storeWithStaff('9700000611', '9700000612');
    const bad = await push(biz.id, oH, 'expenses', { id: 'e1', amount: 100, date: '2026-11-28', photo: 'javascript:alert(1)' });
    expect(bad).toMatchObject({ status: 'rejected', reason: expect.stringContaining('photo') });
    const good = await push(biz.id, oH, 'expenses', { id: 'e2', amount: 100, date: '2026-11-28', photo: 'data:image/jpeg;base64,/9j/4AAQ' });
    expect(good.status).not.toBe('rejected');
  });
});

describe('emailing a bill', () => {
  const pdf = Buffer.from('%PDF-1.4 test bill').toString('base64');
  const mail = (bizId: string, h: Record<string, string>, to: string, pdfBase64 = pdf) =>
    app.inject({ method: 'POST', url: `/v1/businesses/${bizId}/email-doc`, headers: h, payload: { to, subject: 'Bill 12', fileName: 'bill-12.pdf', pdfBase64 } });

  it('sends only a real PDF, and staff only to saved customers', async () => {
    const sent: string[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      sent.push(String((init as RequestInit).body));
      return new Response('{"id":"x"}', { status: 200 });
    });
    try {
      const { biz, oH, sH } = await storeWithStaff('9700000701', '9700000702');
      expect((await mail(biz.id, oH, 'a@example.com', Buffer.from('<html>phish</html>').toString('base64'))).statusCode).toBe(400);
      expect((await mail(biz.id, sH, 'stranger@example.com')).statusCode).toBe(403);
      await push(biz.id, oH, 'customers', { id: 'c1', name: 'Ravi', email: 'Ravi@Example.com' });
      expect((await mail(biz.id, sH, 'ravi@example.com')).statusCode).toBe(200);
      expect((await mail(biz.id, oH, 'anyone@example.com')).statusCode).toBe(200);
      expect(sent).toHaveLength(2);
      expect(JSON.parse(sent[0]!)).toMatchObject({ subject: 'Asha Traders: Bill 12' });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('e-invoices', () => {
  it("are made and cancelled only for the store's own GSTIN", async () => {
    const { biz, oH } = await storeWithStaff('9700000801', '9700000802');
    const own = '27AAPFU0939F1ZV';
    const other = '29AAGCB7383J1Z4';
    const gen = (gstin: string, seller: string) =>
      app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/einvoice`, headers: oH, payload: { gstin, payload: { SellerDtls: { Gstin: seller } } } });
    expect((await gen(own, own)).statusCode).toBe(403); // no GSTIN saved in the store profile yet
    await push(biz.id, oH, 'profiles', { id: biz.id, name: 'Asha Traders', gstin: own.toLowerCase() });
    expect((await gen(other, other)).statusCode).toBe(403);
    expect((await gen(own, other)).statusCode).toBe(403);
    expect((await gen(own, own)).statusCode).toBe(200);
    const cancel = (gstin: string) =>
      app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/einvoice/cancel`, headers: oH, payload: { gstin, irn: 'irn-1234567890', reason: '2' } });
    expect((await cancel(other)).statusCode).toBe(403);
    expect((await cancel(own)).statusCode).toBe(200);
    expect(made).toEqual([own, `cancel:${own}`]);
  });
});
