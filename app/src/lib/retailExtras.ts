import { addDaysISO, todayISO } from '@invoice/shared';
import { db, type Customer, type Invoice, type Rental, type Scheme, type Voucher } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { receiveKhataPayment } from './khata';
import { newId, newInvoiceDraft, PermissionError, putRecord, saveInvoice, type Actor } from './repo';
import { stockLevels } from './stock';

/** R11 for most shops: supplier schemes, gift vouchers, rentals, festival reorder, area → quantity. */

const canChange = (actor: Actor) => {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
};

/* ---------- supplier schemes ---------- */

export interface SchemeProgress {
  scheme: Scheme;
  done: number;
  pct: number;
  reached: boolean;
  daysLeft: number;
}

/** How far each scheme has got, from the purchase bills of its supplier in its dates. */
export async function schemeProgress(businessId: string, today = todayISO()): Promise<SchemeProgress[]> {
  const [schemes, purchases] = await Promise.all([
    db.schemes.where('businessId').equals(businessId).filter((s) => !s.deleted).toArray(),
    db.purchases.where('businessId').equals(businessId).filter((p) => p.status === 'saved' && !p.deleted).toArray(),
  ]);
  return schemes
    .map((s) => {
      let done = 0;
      for (const p of purchases) {
        if (p.supplier?.supplierId !== s.supplierId || p.date < s.from || p.date > s.to) continue;
        const sign = p.kind === 'return' ? -1 : 1;
        if (s.basis === 'value') done += sign * p.lines.reduce((a, _l, i) => a + (p.totals.lines[i]?.taxable ?? 0), 0);
        else for (const l of p.lines) if (!s.itemIds?.length || (l.itemId && s.itemIds.includes(l.itemId))) done += sign * l.qty * (l.unitFactor ?? 1);
      }
      const daysLeft = Math.round((new Date(`${s.to}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
      return { scheme: s, done, pct: s.target > 0 ? Math.min(100, Math.round((done / s.target) * 100)) : 0, reached: done >= s.target, daysLeft };
    })
    .sort((a, b) => Number(a.scheme.received) - Number(b.scheme.received) || a.scheme.to.localeCompare(b.scheme.to));
}

/* ---------- gift vouchers ---------- */

export const voucherCode = () => `GV${Math.floor(100000 + Math.random() * 900000)}`;

export async function sellVoucher(actor: Actor, v: Pick<Voucher, 'amount' | 'mode' | 'soldTo' | 'validTill'>): Promise<Voucher> {
  canChange(actor);
  if (!(v.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return putRecord('vouchers', actor, { id: newId(), code: voucherCode(), date: todayISO(), ...v } as Voucher);
}

/** What is left on a voucher (paid with as mode "voucher", reference = its code). */
export async function voucherLeft(businessId: string, code: string): Promise<{ voucher: Voucher; left: number } | null> {
  const voucher = (await db.vouchers.where('code').equals(code.trim().toUpperCase()).toArray()).find((v) => v.businessId === businessId && !v.deleted && !v.voidedAt);
  if (!voucher) return null;
  const used = (await db.payments.where('businessId').equals(businessId).filter((p) => p.mode === 'voucher' && p.reference === voucher.code && !p.voidedAt && !p.deleted).toArray()).reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);
  return { voucher, left: voucher.amount - used };
}

/** Pays a saved bill from a voucher (at most what is left, what is pending, and before it expires). */
export async function payWithVoucher(actor: Actor, inv: Invoice, code: string, pending: number, today = todayISO()) {
  const v = await voucherLeft(actor.businessId, code);
  if (!v) throw new Error(t('No gift voucher with this code'));
  if (v.voucher.validTill && v.voucher.validTill < today) throw new Error(t('This voucher expired on {date}', { date: v.voucher.validTill.split('-').reverse().join('/') }));
  const amount = Math.min(v.left, pending);
  if (amount <= 0) throw new Error(t('Nothing is left on this voucher'));
  const { recordPayments } = await import('./repo');
  return recordPayments(actor, inv.id, [{ mode: 'voucher', amount, reference: v.voucher.code, note: t('Gift voucher {code}', { code: v.voucher.code }) }]);
}

/* ---------- rentals ---------- */

export async function nextRentalNumber(businessId: string): Promise<string> {
  const n = await db.rentals.where('businessId').equals(businessId).count();
  return `RN-${String(n + 1).padStart(4, '0')}`;
}

/** Rents goods out; the deposit is taken on the customer's account (used on the rent bill later). */
export async function startRental(actor: Actor, customer: Customer, r: Pick<Rental, 'lines' | 'dueBack' | 'deposit' | 'depositMode' | 'note'>, date = todayISO()): Promise<Rental> {
  canChange(actor);
  if (!r.lines.some((l) => l.qty > 0)) throw new Error(t('Add what is rented'));
  const rental = await putRecord('rentals', actor, { id: newId(), number: await nextRentalNumber(actor.businessId), customerId: customer.id, customerName: customer.name, phone: customer.phone, date, status: 'out', ...r } as Rental);
  if (r.deposit > 0) await receiveKhataPayment(actor, customer, { amount: r.deposit, mode: r.depositMode, date, note: t('Deposit for rental {number}', { number: rental.number }) });
  return rental;
}

export const rentalDays = (r: Pick<Rental, 'date'>, backOn: string) => Math.max(1, Math.round((new Date(`${backOn}T00:00:00`).getTime() - new Date(`${r.date}T00:00:00`).getTime()) / 86_400_000));

/** Goods came back: a draft bill for the rent (days × rate × qty) plus late and damage charges. */
export async function returnRental(actor: Actor, r: Rental, extra: { late?: number; damage?: number }, backOn = todayISO()): Promise<Invoice> {
  canChange(actor);
  const days = rentalDays(r, backOn);
  const draft = await newInvoiceDraft(actor);
  const lines = [
    ...r.lines.filter((l) => l.qty > 0).map((l) => ({ id: newId(), itemId: null, name: t('Rent: {item} × {days} days', { item: l.name, days }), qty: l.qty, unit: 'pcs', rate: l.ratePerDay * days, rateIncludesTax: true, taxPct: 0 })),
    ...(extra.late ? [{ id: newId(), name: t('Late return'), qty: 1, unit: 'pcs', rate: extra.late, rateIncludesTax: true, taxPct: 0 }] : []),
    ...(extra.damage ? [{ id: newId(), name: t('Damage'), qty: 1, unit: 'pcs', rate: extra.damage, rateIncludesTax: true, taxPct: 0 }] : []),
  ];
  const c = r.customerId ? await db.customers.get(r.customerId) : undefined;
  const inv = await saveInvoice(actor, { ...draft, reference: t('Rental {number}', { number: r.number }), billTo: c ? { customerId: c.id, name: c.name, phone: c.phone, address: c.billingAddress } : { customerId: null, name: r.customerName, address: {} }, lines }, { finalize: false });
  await putRecord('rentals', actor, { ...r, status: 'returned', returnedAt: backOn, lateCharge: extra.late, damageCharge: extra.damage, invoiceId: inv.id });
  return inv;
}

export const overdueRentals = (list: Rental[], today = todayISO()) => list.filter((r) => r.status === 'out' && r.dueBack < today);

/* ---------- festival reorder ---------- */

/** What sold in the same weeks last year, against stock now: what to order before the season. */
export async function festivalTable(businessId: string, from = todayISO(), days = 30): Promise<ExportTable> {
  const lyFrom = addDaysISO(from, -365);
  const lyTo = addDaysISO(lyFrom, days);
  const [bills, items, levels] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && i.date >= lyFrom && i.date <= lyTo).toArray(),
    db.items.where('businessId').equals(businessId).filter((i) => !i.deleted).toArray(),
    stockLevels(businessId),
  ]);
  const sold = new Map<string, number>();
  for (const b of bills) for (const l of b.lines) if (l.itemId) sold.set(l.itemId, (sold.get(l.itemId) ?? 0) + l.qty * (l.unitFactor ?? 1));
  const rows = items
    .filter((i) => (sold.get(i.id) ?? 0) > 0)
    .map((i) => {
      const s = Math.round((sold.get(i.id) ?? 0) * 1000) / 1000;
      const have = levels.get(i.id) ?? 0;
      return [i.name, s, Math.round(have * 1000) / 1000, Math.max(0, Math.ceil(s - have)), i.unit];
    })
    .sort((a, b) => (b[3] as number) - (a[3] as number));
  return {
    title: t('Festival reorder'),
    subtitle: [t('Sold {from} – {to} last year, against stock today', { from: lyFrom.split('-').reverse().join('/'), to: lyTo.split('-').reverse().join('/') })],
    columns: [{ label: t('Item') }, { label: t('Sold last year'), kind: 'qty' }, { label: t('In stock'), kind: 'qty' }, { label: t('Order'), kind: 'qty' }, { label: t('Unit') }],
    rows,
    fileBase: `Festival-reorder-${from}`,
  };
}

/* ---------- tiles and paint ---------- */

/** Units needed to cover an area (tiles: sq ft per box; paint: sq ft per litre per coat), with 5% extra for tiles. */
export function unitsForArea(area: number, coverage: number, coats = 1, wastagePct = 0): number {
  if (!(area > 0) || !(coverage > 0)) return 0;
  return Math.ceil(((area * Math.max(1, coats)) / coverage) * (1 + wastagePct / 100) * 100) / 100;
}
