import { createHmac, timingSafeEqual } from 'node:crypto';
import { financialYearLabel, type BillingStatusDto, type PlanDto, type PlanLimits, type PlatformInvoiceDto } from '@invoice/shared';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { businesses, coupons, memberships, plans, platformPayments, subscriptions } from '../db/schema';
import { badRequest } from '../errors';
import { audit } from '../services/audit';

/**
 * ApnaGalla charging stores: plans (set by the client in the admin panel), a free trial, codes
 * (coupon, another store's referral code, a partner's code), payment by Razorpay payment link,
 * and a GST invoice for each payment. Limits apply only when PLANS_ENFORCED is on.
 */

export interface BillingEnv {
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  PLANS_ENFORCED: boolean;
  TRIAL_DAYS: number;
  GRACE_DAYS: number;
  REFERRAL_DISCOUNT_PCT: number;
  APNAGALLA_LEGAL_NAME: string;
  APNAGALLA_GSTIN?: string;
  APNAGALLA_ADDRESS: string;
  PLAN_SAC: string;
  PUBLIC_URL: string;
}

const DAY = 86_400_000;
const GST_PCT = 18;

/** Placeholder plans until the client sets theirs in the admin panel. */
const SEED: (PlanDto & { sort: number })[] = [
  { id: 'free', name: 'Free', priceMonthly: 0, priceYearly: 0, limits: { stores: 1, staff: 1, billsPerMonth: 300, scansPerDay: 5 }, active: true, sort: 0 },
  { id: 'basic', name: 'Basic', priceMonthly: 29900, priceYearly: 299900, limits: { stores: 1, staff: 3, scansPerDay: 30 }, active: true, sort: 1 },
  { id: 'pro', name: 'Pro', priceMonthly: 59900, priceYearly: 599900, limits: { stores: 3, staff: 10, scansPerDay: 100 }, active: true, sort: 2 },
];

/** A store's own referral code: other stores enter it to get a discount. */
export const referralCodeOf = (businessId: string) => `AG${businessId.replace(/-/g, '').slice(0, 6).toUpperCase()}`;

export class BillingService {
  constructor(
    private readonly db: DB,
    private readonly env: BillingEnv,
  ) {}

  async seedPlans(): Promise<void> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(plans);
    if (Number(row?.n ?? 0) === 0) await this.db.insert(plans).values(SEED.map((p) => ({ ...p, limits: p.limits as Record<string, unknown> }))).onConflictDoNothing();
  }

  async listPlans(all = false): Promise<PlanDto[]> {
    const rows = await this.db.select().from(plans).orderBy(asc(plans.sort));
    return rows.filter((p) => all || p.active).map((p) => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, limits: p.limits as PlanLimits, active: p.active }));
  }

  async upsertPlan(p: PlanDto & { sort?: number }): Promise<void> {
    await this.db
      .insert(plans)
      .values({ ...p, limits: p.limits as Record<string, unknown>, sort: p.sort ?? 0 })
      .onConflictDoUpdate({ target: plans.id, set: { name: p.name, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, limits: p.limits as Record<string, unknown>, active: p.active } });
  }

  /** The store's subscription row (made on first look: a trial of the top plan). */
  private async sub(businessId: string) {
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1);
    if (row) return row;
    const [biz] = await this.db.select({ createdAt: businesses.createdAt }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    const top = (await this.listPlans()).filter((p) => p.priceMonthly > 0).pop();
    const start = biz?.createdAt ?? new Date();
    const [made] = await this.db
      .insert(subscriptions)
      .values({ businessId, planId: top?.id ?? 'free', trialEnd: new Date(start.getTime() + this.env.TRIAL_DAYS * DAY) })
      .onConflictDoNothing()
      .returning();
    return made ?? (await this.db.select().from(subscriptions).where(eq(subscriptions.businessId, businessId)).limit(1))[0]!;
  }

  async status(businessId: string, now = new Date()): Promise<BillingStatusDto> {
    const s = await this.sub(businessId);
    const all = await this.listPlans(true);
    const plan = all.find((p) => p.id === s.planId) ?? all[0]!;
    const free = all.find((p) => p.priceMonthly === 0);
    let state: BillingStatusDto['state'];
    let until: Date | null = null;
    if (s.periodEnd && s.periodEnd > now) {
      state = 'active';
      until = s.periodEnd;
    } else if (s.trialEnd && s.trialEnd > now && !s.periodEnd) {
      state = 'trial';
      until = s.trialEnd;
    } else {
      const ended = s.periodEnd ?? s.trialEnd ?? now;
      const graceEnd = new Date(ended.getTime() + this.env.GRACE_DAYS * DAY);
      if (plan.priceMonthly > 0 && graceEnd > now) {
        state = 'grace';
        until = graceEnd;
      } else state = plan.priceMonthly > 0 ? 'expired' : 'free';
    }
    // After the trial / grace, the store is on the free plan's limits.
    const effective = state === 'expired' && free ? free : plan;
    return {
      planId: plan.id,
      planName: plan.name,
      state,
      until: until?.toISOString() ?? null,
      daysLeft: until ? Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY)) : null,
      limits: effective.limits,
      enforced: this.env.PLANS_ENFORCED,
      referralCode: referralCodeOf(businessId),
      canPay: !!(this.env.RAZORPAY_KEY_ID && this.env.RAZORPAY_KEY_SECRET),
    };
  }

  /** Price for a plan and period after a code; codes are checked, never trusted from the phone. */
  async quote(businessId: string, planId: string, period: 'month' | 'year', code?: string | null): Promise<{ amount: number; gst: number; total: number; code: string | null; extraDays: number; note: string | null }> {
    const plan = (await this.listPlans()).find((p) => p.id === planId);
    if (!plan || plan.priceMonthly <= 0) throw badRequest('plan', 'Pick a paid plan');
    let amount = period === 'year' ? plan.priceYearly || plan.priceMonthly * 12 : plan.priceMonthly;
    let extraDays = 0;
    let used: string | null = null;
    let note: string | null = null;
    const c = code?.trim().toUpperCase();
    if (c) {
      const [coupon] = await this.db.select().from(coupons).where(eq(coupons.code, c)).limit(1);
      if (coupon) {
        if ((coupon.validTo && coupon.validTo < new Date()) || (coupon.maxUses != null && coupon.used >= coupon.maxUses)) throw badRequest('code', 'This code has ended');
        if (coupon.kind === 'pct') amount = Math.round(amount * (1 - Math.min(coupon.value, 100) / 100));
        else if (coupon.kind === 'amount') amount = Math.max(0, amount - coupon.value);
        else extraDays = coupon.value;
        used = c;
        note = coupon.kind === 'days' ? `${coupon.value} extra days` : `Code ${c}`;
      } else if (/^AG[0-9A-F]{6}$/.test(c) && c !== referralCodeOf(businessId)) {
        const referrer = await this.db
          .select({ id: businesses.id })
          .from(businesses)
          .where(sql`upper(replace(${businesses.id}::text, '-', '')) like ${`${c.slice(2)}%`}`)
          .limit(1);
        if (!referrer.length) throw badRequest('code', 'This code is not valid');
        amount = Math.round(amount * (1 - this.env.REFERRAL_DISCOUNT_PCT / 100));
        used = c;
        note = `Referral ${c}`;
      } else throw badRequest('code', 'This code is not valid');
    }
    const gst = Math.round((amount * GST_PCT) / 100);
    return { amount, gst, total: amount + gst, code: used, extraDays, note };
  }

  /** A Razorpay payment link for the plan; the webhook extends the plan when it is paid. */
  async createPaymentLink(businessId: string, userId: string, planId: string, period: 'month' | 'year', code?: string | null): Promise<{ url: string }> {
    if (!this.env.RAZORPAY_KEY_ID || !this.env.RAZORPAY_KEY_SECRET) throw badRequest('billing_off', 'Online payment is not set up yet. Please contact ApnaGalla.');
    const q = await this.quote(businessId, planId, period, code);
    const [biz] = await this.db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    const [payment] = await this.db.insert(platformPayments).values({ businessId, planId, period, amount: q.amount, gst: q.gst, total: q.total, code: q.code }).returning({ id: platformPayments.id });
    const r = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${this.env.RAZORPAY_KEY_ID}:${this.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: q.total,
        currency: 'INR',
        description: `ApnaGalla ${planId} (${period}) — ${biz?.name ?? ''}`.slice(0, 2048),
        reference_id: payment!.id,
        notes: { businessId, paymentId: payment!.id, planId, period, userId },
        reminder_enable: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw badRequest('billing', `Payment link could not be made (${r.status})`);
    const link = (await r.json()) as { id: string; short_url: string };
    await this.db.update(platformPayments).set({ linkId: link.id, linkUrl: link.short_url }).where(eq(platformPayments.id, payment!.id));
    return { url: link.short_url };
  }

  /** Razorpay calls this when a link is paid (signed with the webhook secret). */
  async webhook(rawBody: string, signature: string | undefined): Promise<'ok' | 'ignored'> {
    const secret = this.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) throw badRequest('signature', 'Not signed');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw badRequest('signature', 'Bad signature');
    const event = JSON.parse(rawBody) as { event?: string; payload?: { payment_link?: { entity?: { id?: string } } } };
    if (event.event !== 'payment_link.paid') return 'ignored';
    const linkId = event.payload?.payment_link?.entity?.id;
    if (!linkId) return 'ignored';
    await this.markPaid(linkId);
    return 'ok';
  }

  /** Marks a payment paid (once), extends the plan and gives it an invoice number. */
  async markPaid(linkId: string, now = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(platformPayments).where(eq(platformPayments.linkId, linkId)).for('update').limit(1);
      if (!p || p.status === 'paid') return;
      const fy = financialYearLabel(new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10));
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(platformPayments).where(and(isNotNull(platformPayments.invoiceNo), sql`${platformPayments.invoiceNo} like ${`AG/${fy}/%`}`));
      const invoiceNo = `AG/${fy}/${String(Number(count?.n ?? 0) + 1).padStart(5, '0')}`;
      await tx.update(platformPayments).set({ status: 'paid', paidAt: now, invoiceNo }).where(eq(platformPayments.id, p.id));
      const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.businessId, p.businessId)).limit(1);
      const from = s?.periodEnd && s.periodEnd > now ? s.periodEnd : now;
      let extra = 0;
      if (p.code) {
        const [c] = await tx.select().from(coupons).where(eq(coupons.code, p.code)).limit(1);
        if (c) {
          await tx.update(coupons).set({ used: c.used + 1 }).where(eq(coupons.code, c.code));
          if (c.kind === 'days') extra = c.value;
        }
      }
      const end = new Date(from);
      if (p.period === 'year') end.setFullYear(end.getFullYear() + 1);
      else end.setMonth(end.getMonth() + 1);
      end.setTime(end.getTime() + extra * DAY);
      const [partner] = p.code ? await tx.select({ partner: coupons.partner }).from(coupons).where(eq(coupons.code, p.code)).limit(1) : [];
      await tx
        .insert(subscriptions)
        .values({ businessId: p.businessId, planId: p.planId, periodEnd: end, referredBy: p.code, partnerCode: partner?.partner ?? null })
        .onConflictDoUpdate({ target: subscriptions.businessId, set: { planId: p.planId, periodEnd: end, updatedAt: now, ...(partner?.partner ? { partnerCode: partner.partner } : {}) } });
      await audit(tx as unknown as DB, { businessId: p.businessId, actorUserId: null, action: 'billing.paid', detail: { planId: p.planId, period: p.period, total: p.total, invoiceNo } });
    });
  }

  /** The store's paid invoices from ApnaGalla, with what the GST invoice needs. */
  async invoices(businessId: string): Promise<PlatformInvoiceDto[]> {
    const rows = await this.db.select().from(platformPayments).where(and(eq(platformPayments.businessId, businessId), eq(platformPayments.status, 'paid'))).orderBy(desc(platformPayments.paidAt));
    const [biz] = await this.db.select({ name: businesses.name, state: businesses.state, city: businesses.city }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    return rows.map((p) => ({
      id: p.id,
      invoiceNo: p.invoiceNo!,
      date: p.paidAt!.toISOString().slice(0, 10),
      planId: p.planId,
      period: p.period,
      amount: p.amount,
      gst: p.gst,
      gstPct: GST_PCT,
      total: p.total,
      seller: { name: this.env.APNAGALLA_LEGAL_NAME, gstin: this.env.APNAGALLA_GSTIN ?? null, address: this.env.APNAGALLA_ADDRESS, sac: this.env.PLAN_SAC },
      buyer: { name: biz?.name ?? '', place: [biz?.city, biz?.state].filter(Boolean).join(', ') },
    }));
  }

  /* ---------- admin ---------- */

  async createCoupon(c: { code: string; kind: 'pct' | 'amount' | 'days'; value: number; partner?: string | null; maxUses?: number | null; validTo?: string | null }): Promise<void> {
    await this.db.insert(coupons).values({ code: c.code.trim().toUpperCase(), kind: c.kind, value: c.value, partner: c.partner?.trim() || null, maxUses: c.maxUses ?? null, validTo: c.validTo ? new Date(c.validTo) : null });
  }

  async listCoupons() {
    return (await this.db.select().from(coupons).orderBy(desc(coupons.createdAt))).map((c) => ({ ...c, validTo: c.validTo?.toISOString() ?? null, createdAt: c.createdAt.toISOString() }));
  }

  /** Admin: put a store on a plan until a date (e.g. paid by cash or bank transfer). */
  async setPlan(adminId: string, businessId: string, planId: string, days: number): Promise<void> {
    await this.sub(businessId);
    const end = new Date(Date.now() + days * DAY);
    await this.db.update(subscriptions).set({ planId, periodEnd: days > 0 ? end : null, updatedAt: new Date() }).where(eq(subscriptions.businessId, businessId));
    await audit(this.db, { businessId, actorUserId: adminId, action: 'billing.set_by_admin', detail: { planId, days } });
  }

  /* ---------- limits (only when enforced) ---------- */

  async checkStaff(businessId: string): Promise<void> {
    if (!this.env.PLANS_ENFORCED) return;
    const { limits } = await this.status(businessId);
    if (!limits.staff) return;
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.role, 'staff'), sql`${memberships.removedAt} is null`));
    if (Number(row?.n ?? 0) >= limits.staff) throw badRequest('plan_limit', `Your plan allows ${limits.staff} staff. Upgrade the plan to add more.`);
  }

  async scansPerDay(businessId: string, fallback: number): Promise<number> {
    if (!this.env.PLANS_ENFORCED) return fallback;
    return Math.min(fallback, (await this.status(businessId)).limits.scansPerDay ?? fallback);
  }

  /** Plan limit: saved bills the store may still add this month (undefined = no limit). */
  async billsLeft(businessId: string, now = new Date()): Promise<number | undefined> {
    if (!this.env.PLANS_ENFORCED) return undefined;
    const limit = (await this.status(businessId, now)).limits.billsPerMonth;
    if (!limit) return undefined;
    const month = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 7);
    const rows = await this.db.execute<{ n: number }>(
      sql`select count(*)::int as n from sync_records where business_id = ${businessId} and table_name = 'invoices' and deleted = false and data->>'status' = 'saved' and data->>'date' like ${`${month}%`}`,
    );
    return Math.max(0, limit - Number(rows.rows[0]?.n ?? 0));
  }

  /** Expired plan with limits on: saving new work is stopped until it is paid (data stays readable). */
  async writable(businessId: string): Promise<boolean> {
    if (!this.env.PLANS_ENFORCED) return true;
    const s = await this.status(businessId);
    return s.state !== 'expired' || (s.limits.billsPerMonth ?? 1) > 0;
  }
}
