import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_OWNED_STORES, normalizeIndianMobile, type MeResponse, type SessionDto, type TeamResponse, type VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { eq } from 'drizzle-orm';
import { openDatabase, type Database } from '../src/db/client';
import { otpRequests } from '../src/db/schema';
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
  // Embedded Postgres (PGlite) can take >10 s to boot on a busy machine.
}, 60_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});

async function login(phone: string, client: 'mobile' | 'web' = 'mobile'): Promise<VerifyOtpResponse> {
  // A distinct IP per login keeps the per-IP limit out of unrelated tests.
  const ip = `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  // Tests log the same number in several times; skip the 30 s resend cooldown.
  await database.db.delete(otpRequests).where(eq(otpRequests.phone, normalizeIndianMobile(phone)!));
  const r1 =await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: ip });
  expect(r1.statusCode).toBe(200);
  const e164 = normalizeIndianMobile(phone)!;
  const code = sender.last.get(e164)!;
  const r2 = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code, deviceName: `test ${client}`, client } });
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
    expect(accepted.json<MeResponse>().memberships).toEqual([
      { businessId: biz.id, businessName: 'Asha Traders', businessCity: 'Pune', businessState: null, role: 'staff', active: true, seriesCode: 'B', suspended: false, permissions: null },
    ]);

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

const createStore = async (h: Record<string, string>, name: string) => {
  const r = await app.inject({ method: 'POST', url: '/v1/businesses', headers: h, payload: { name } });
  expect(r.statusCode).toBe(201);
  return r.json<{ id: string }>();
};

describe('multiple stores', () => {
  it('an owner runs several stores and one staff member works in two of them', async () => {
    const owner = await login('9400000001');
    const oH = bearer(owner.accessToken);
    const s1 = await createStore(oH, 'Shop One');
    const s2 = await createStore(oH, 'Shop Two');
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: oH })).json<MeResponse>();
    expect(me.memberships.map((m) => [m.businessName, m.role])).toEqual([
      ['Shop One', 'owner'],
      ['Shop Two', 'owner'],
    ]);

    for (const s of [s1, s2]) {
      expect((await app.inject({ method: 'POST', url: `/v1/businesses/${s.id}/invites`, headers: oH, payload: { phone: '9400000002' } })).statusCode).toBe(201);
    }
    const staff = await login('9400000002');
    const sH = bearer(staff.accessToken);
    for (const inv of staff.me.invites) {
      expect((await app.inject({ method: 'POST', url: `/v1/invites/${inv.id}/accept`, headers: sH })).statusCode).toBe(200);
    }
    const staffMe = (await app.inject({ method: 'GET', url: '/v1/me', headers: sH })).json<MeResponse>();
    expect(staffMe.memberships.map((m) => m.businessId).sort()).toEqual([s1.id, s2.id].sort());
    expect(staffMe.memberships.every((m) => m.role === 'staff' && m.active)).toBe(true);

    // Staff can create their own store and be owner there, while staying staff elsewhere.
    const own = await createStore(sH, 'Staff Side Shop');
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${own.id}/team`, headers: sH })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${s1.id}/team`, headers: sH })).statusCode).toBe(403);
  });

  it('limits how many stores one person can own', async () => {
    const owner = await login('9400000003');
    const h = bearer(owner.accessToken);
    for (let i = 0; i < MAX_OWNED_STORES; i++) await createStore(h, `Store ${i}`);
    const over = await app.inject({ method: 'POST', url: '/v1/businesses', headers: h, payload: { name: 'One too many' } });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe('store_limit');
  });

  it('owner pauses and restores a staff member, per store', async () => {
    const owner = await login('9400000011');
    const oH = bearer(owner.accessToken);
    const a = await createStore(oH, 'Paint A');
    const b = await createStore(oH, 'Paint B');
    for (const s of [a, b]) await app.inject({ method: 'POST', url: `/v1/businesses/${s.id}/invites`, headers: oH, payload: { phone: '9400000012' } });
    const staff = await login('9400000012');
    const sH = bearer(staff.accessToken);
    for (const inv of staff.me.invites) await app.inject({ method: 'POST', url: `/v1/invites/${inv.id}/accept`, headers: sH });

    const paused = await app.inject({ method: 'POST', url: `/v1/businesses/${a.id}/members/${staff.me.user.id}/deactivate`, headers: oH });
    expect(paused.statusCode).toBe(200);
    expect(paused.json<TeamResponse>().members.find((m) => m.role === 'staff')!.active).toBe(false);

    // Refused at once in store A, still fine in store B.
    const refused = await app.inject({ method: 'GET', url: `/v1/businesses/${a.id}`, headers: sH });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('member_inactive');
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${b.id}`, headers: sH })).statusCode).toBe(200);
    const me = (await app.inject({ method: 'GET', url: '/v1/me', headers: sH })).json<MeResponse>();
    expect(me.memberships.find((m) => m.businessId === a.id)!.active).toBe(false);

    // Re-inviting a paused member points the owner to "turn access back on".
    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${a.id}/invites`, headers: oH, payload: { phone: '9400000012' } })).statusCode).toBe(409);

    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${a.id}/members/${staff.me.user.id}/activate`, headers: oH })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${a.id}`, headers: sH })).statusCode).toBe(200);

    // The owner can't be paused, and staff can't pause anyone.
    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${a.id}/members/${owner.me.user.id}/deactivate`, headers: oH })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/v1/businesses/${a.id}/members/${owner.me.user.id}/deactivate`, headers: sH })).statusCode).toBe(403);
  });
});

describe('devices', () => {
  it('a new phone login signs the old phone out; the web stays signed in', async () => {
    const first = await login('9500000001', 'mobile');
    const web = await login('9500000001', 'web');
    const second = await login('9500000001', 'mobile');

    const old = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(first.accessToken) });
    expect(old.statusCode).toBe(401);
    expect(old.json().error).toBe('signed_in_elsewhere');
    const oldRefresh = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(oldRefresh.statusCode).toBe(401);
    expect(oldRefresh.json().error).toBe('signed_in_elsewhere');

    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(web.accessToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(second.accessToken) })).statusCode).toBe(200);
  });

  it('lists my devices and signs one out remotely', async () => {
    const phone = await login('9500000002', 'mobile');
    const web = await login('9500000002', 'web');
    const list = (await app.inject({ method: 'GET', url: '/v1/me/sessions', headers: bearer(phone.accessToken) })).json<SessionDto[]>();
    expect(list.map((s) => s.client).sort()).toEqual(['mobile', 'web']);
    expect(list.find((s) => s.current)!.client).toBe('mobile');

    const webSession = list.find((s) => s.client === 'web')!;
    expect((await app.inject({ method: 'DELETE', url: `/v1/me/sessions/${webSession.id}`, headers: bearer(phone.accessToken) })).statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: '/v1/me', headers: bearer(web.accessToken) });
    expect(gone.statusCode).toBe(401);
    expect(gone.json().error).toBe('signed_out_remotely');

    // Someone else's device can't be signed out.
    const other = await login('9500000003', 'mobile');
    const otherSession = (await app.inject({ method: 'GET', url: '/v1/me/sessions', headers: bearer(other.accessToken) })).json<SessionDto[]>()[0]!;
    expect((await app.inject({ method: 'DELETE', url: `/v1/me/sessions/${otherSession.id}`, headers: bearer(phone.accessToken) })).statusCode).toBe(404);
  });
});
