import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { normalizeIndianMobile, type VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { otpRequests, storeExports } from '../src/db/schema';
import { loadEnv } from '../src/env';
import { buildDailyExcel } from '../src/exports/dailyExcel';
import { seal, unseal } from '../src/exports/delivery';
import { ExportService, indiaNow } from '../src/exports/exportService';
import type { BillScanner, ScannedBill } from '../src/scan/billScanner';
import type { OtpSender } from '../src/sms';

class FakeSender implements OtpSender {
  readonly name = 'fake';
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

const BILL: ScannedBill = {
  supplierName: 'Shree Traders',
  supplierGstin: '24AAACS1234A1Z5',
  billNo: 'ST/88',
  date: '2026-11-20',
  hasGst: true,
  igst: false,
  lines: [{ name: 'Rice 25kg', hsn: '1006', qty: 4, unit: 'bag', rate: 1200, taxPct: 5, mrp: 0 }],
  total: 5040,
};
const scans: string[] = [];
const fakeScanner: BillScanner = {
  name: 'fake',
  async scan(img) {
    scans.push(img.mediaType);
    return BILL;
  },
};

let app: FastifyInstance;
let database: Database;
const sender = new FakeSender();
let ip = 0;
const env = loadEnv({
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  OTP_FIXED_CODE: '',
  SCAN_PER_DAY: '2',
  RESEND_API_KEY: 're_test',
  DROPBOX_APP_KEY: 'k',
  DROPBOX_APP_SECRET: 's',
});

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env, database, otpSender: sender, billScanner: fakeScanner, logger: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});
afterEach(() => vi.unstubAllGlobals());

async function login(phone: string): Promise<VerifyOtpResponse> {
  await database.db.delete(otpRequests).where(eq(otpRequests.phone, normalizeIndianMobile(phone)!));
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: `10.9.0.${++ip}` });
  const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(normalizeIndianMobile(phone)!)!, client: 'mobile' } });
  return r.json();
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function store(base: string) {
  const owner = await login(`${base}1`);
  const oH = bearer(owner.accessToken);
  const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: oH, payload: { name: `Store ${base}` } })).json<{ id: string }>();
  await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: oH, payload: { phone: `${base}2` } });
  const staff = await login(`${base}2`);
  const sH = bearer(staff.accessToken);
  await app.inject({ method: 'POST', url: `/v1/invites/${staff.me.invites[0]!.id}/accept`, headers: sH });
  return { biz, oH, sH };
}

describe('bill scanning', () => {
  it('reads a bill for the owner, keeps it from staff without cost access, and caps scans per day', async () => {
    const { biz, oH, sH } = await store('987031000');
    expect((await app.inject({ method: 'GET', url: '/v1/features', headers: oH })).json()).toMatchObject({ scanBill: true });
    const scan = (h: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/scan-bill`, headers: h, payload });
    const ok = await scan(oH, { image: 'aGVsbG8=', mediaType: 'image/jpeg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bill.billNo).toBe('ST/88');
    expect((await scan(oH, { image: 'aGVsbG8=', mediaType: 'image/gif' })).statusCode).toBe(400);
    expect((await scan(sH, { image: 'aGVsbG8=', mediaType: 'image/jpeg' })).statusCode).toBe(403);
    // A paper sales bill isn't about costs: staff may scan it.
    expect((await scan(sH, { image: 'aGVsbG8=', mediaType: 'image/jpeg', kind: 'sale' })).statusCode).toBe(200);
    expect((await scan(oH, { image: 'aGVsbG8=', mediaType: 'image/png' })).statusCode).toBe(429);
  });
});

describe('nightly Excel', () => {
  it('keeps settings for the owner only and builds the day file from synced records', async () => {
    const { biz, oH, sH } = await store('987031010');
    const put = (h: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url: `/v1/businesses/${biz.id}/exports`, headers: h, payload });
    expect((await put(sH, { email: 'a@b.in', hour: 21 })).statusCode).toBe(403);
    const saved = await put(oH, { email: 'owner@shop.in', hour: 22 });
    expect(saved.json()).toMatchObject({ enabled: true, email: 'owner@shop.in', hour: 22, available: { email: true, dropbox: true, google: false } });
    expect((await put(oH, { email: 'nope', hour: 22 })).statusCode).toBe(400);

    const { date } = indiaNow();
    await app.inject({
      method: 'POST',
      url: `/v1/businesses/${biz.id}/sync/push`,
      headers: oH,
      payload: {
        changes: [
          { table: 'invoices', id: 'i1', data: { id: 'i1', status: 'saved', number: 'INV/1', date, billTo: { name: 'Gupta' }, lines: [{ name: 'Rice', qty: 2 }], totals: { taxableAmount: 100000, taxTotal: 5000, grandTotal: 105000 }, updatedAt: new Date().toISOString() } },
          { table: 'payments', id: 'p1', data: { id: 'p1', invoiceId: 'i1', kind: 'payment', amount: 105000, mode: 'cash', date, updatedAt: new Date().toISOString() } },
        ],
      },
    });
    const without = (await buildDailyExcel(database.db, biz.id, 'Store 987031010', date)).buffer.length;
    await app.inject({
      method: 'POST',
      url: `/v1/businesses/${biz.id}/sync/push`,
      headers: oH,
      payload: { changes: [{ table: 'savedReports', id: 'r1', data: { id: 'r1', name: 'Sales by staff', nightly: true, spec: { source: 'bills', columns: ['total'], groupBy: 'staff', period: 'month' }, updatedAt: new Date().toISOString() } }] },
    });
    const file = await buildDailyExcel(database.db, biz.id, 'Store 987031010', date);
    expect(file.buffer.length).toBeGreaterThan(without);
    expect(file.buffer.length).toBeGreaterThan(1000);
    expect(file.fileName).toBe(`ApnaGalla-Store-987031010-${date}.xlsx`);
    expect(file.summary).toContain('1 bills, sales ₹1050.00, received ₹1050.00');

    // Email goes out when the hour comes, once a day.
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return new Response('{}', { status: 200 });
    });
    const service = new ExportService(database.db, env, env.JWT_SECRET);
    const at = (hourIst: number) => new Date(`${date}T${String(hourIst).padStart(2, '0')}:10:00+05:30`);
    expect(await service.runDue(at(21))).toBe(0);
    expect(await service.runDue(at(22))).toBe(1);
    expect(await service.runDue(at(23))).toBe(0);
    expect(calls).toEqual(['https://api.resend.com/emails']);
    expect((await service.get(biz.id)).lastSentDate).toBe(date);
  });

  it('connects Dropbox through the sign-in page and keeps the token encrypted', async () => {
    const { biz, oH } = await store('987031020');
    const r = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/exports/connect/dropbox`, headers: oH });
    const url = new URL(r.json<{ url: string }>().url);
    expect(url.host).toBe('www.dropbox.com');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ access_token: 'a', refresh_token: 'refresh-123' }), { status: 200 }));
    const back = await app.inject({ method: 'GET', url: `/v1/exports/callback/dropbox?code=xyz&state=${encodeURIComponent(url.searchParams.get('state')!)}` });
    expect(back.body).toContain('Connected');
    const [row] = await database.db.select().from(storeExports).where(eq(storeExports.businessId, biz.id));
    expect(row!.tokenEnc).not.toContain('refresh-123');
    expect(unseal(env.JWT_SECRET, row!.tokenEnc!)).toBe('refresh-123');
    // A forged state is refused.
    expect((await app.inject({ method: 'GET', url: '/v1/exports/callback/dropbox?code=xyz&state=forged' })).body).toContain('Not connected');
    expect(unseal('k', seal('k', 'x'))).toBe('x');
  });
});

describe('staff permissions', () => {
  it('the owner sets them; seeing costs follows the person, not only the store', async () => {
    const { biz, oH, sH } = await store('987031030');
    const team = (await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/team`, headers: oH })).json<{ members: { userId: string; role: string }[] }>();
    const staffId = team.members.find((m) => m.role === 'staff')!.userId;
    const set = (h: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/members/${staffId}/permissions`, headers: h, payload });
    expect((await set(sH, { seeCost: true })).statusCode).toBe(403);
    const pushSupplier = () =>
      app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/sync/push`, headers: sH, payload: { changes: [{ table: 'suppliers', id: 's1', data: { id: 's1', name: 'X', address: {}, openingBalance: 0, updatedAt: new Date().toISOString() } }] } });
    expect((await pushSupplier()).json().results[0].status).toBe('rejected');
    const r = await set(oH, { seeCost: true, maxDiscountPct: 10 });
    expect(r.statusCode).toBe(200);
    expect(r.json().members.find((m: { userId: string }) => m.userId === staffId).permissions).toEqual({ seeCost: true, maxDiscountPct: 10 });
    expect((await pushSupplier()).json().results[0].status).toBe('ok');
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: sH })).json<{ memberships: { businessId: string; permissions: unknown }[] }>();
    expect(me.memberships.find((m) => m.businessId === biz.id)!.permissions).toEqual({ seeCost: true, maxDiscountPct: 10 });
  });
});

