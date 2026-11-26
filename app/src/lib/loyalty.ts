import { todayISO } from '@invoice/shared';
import { db, type BusinessSettings, type CreditNote, type Invoice, type PaymentEntry } from './db';
import { t } from './i18n';
import { billMoney, newId, PermissionError, putRecord, type Actor } from './repo';

/**
 * Loyalty points and membership levels. A named customer earns points on each saved bill (a
 * return takes them back); points pay for later bills (a payment of mode "points", worth the point
 * value each). Membership levels come from what the customer spent in the last 12 months; a higher
 * level earns more points per rupee. Points are written on the bill when it is saved, so changing
 * the rules later never changes old bills.
 */

export interface LoyaltyTier {
  name: string;
  /** Spent in the last 12 months to reach this level (paise). */
  minYearSpend: number;
  /** Points multiplier (1 = normal, 2 = double). */
  multiplier: number;
}

export interface LoyaltySettings {
  enabled: boolean;
  /** One point for every this much spent (paise). */
  spendPerPoint: number;
  /** What one point is worth when used (paise). */
  pointValue: number;
  /** Fewest points that can be used at once. */
  minRedeem: number;
  tiers: LoyaltyTier[];
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  spendPerPoint: 10000,
  pointValue: 100,
  minRedeem: 50,
  tiers: [
    { name: 'Silver', minYearSpend: 0, multiplier: 1 },
    { name: 'Gold', minYearSpend: 2500000, multiplier: 1.5 },
    { name: 'Platinum', minYearSpend: 10000000, multiplier: 2 },
  ],
};

export const loyaltyOf = (s: Pick<BusinessSettings, 'loyalty'>): LoyaltySettings => ({ ...DEFAULT_LOYALTY, ...(s.loyalty ?? {}) });

const yearBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  d.setFullYear(d.getFullYear() - 1);
  return todayISO(d);
};

/** What the customer spent on saved bills in the 12 months before `date` (not counting that day). */
export async function yearSpend(businessId: string, customerId: string, date = todayISO()): Promise<number> {
  const from = yearBefore(date);
  const bills = await db.invoices.where('billTo.customerId').equals(customerId).filter((i) => i.businessId === businessId && i.status === 'saved' && !i.deleted && i.date >= from && i.date < date).toArray();
  return bills.reduce((a, b) => a + b.totals.grandTotal, 0);
}

export function tierFor(spend: number, l: LoyaltySettings): LoyaltyTier | null {
  const tiers = [...(l.tiers ?? [])].filter((x) => x.name.trim()).sort((a, b) => b.minYearSpend - a.minYearSpend);
  return tiers.find((x) => spend >= x.minYearSpend) ?? null;
}

/** Points a bill of `total` earns (rounded down). */
export const pointsFor = (total: number, l: LoyaltySettings, multiplier = 1) => (l.spendPerPoint > 0 ? Math.floor(Math.floor(total / l.spendPerPoint) * multiplier) : 0);

/** Called when a bill is saved: the points it earns (0 for walk-ins or when loyalty is off). */
export async function pointsOnSave(businessId: string, settings: BusinessSettings, doc: Pick<Invoice, 'billTo' | 'date'> & { totals: { grandTotal: number } }): Promise<number> {
  const l = loyaltyOf(settings);
  const customerId = doc.billTo?.customerId;
  if (!l.enabled || !customerId) return 0;
  const tier = tierFor(await yearSpend(businessId, customerId, doc.date), l);
  return pointsFor(doc.totals.grandTotal, l, tier?.multiplier ?? 1);
}

/** Points a return takes back (the same rate as earning, base level). */
export function pointsOnReturn(settings: BusinessSettings, note: Pick<CreditNote, 'billTo'> & { totals: { grandTotal: number } }): number {
  const l = loyaltyOf(settings);
  if (!l.enabled || !note.billTo?.customerId) return 0;
  return -pointsFor(note.totals.grandTotal, l);
}

export interface PointsRow {
  date: string;
  label: string;
  points: number;
  href?: string;
}

/** The customer's points: every bill, return and use, and what is left. */
export async function pointsOf(businessId: string, customerId: string): Promise<{ balance: number; rows: PointsRow[] }> {
  const [bills, notes, pays] = await Promise.all([
    db.invoices.where('billTo.customerId').equals(customerId).filter((i) => i.businessId === businessId && i.status === 'saved' && !i.deleted && !!i.pointsEarned).toArray(),
    db.creditNotes.where('billTo.customerId').equals(customerId).filter((n) => n.businessId === businessId && n.status === 'saved' && !n.deleted && !!n.pointsEarned).toArray(),
    db.payments.where('businessId').equals(businessId).filter((p) => p.mode === 'points' && p.customerId === customerId && !p.voidedAt && !p.deleted).toArray(),
  ]);
  const rows: PointsRow[] = [
    ...bills.map((b) => ({ date: b.date, label: t('Bill {number}', { number: b.number }), points: b.pointsEarned!, href: `/tabs/invoices/${b.id}` })),
    ...notes.map((n) => ({ date: n.date, label: t('Return {number}', { number: n.number }), points: n.pointsEarned!, href: `/tabs/credit-notes/${n.id}` })),
    ...pays.map((p) => ({ date: p.date, label: p.kind === 'refund' ? t('Points given back') : t('Points used'), points: (p.kind === 'refund' ? 1 : -1) * (p.points ?? 0), href: p.invoiceId ? `/tabs/invoices/${p.invoiceId}` : undefined })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { balance: rows.reduce((a, r) => a + r.points, 0), rows };
}

/** Pays a saved bill with points (as many as asked, at most the balance and what is pending). */
export async function redeemPoints(actor: Actor, invoice: Invoice, points: number, settings: BusinessSettings): Promise<PaymentEntry | null> {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
  const l = loyaltyOf(settings);
  const customerId = invoice.billTo?.customerId;
  if (!l.enabled || !customerId || invoice.status !== 'saved') return null;
  const { balance } = await pointsOf(actor.businessId, customerId);
  if (points < l.minRedeem) throw new Error(t('At least {n} points can be used at a time', { n: l.minRedeem }));
  const pending = (await billMoney(invoice.id)).pending;
  const use = Math.min(points, balance, Math.floor(pending / l.pointValue));
  if (use <= 0) return null;
  return putRecord('payments', actor, {
    id: newId(),
    invoiceId: invoice.id,
    customerId,
    kind: 'payment',
    mode: 'points',
    amount: use * l.pointValue,
    points: use,
    date: todayISO(),
    note: t('{n} loyalty points', { n: use }),
    receivedBy: actor.userId,
    receivedByName: actor.userName,
  } as PaymentEntry);
}
