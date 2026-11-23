import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import type { DB } from '../db/client';
import { otpRequests } from '../db/schema';
import { badRequest, tooMany } from '../errors';
import type { OtpSender } from '../sms';
import { generateOtp, hashOtp, safeEqualHex } from './crypto';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_RESEND_COOLDOWN_MS = 30_000;
export const OTP_MAX_PER_PHONE_PER_HOUR = 5;
export const OTP_MAX_PER_IP_PER_HOUR = 30;
export const OTP_MAX_ATTEMPTS = 5;

export class OtpService {
  constructor(
    private readonly db: DB,
    private readonly sender: OtpSender,
    private readonly secret: string,
    private readonly fixedCode?: string,
  ) {}

  async request(phone: string, ip: string | null): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
    const now = Date.now();
    const hourAgo = new Date(now - 3_600_000);

    const [last] = await this.db
      .select({ createdAt: otpRequests.createdAt })
      .from(otpRequests)
      .where(eq(otpRequests.phone, phone))
      .orderBy(desc(otpRequests.createdAt))
      .limit(1);
    if (last) {
      const wait = OTP_RESEND_COOLDOWN_MS - (now - last.createdAt.getTime());
      if (wait > 0) {
        const s = Math.ceil(wait / 1000);
        throw tooMany(`Please wait ${s}s before requesting another code`, s);
      }
    }

    const [perPhone] = await this.db
      .select({ n: count() })
      .from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), gt(otpRequests.createdAt, hourAgo)));
    if ((perPhone?.n ?? 0) >= OTP_MAX_PER_PHONE_PER_HOUR) {
      throw tooMany('Too many codes requested for this number. Try again in an hour.', 3600);
    }

    if (ip) {
      const [perIp] = await this.db
        .select({ n: count() })
        .from(otpRequests)
        .where(and(eq(otpRequests.ip, ip), gt(otpRequests.createdAt, hourAgo)));
      if ((perIp?.n ?? 0) >= OTP_MAX_PER_IP_PER_HOUR) {
        throw tooMany('Too many requests. Try again later.', 3600);
      }
    }

    const code = this.fixedCode ?? generateOtp();
    await this.db.insert(otpRequests).values({
      phone,
      ip,
      codeHash: hashOtp(this.secret, phone, code),
      expiresAt: new Date(now + OTP_TTL_MS),
    });
    await this.sender.sendOtp(phone, code);

    return { resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  /** Throws on failure; on success the code is consumed and cannot be reused. */
  async verify(phone: string, code: string): Promise<void> {
    const now = new Date();
    const [req] = await this.db
      .select()
      .from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), isNull(otpRequests.consumedAt), gt(otpRequests.expiresAt, now)))
      .orderBy(desc(otpRequests.createdAt))
      .limit(1);

    if (!req) throw badRequest('otp_expired', 'Code expired. Request a new one.');
    if (req.attempts >= OTP_MAX_ATTEMPTS) throw badRequest('otp_locked', 'Too many wrong attempts. Request a new code.');

    if (!safeEqualHex(req.codeHash, hashOtp(this.secret, phone, code))) {
      await this.db
        .update(otpRequests)
        .set({ attempts: req.attempts + 1 })
        .where(eq(otpRequests.id, req.id));
      const left = OTP_MAX_ATTEMPTS - req.attempts - 1;
      throw badRequest('otp_invalid', left > 0 ? `Wrong code. ${left} attempt(s) left.` : 'Too many wrong attempts. Request a new code.');
    }

    // Conditional update so two parallel verifies can't both succeed.
    const consumed = await this.db
      .update(otpRequests)
      .set({ consumedAt: now })
      .where(and(eq(otpRequests.id, req.id), isNull(otpRequests.consumedAt)))
      .returning({ id: otpRequests.id });
    if (consumed.length === 0) throw badRequest('otp_expired', 'Code already used. Request a new one.');
  }
}
