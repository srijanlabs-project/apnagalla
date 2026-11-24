import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { loadEnv } from '../src/env';
import type { GstProvider } from '../src/gst/lookup';
import type { OtpSender } from '../src/sms';

class FakeSender implements OtpSender {
  readonly name = 'fake';
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

/** Stand-in for the client's GST API: knows one GSTIN, counts calls. */
const fake = {
  calls: 0,
  provider: {
    name: 'fake',
    lookup: async (gstin: string) => {
      fake.calls++;
      if (gstin !== '24AABCP1234K1ZP') return null;
      return { gstin, legalName: 'PATEL TRADERS PRIVATE LIMITED', tradeName: 'Patel Traders', status: 'Active', active: true, stateCode: '24', address: { city: 'Ahmedabad', state: 'Gujarat', pin: '380001' } };
    },
  } satisfies GstProvider,
};

const sender = new FakeSender();
let app: FastifyInstance;
let bare: FastifyInstance;
let database: Database;

beforeAll(async () => {
  const env = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '', GST_LOOKUPS_PER_DAY: '3' });
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env, database, otpSender: sender, gstProvider: fake.provider, logger: false });
  bare = await buildApp({ env, database, otpSender: sender, gstProvider: null, logger: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await bare?.close();
  await database?.close();
});

async function ownerStore(phone: string) {
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const r = (await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(`+91${phone}`) } })).json<VerifyOtpResponse>();
  const h = { authorization: `Bearer ${r.accessToken}` };
  const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: h, payload: { name: 'GST test' } })).json<{ id: string }>();
  return { h, biz };
}

describe('GSTIN lookup', () => {
  it('checks the format first, caches answers, and stops at the daily limit', async () => {
    const { h, biz } = await ownerStore('9700000001');
    const get = (g: string, a = app) => a.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/gstin/${g}`, headers: h });

    expect((await get('24AABCP1234K1ZQ')).json()).toMatchObject({ error: 'invalid_gstin' });
    expect(fake.calls).toBe(0);

    const first = await get('24aabcp1234k1zp');
    expect(first.json()).toMatchObject({ found: true, info: { legalName: 'PATEL TRADERS PRIVATE LIMITED', active: true, address: { state: 'Gujarat' } } });
    await get('24AABCP1234K1ZP'); // cached: no second call
    expect(fake.calls).toBe(1);

    expect((await get('27AAPFU0939F1ZV')).json()).toEqual({ found: false, info: null });
    await get('08AAPFU0939F1ZV');
    expect((await get('07AAPFU0939F1ZW')).statusCode).toBe(400); // bad check digit: never counted
    // Three calls today (Patel, 27…, 08…): the fourth is refused, but cached answers still work.
    expect((await get('29AAPFU0939F1ZR')).statusCode).toBe(429);
    expect((await get('24AABCP1234K1ZP')).statusCode).toBe(200);
    expect(fake.calls).toBe(3);
  });

  it('says so when no GST API is set up', async () => {
    const { h, biz } = await ownerStore('9700000002');
    const r = await bare.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/gstin/27AAPFU0939F1ZV`, headers: h });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ error: 'gst_lookup_not_setup' });
  });
});
