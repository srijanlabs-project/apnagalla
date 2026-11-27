import { and, count, desc, eq, gt, isNull, lt, sql, sum } from 'drizzle-orm';
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
/** Wrong guesses allowed per number per hour, across all its codes. */
export const OTP_MAX_GUESSES_PER_PHONE_PER_HOUR = 10;
/** All the SMS codes the server sends in a day, as a ceiling against SMS-bill abuse. */
export const OTP_DAILY_BUDGET_DEFAULT = 2000;

export class OtpService {
  constructor(
    private readonly db: DB,
    private readonly sender: OtpSender,
    private readonly secret: string,
    private readonly fixedCode?: string,
    private readonly dailyBudget = OTP_DAILY_BUDGET_DEFAULT,
  ) {}

  async request(phone: string, ip: string | null): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }> {
    const now = Date.now();
    const hourAgo = new Date(now - 3_600_000);
    const dayAgo = new Date(now - 86_400_000);
    const code = this.fixedCode ?? generateOtp();

    // One request per number at a time: the checks and the new code are decided together, so parallel
    // requests can't each pass the limits and send several SMS.
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`);
      const [last] = await tx
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
      const [perPhone] = await tx
        .select({ n: count() })
        .from(otpRequests)
        .where(and(eq(otpRequests.phone, phone), gt(otpRequests.createdAt, hourAgo)));
      if ((perPhone?.n ?? 0) >= OTP_MAX_PER_PHONE_PER_HOUR) {
        throw tooMany('Too many codes requested for this number. Try again in an hour.', 3600);
      }
      if (ip) {
        const [perIp] = await tx
          .select({ n: count() })
          .from(otpRequests)
          .where(and(eq(otpRequests.ip, ip), gt(otpRequests.createdAt, hourAgo)));
        if ((perIp?.n ?? 0) >= OTP_MAX_PER_IP_PER_HOUR) {
          throw tooMany('Too many requests. Try again later.', 3600);
        }
      }
      // A ceiling on the whole day's SMS, so a flood of numbers can't run up the SMS bill.
      const [today] = await tx.select({ n: count() }).from(otpRequests).where(gt(otpRequests.createdAt, dayAgo));
      if ((today?.n ?? 0) >= this.dailyBudget) {
        throw tooMany('Sign-in codes are paused for a while. Please try again later.', 3600);
      }
      await tx.insert(otpRequests).values({
        phone,
        ip,
        codeHash: hashOtp(this.secret, phone, code),
        expiresAt: new Date(now + OTP_TTL_MS),
      });
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

    // Wrong guesses across all of this number's codes in the last hour: a ceiling on guessing.
    const [guessed] = await this.db
      .select({ n: sum(otpRequests.attempts) })
      .from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), gt(otpRequests.createdAt, new Date(now.getTime() - 3_600_000))));
    if (Number(guessed?.n ?? 0) >= OTP_MAX_GUESSES_PER_PHONE_PER_HOUR) {
      throw badRequest('otp_locked', 'Too many wrong attempts. Try again in an hour.');
    }

    // Count this try first, in one step, so guesses sent at the same moment can't all slip in as try 1.
    const counted = await this.db
      .update(otpRequests)
      .set({ attempts: sql`${otpRequests.attempts} + 1` })
      .where(and(eq(otpRequests.id, req.id), lt(otpRequests.attempts, OTP_MAX_ATTEMPTS)))
      .returning({ attempts: otpRequests.attempts });
    if (counted.length === 0) throw badRequest('otp_locked', 'Too many wrong attempts. Request a new code.');

    if (!safeEqualHex(req.codeHash, hashOtp(this.secret, phone, code))) {
      const left = OTP_MAX_ATTEMPTS - counted[0]!.attempts;
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
