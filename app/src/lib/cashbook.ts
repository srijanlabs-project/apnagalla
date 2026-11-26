import { db, type DayClose } from './db';
import { t } from './i18n';
import { moneyEvents } from './money';
import { expenseLabel } from './purchases';
import { putRecord, type Actor } from './repo';

/**
 * The cash drawer, day by day: opening cash (the last day-end count, or the running total when a
 * day wasn't closed) + cash received − cash paid out = cash that should be in the drawer.
 * UPI, card and bank money doesn't touch the drawer and is shown separately.
 */

export interface CashLine {
  label: string;
  amount: number;
  href?: string;
  at: string;
}

export interface CashDay {
  date: string;
  opening: number;
  cashIn: CashLine[];
  cashOut: CashLine[];
  /** opening + in − out. */
  expected: number;
  close?: DayClose;
  /** Money that didn't go through the drawer (UPI, card, bank, cheque…), by mode. */
  otherModes: Record<string, number>;
}

interface Event {
  date: string;
  amount: number;
  line: CashLine;
}

async function cashEvents(businessId: string) {
  const [pays, invoices, sPays, expenses, closes] = await Promise.all([
    db.payments.where('businessId').equals(businessId).filter((p) => !p.deleted && !p.voidedAt).toArray(),
    db.invoices.where('businessId').equals(businessId).toArray(),
    db.supplierPayments.where('businessId').equals(businessId).filter((p) => !p.deleted && !p.voidedAt).toArray(),
    db.expenses.where('businessId').equals(businessId).filter((e) => !e.deleted).toArray(),
    db.dayCloses.where('businessId').equals(businessId).filter((d) => !d.deleted).toArray(),
  ]);
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));
  const nameOf = new Map((await db.customers.where('businessId').equals(businessId).toArray()).map((c) => [c.id, c.name]));
  const supplierName = new Map((await db.suppliers.where('businessId').equals(businessId).toArray()).map((s) => [s.id, s.name]));
  const cash: Event[] = [];
  const other: { date: string; mode: string; amount: number }[] = [];
  for (const p of pays) {
    if (p.mode === 'advance' || p.mode === 'creditnote') continue;
    const signed = p.kind === 'refund' ? -p.amount : p.amount;
    if (p.mode !== 'cash') {
      other.push({ date: p.date, mode: p.mode, amount: signed });
      continue;
    }
    const who = p.invoiceId ? (numberOf.get(p.invoiceId) ?? '') : (nameOf.get(p.customerId ?? '') ?? '');
    const label = p.kind === 'refund' ? t('Refund {ref}', { ref: who }) : p.invoiceId ? t('Received · {ref}', { ref: who }) : t('Khata payment · {name}', { name: who });
    cash.push({ date: p.date, amount: signed, line: { label, amount: Math.abs(p.amount), href: p.invoiceId ? `/tabs/invoices/${p.invoiceId}` : p.customerId ? `/tabs/customers/${p.customerId}` : undefined, at: p.createdAt } });
  }
  for (const p of sPays) {
    if (p.mode !== 'cash') continue;
    const signed = p.kind === 'refund' ? p.amount : -p.amount;
    cash.push({ date: p.date, amount: signed, line: { label: p.kind === 'refund' ? t('Refund from {name}', { name: supplierName.get(p.supplierId) ?? '' }) : t('Paid {name}', { name: supplierName.get(p.supplierId) ?? '' }), amount: p.amount, href: `/tabs/suppliers/${p.supplierId}`, at: p.createdAt } });
  }
  for (const e of expenses) {
    if (e.mode !== 'cash') continue;
    cash.push({ date: e.date, amount: -e.amount, line: { label: expenseLabel(e.category) + (e.paidTo ? ` · ${e.paidTo}` : '') + (e.note ? ` · ${e.note}` : ''), amount: e.amount, href: '/tabs/expenses', at: e.createdAt } });
  }
  // R6: other income, loans and cash ↔ bank moves (the same events the bank book uses).
  for (const e of await moneyEvents(businessId)) {
    if (e.place !== 'cash' || (e.kind !== 'income' && e.kind !== 'loanIn' && e.kind !== 'loanOut' && e.kind !== 'interest' && e.kind !== 'move')) continue;
    cash.push({ date: e.date, amount: e.amount, line: { label: e.label, amount: Math.abs(e.amount), href: e.href, at: e.at } });
  }
  return { cash, other, closes: new Map(closes.map((c) => [c.date, c])) };
}

export async function cashDay(businessId: string, date: string): Promise<CashDay> {
  const { cash, other, closes } = await cashEvents(businessId);
  // Walk the days before this one: each day ends at its count if it was closed.
  const days = [...new Set([...cash.map((e) => e.date), ...closes.keys()])].filter((d) => d < date).sort();
  let running = 0;
  for (const d of days) {
    running += cash.filter((e) => e.date === d).reduce((a, e) => a + e.amount, 0);
    const c = closes.get(d);
    if (c) running = c.counted;
  }
  const today = cash.filter((e) => e.date === date);
  const cashIn = today.filter((e) => e.amount > 0).map((e) => e.line);
  const cashOut = today.filter((e) => e.amount < 0).map((e) => e.line);
  const sort = (a: CashLine, b: CashLine) => a.at.localeCompare(b.at);
  const otherModes: Record<string, number> = {};
  for (const o of other.filter((o) => o.date === date)) otherModes[o.mode] = (otherModes[o.mode] ?? 0) + o.amount;
  return {
    date,
    opening: running,
    cashIn: cashIn.sort(sort),
    cashOut: cashOut.sort(sort),
    expected: running + today.reduce((a, e) => a + e.amount, 0),
    close: closes.get(date),
    otherModes,
  };
}

export async function closeDay(actor: Actor, day: CashDay, counted: number, note?: string): Promise<DayClose> {
  const id = `${actor.businessId}:${day.date}`;
  const existing = await db.dayCloses.get(id);
  return putRecord('dayCloses', actor, {
    ...(existing ?? {}),
    id,
    date: day.date,
    expected: day.expected,
    counted,
    difference: counted - day.expected,
    note: note?.trim() || undefined,
    closedByName: actor.userName,
  } as DayClose);
}
