import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../env';

export interface OtpSender {
  readonly name: string;
  /** phone is E.164 (+91XXXXXXXXXX) */
  sendOtp(phone: string, code: string): Promise<void>;
}

/** Dev / staging: the code is written to the server log instead of being sent. */
export class ConsoleOtpSender implements OtpSender {
  readonly name = 'console';
  constructor(private readonly log: FastifyBaseLogger) {}
  async sendOtp(phone: string, code: string) {
    this.log.warn({ phone }, `[OTP test mode] code for ${phone} is ${code}`);
  }
}

/**
 * MSG91 OTP API (v5). Requires a TRAI DLT-approved OTP template in MSG91.
 * NOTE: verify request format against current MSG91 docs when DLT approval lands —
 * this path has not been exercised against the live API yet.
 */
export class Msg91OtpSender implements OtpSender {
  readonly name = 'msg91';
  constructor(
    private readonly authKey: string,
    private readonly templateId: string,
  ) {}

  async sendOtp(phone: string, code: string) {
    const mobile = phone.replace(/^\+/, ''); // MSG91 expects country code without "+"
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', this.templateId);
    url.searchParams.set('mobile', mobile);
    url.searchParams.set('otp', code);
    const res = await fetch(url, {
      method: 'POST',
      headers: { authkey: this.authKey, 'content-type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || body.type === 'error') {
      throw new Error(`MSG91 send failed (${res.status}): ${body.message ?? 'unknown error'}`);
    }
  }
}

export function createOtpSender(env: Env, log: FastifyBaseLogger): OtpSender {
  if (env.OTP_PROVIDER === 'msg91') return new Msg91OtpSender(env.MSG91_AUTH_KEY!, env.MSG91_OTP_TEMPLATE_ID!);
  return new ConsoleOtpSender(log);
}
