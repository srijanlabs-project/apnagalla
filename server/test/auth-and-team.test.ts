import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeIndianMobile, type MeResponse, type TeamResponse, type VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { loadEnv } from '../src/env';
import type { OtpSender } from '../src/sms';

/** Captures codes instead of sending SMS. */
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
let ipCounter = 0;

beforeAll(async () => {
  const env = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '' });
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env, database, otpSender: sender, logger: false });
});

afterAll(async () => {
  await app?.close();
  await database?.close();
});

async function login(phone: string): Promise<VerifyOtpResponse> {
  // A distinct IP per login keeps the per-IP limit out of unrelated tests.
  const ip = `10.0.0.${++ipCounter}`;
  const r1 = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: ip });
  expect(r1.statusCode).toBe(200);
  const e164 = normalizeIndianMobile(phone)!;
  const code = sender.last.get(e164)!;
  const r2 = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code, deviceName: 'test' } });
  expect(r2.statusCode).toBe(200);
  return r2.json();
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('OTP login', () => {
  it('rejects an invalid phone number', async () => {
    const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '12345' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('validation');
  });

  it('logs in, normalises the phone and returns an empty profile', async () => {
    const res = await login('98765 43210');
    expect(res.me.user.phone).toBe('+919876543210');
    expect(res.me.memberships).toEqual([]);
    expect(res.accessToken).toBeTruthy();
  });

  it('enforces a resend cooldown', async () => {
    const payload = { phone: '9000000001' };
    expect((await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload })).statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload });
    expect(again.statusCode).toBe(429);
    expect(again.headers['retry-after']).toBeDefined();
  });

  it('rejects a wrong code and locks after 5 attempts', async () => {
    const phone = '9000000002';
    await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
    const real = sender.last.get('+919000000002')!;
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: wrong } });
      expect(r.statusCode).toBe(400);
    }
    const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: real } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('otp_locked');
  });

  it('does not accept the same code twice', async () => {
    const phone = '9000000003';
    await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
    const code = sender.last.get('+919000000003')!;
    expect((await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code } })).statusCode).toBe(400);
  });

  it('rotates refresh tokens and kills the session on logout', async () => {
    const { refreshToken } = await login('9000000004');
    const r1 = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });
    expect(r1.statusCode).toBe(200);
    // Old refresh token no longer works.
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } })).statusCode).toBe(401);

    const { accessToken } = r1.json();
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(accessToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(accessToken) })).statusCode).toBe(204);
    // Access token is refused immediately after logout, not after it expires.
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(accessToken) })).statusCode).toBe(401);
  });

  it('requires auth', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: bearer('garbage') })).statusCode).toBe(401);
  });
});

describe('business and team', () => {
  it('owner creates a business, invites staff, staff accepts; roles are enforced', async () => {
    const owner = await login('9100000001');
    const ownerH = bearer(owner.accessToken);

    const nameRes = await app.inject({ method: 'PATCH', url: '/v1/me', headers: ownerH, payload: { name: 'Asha' } });
    expect(nameRes.json<MeResponse>().user.name).toBe('Asha');

    const bizRes = await app.inject({ method: 'POST', url: '/v1/businesses', headers: ownerH, payload: { name: 'Asha Traders', city: 'Pune' } });
    expect(bizRes.statusCode).toBe(201);
    const biz = bizRes.json();

    // Phase 1: one business per user.
    const second = await app.inject({ method: 'POST', url: '/v1/businesses', headers: ownerH, payload: { name: 'Other' } });
    expect(second.statusCode).toBe(409);

    const inv = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: ownerH, payload: { phone: '9100000002' } });
    expect(inv.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: ownerH, payload: { phone: '+91 91000 00002' } });
    expect(dup.statusCode).toBe(409);

    const staff = await login('9100000002');
    expect(staff.me.invites).toHaveLength(1);
    expect(staff.me.invites[0]!.businessName).toBe('Asha Traders');
    expect(staff.me.invites[0]!.invitedByName).toBe('Asha');

    const staffH = bearer(staff.accessToken);
    const accepted = await app.inject({ method: 'POST', url: `/v1/invites/${staff.me.invites[0]!.id}/accept`, headers: staffH });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json<MeResponse>().memberships).toEqual([{ businessId: biz.id, businessName: 'Asha Traders', role: 'staff' }]);

    // Staff can read the business but not manage the team.
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}`, headers: staffH })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/team`, headers: staffH })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: staffH, payload: { phone: '9100000009' } })).statusCode,
    ).toBe(403);

    const team = (await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/team`, headers: ownerH })).json<TeamResponse>();
    expect(team.members.map((m) => m.role)).toEqual(['owner', 'staff']);
    expect(team.invites).toEqual([]);

    // Owner can't remove themselves; can remove staff, who then loses access.
    expect((await app.inject({ method: 'DELETE', url: `/v1/businesses/${biz.id}/members/${owner.me.user.id}`, headers: ownerH })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/v1/businesses/${biz.id}/members/${staff.me.user.id}`, headers: ownerH })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}`, headers: staffH })).statusCode).toBe(403);
  });

  it('an outsider cannot see another business', async () => {
    const a = await login('9200000001');
    const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: bearer(a.accessToken), payload: { name: 'A Co' } })).json();
    const b = await login('9200000002');
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}`, headers: bearer(b.accessToken) })).statusCode).toBe(403);
  });

  it('an invite can only be accepted by the invited number', async () => {
    const a = await login('9300000001');
    const aH = bearer(a.accessToken);
    const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: aH, payload: { name: 'B Co' } })).json();
    const inv = (await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: aH, payload: { phone: '9300000002' } })).json();
    const intruder = await login('9300000003');
    const r = await app.inject({ method: 'POST', url: `/v1/invites/${inv.id}/accept`, headers: bearer(intruder.accessToken) });
    expect(r.statusCode).toBe(404);
  });
});
