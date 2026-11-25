import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { loadEnv } from '../src/env';
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

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env: loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '' }), database, otpSender: sender, logger: false });
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});

let n = 0;
async function ownerWithStore(phone: string, client: 'mobile' | 'web') {
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: `10.88.0.${++n}` });
  const r = (await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(`+91${phone}`), client } })).json<VerifyOtpResponse>();
  const h = { authorization: `Bearer ${r.accessToken}` };
  const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: h, payload: { name: `Store ${phone}` } })).json<{ id: string }>();
  return { h, biz, userId: r.me.user.id };
}

describe('store isolation', () => {
  it("no route that names a store answers for someone who isn't in it", async () => {
    const victim = await ownerWithStore('9700000301', 'mobile');
    // Put something in the victim's store, so a leak would have data to show.
    await app.inject({
      method: 'POST',
      url: `/v1/businesses/${victim.biz.id}/sync/push`,
      headers: victim.h,
      payload: { changes: [{ table: 'customers', id: 'c1', data: { id: 'c1', name: 'Secret customer', updatedAt: new Date().toISOString() } }] },
    });

    for (const client of ['mobile', 'web'] as const) {
      const outsider = await ownerWithStore(client === 'mobile' ? '9700000302' : '9700000303', client);
      const storeRoutes = app.routeList.filter((r) => r.url.includes(':businessId'));
      expect(storeRoutes.length).toBeGreaterThan(15);
      for (const r of storeRoutes) {
        const url = r.url.replace(':businessId', victim.biz.id).replace(/:(\w+)/g, (_m, p: string) => (p === 'userId' ? victim.userId : p === 'gstin' ? '27AAPFU0939F1ZV' : '00000000-0000-4000-8000-000000000000'));
        const res = await app.inject({ method: r.method as 'GET', url, headers: outsider.h, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
        expect(res.statusCode, `${client} ${r.method} ${r.url} → ${res.statusCode} ${res.body.slice(0, 120)}`).toBe(403);
        expect(res.body).not.toContain('Secret customer');
      }
    }
  });

  it('without a login, every store route answers 401', async () => {
    for (const r of app.routeList.filter((r) => r.url.includes(':businessId'))) {
      const url = r.url.replace(/:(\w+)/g, '00000000-0000-4000-8000-000000000000');
      const res = await app.inject({ method: r.method as 'GET', url, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });
});
