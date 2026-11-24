import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';

const base = { JWT_SECRET: 'a-real-secret-a-real-secret-a-real-secret' };

describe('OTP_FIXED_CODE rules', () => {
  it('is allowed in production while OTP is in console test mode', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'production', OTP_PROVIDER: 'console', ALLOW_CONSOLE_OTP: 'true', OTP_FIXED_CODE: '120345' });
    expect(env.OTP_FIXED_CODE).toBe('120345');
  });

  it('is refused with real SMS (msg91), even outside production', () => {
    const sms = { OTP_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k', MSG91_OTP_TEMPLATE_ID: 't', OTP_FIXED_CODE: '120345' };
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', ...sms })).toThrow(/only allowed with OTP_PROVIDER=console/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', ...sms })).toThrow(/only allowed with OTP_PROVIDER=console/);
  });

  it('must be exactly 6 digits', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', OTP_FIXED_CODE: '12345' })).toThrow();
  });

  it('console OTP in production still needs ALLOW_CONSOLE_OTP', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', OTP_PROVIDER: 'console', OTP_FIXED_CODE: '120345' })).toThrow(/ALLOW_CONSOLE_OTP/);
  });
});

describe('GST lookup settings', () => {
  it('reads the GST_VALIDATION_* names when GST_API_* are not set', () => {
    const env = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40), GST_VALIDATION_API_KEY: 'k1', GST_VALIDATION_API_URL: 'https://example.test/v', GST_VALIDATION_TIMEOUT_MS: '9000' });
    expect([env.GST_API_KEY, env.GST_API_URL, env.GST_API_TIMEOUT_MS]).toEqual(['k1', 'https://example.test/v', 9000]);
    expect(loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40), GST_API_KEY: 'mine', GST_VALIDATION_API_KEY: 'other' }).GST_API_KEY).toBe('mine');
  });
});
