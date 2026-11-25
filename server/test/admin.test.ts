import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminStoreDto, AuditEntryDto, MeResponse, VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { loadEnv } from '../src/env';
import { otpRequests } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import type { OtpSender } from '../src/sms';

class FakeSender implements OtpSender {
  readonly name = 'fake';
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

const sender = new FakeSender();
let app: FastifyInstance;
let database: Database;
const ADMIN = '9700000101';

beforeAll(async () => {
  const env = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '', ADMIN_PHONES: `${ADMIN}, 98 0000 0000` });
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env, database, otpSender: sender, logger: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});

let ip = 0;
async function login(phone: string, client: 'mobile' | 'web' = 'web') {
  const remoteAddress = `10.9.0.${++ip}`;
  // Logging in twice within 30 s hits the resend cooldown: start fresh.
  await database.db.delete(otpRequests).where(eq(otpRequests.phone, `+91${phone}`));
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress });
  const r = (await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(`+91${phone}`), client } })).json<VerifyOtpResponse>();
  return { h: { authorization: `Bearer ${r.accessToken}` }, me: r.me };
}

describe('admin panel', () => {
  it('is only for listed admins, on the web', async () => {
    const adminWeb = await login(ADMIN);
    expect(adminWeb.me.isAdmin).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/stores', headers: adminWeb.h })).statusCode).toBe(200);

    const adminPhone = await login(ADMIN, 'mobile');
    expect((await app.inject({ method: 'GET', url: '/v1/admin/stores', headers: adminPhone.h })).json()).toMatchObject({ error: 'admin_web_only' });

    const someone = await login('9700000102');
    expect(someone.me.isAdmin).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/v1/admin/stores', headers: someone.h })).statusCode).toBe(403);
  });

  it('creates a store for an owner, suspends it everywhere, reactivates it, and logs each step', async () => {
    const { h } = await login(ADMIN);
    const created = await app.inject({ method: 'POST', url: '/v1/admin/stores', headers: h, payload: { name: 'Gupta Kirana', ownerPhone: '9700000103', city: 'Indore' } });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: string }>().id;

    // The owner logs in with OTP and finds the store.
    const owner = await login('9700000103', 'mobile');
    expect(owner.me.memberships).toMatchObject([{ businessId: id, role: 'owner', suspended: false }]);

    const list = (await app.inject({ method: 'GET', url: '/v1/admin/stores?q=gupta', headers: h })).json<{ stores: AdminStoreDto[] }>().stores;
    expect(list).toMatchObject([{ id, name: 'Gupta Kirana', ownerPhone: '+919700000103', members: 1, bills: 0, suspendedAt: null }]);

    expect((await app.inject({ method: 'POST', url: `/v1/admin/stores/${id}/suspend`, headers: h, payload: {} })).statusCode).toBe(400); // reason needed
    expect((await app.inject({ method: 'POST', url: `/v1/admin/stores/${id}/suspend`, headers: h, payload: { reason: 'Unpaid plan' } })).statusCode).toBe(204);
    const pull = await app.inject({ method: 'GET', url: `/v1/businesses/${id}/sync/pull`, headers: owner.h });
    expect(pull.json()).toMatchObject({ error: 'store_suspended' });
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: owner.h })).json<MeResponse>();
    expect(me.memberships[0]!.suspended).toBe(true);

    await app.inject({ method: 'POST', url: `/v1/admin/stores/${id}/reactivate`, headers: h });
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${id}/sync/pull`, headers: owner.h })).statusCode).toBe(200);

    const log = (await app.inject({ method: 'GET', url: `/v1/admin/stores/${id}/audit`, headers: h })).json<{ entries: AuditEntryDto[] }>().entries;
    expect(log.map((e) => e.action)).toEqual(['admin.store_reactivated', 'admin.store_suspended', 'admin.store_created']);
    expect(log[1]).toMatchObject({ actorPhone: `+91${ADMIN}`, detail: { reason: 'Unpaid plan' } });
  });

  it('records sensitive changes that arrive by sync', async () => {
    const { h } = await login(ADMIN);
    const id = (await app.inject({ method: 'POST', url: '/v1/admin/stores', headers: h, payload: { name: 'Audit Store', ownerPhone: '9700000104' } })).json<{ id: string }>().id;
    const owner = await login('9700000104', 'mobile');
    const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
    const push = (changes: unknown[]) => app.inject({ method: 'POST', url: `/v1/businesses/${id}/sync/push`, headers: owner.h, payload: { changes } });
    const pay = { id: 'p1', invoiceId: 'i1', kind: 'payment', amount: 500, mode: 'cash', date: '2026-11-25', receivedBy: owner.me.user.id, updatedAt: at(-3) };
    await push([
      { table: 'invoices', id: 'i1', data: { id: 'i1', status: 'saved', number: 'INV/26-27/0001', totals: { grandTotal: 500 }, updatedAt: at(-4) } },
      { table: 'payments', id: 'p1', data: pay },
    ]);
    await push([
      { table: 'payments', id: 'p1', data: { ...pay, voidedAt: at(-2), voidReason: 'wrong bill', updatedAt: at(-2) } },
      { table: 'invoices', id: 'i1', data: { id: 'i1', status: 'cancelled', number: 'INV/26-27/0001', totals: { grandTotal: 500 }, updatedAt: at(-1) } },
    ]);
    const actions = (await app.inject({ method: 'GET', url: `/v1/admin/stores/${id}/audit`, headers: h })).json<{ entries: AuditEntryDto[] }>().entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['payment.voided', 'invoice.cancelled']));
  });
});
