import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { sessions } from '../src/db/schema';
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
let prod: FastifyInstance;
let database: Database;

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  const base = { JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '' };
  app = await buildApp({ env: loadEnv({ ...base, NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: '20' }), database, otpSender: sender, logger: false });
  prod = await buildApp({ env: loadEnv({ ...base, NODE_ENV: 'production', ALLOW_CONSOLE_OTP: 'true', CORS_ORIGINS: 'https://app.apnagalla.in' }), database, otpSender: sender, logger: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prod?.close();
  await database?.close();
});

describe('hardening', () => {
  it('sends protective headers', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('in production, only the app and the configured web address may call the API from a browser', async () => {
    const from = async (origin: string) => (await prod.inject({ method: 'GET', url: '/health', headers: { origin } })).headers['access-control-allow-origin'];
    expect(await from('https://app.apnagalla.in')).toBe('https://app.apnagalla.in');
    expect(await from('https://localhost')).toBe('https://localhost'); // the Android app
    expect(await from('http://localhost:5173')).toBeUndefined(); // dev server: not in production
    expect(await from('https://evil.example')).toBeUndefined();
  });

  it('limits requests per IP and answers 429 with a readable message', async () => {
    let last = 0;
    let body: unknown = null;
    for (let i = 0; i < 25; i++) {
      const r = await app.inject({ method: 'GET', url: '/v1/me', remoteAddress: '10.77.0.1' });
      last = r.statusCode;
      body = r.json();
    }
    expect(last).toBe(429);
    expect(body).toMatchObject({ error: 'rate_limited' });
    // The health check is never limited (uptime monitors).
    for (let i = 0; i < 25; i++) expect((await app.inject({ method: 'GET', url: '/health', remoteAddress: '10.77.0.2' })).statusCode).toBe(200);
  });

  it('a browser login lasts 7 days without use; a phone login 90', async () => {
    const login = async (phone: string, client: 'web' | 'mobile') => {
      await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: `10.78.0.${client === 'web' ? 1 : 2}` });
      return (await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code: sender.last.get(`+91${phone}`), client }, remoteAddress: '10.78.0.9' })).json<VerifyOtpResponse>();
    };
    const days = async (refreshToken: string) => {
      const r = (await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken }, remoteAddress: '10.78.0.10' })).json<{ refreshToken: string }>();
      const rows = await database.db.select({ e: sessions.expiresAt, c: sessions.client }).from(sessions);
      return { next: r.refreshToken, rows };
    };
    const web = await login('9700000201', 'web');
    const phone = await login('9700000202', 'mobile');
    await days(web.refreshToken);
    const { rows } = await days(phone.refreshToken);
    const left = (c: string) => Math.round((rows.find((r) => r.c === c)!.e.getTime() - Date.now()) / 86_400_000);
    expect(left('web')).toBe(7);
    expect(left('mobile')).toBe(90);
  });
});
