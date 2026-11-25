import { todayISO } from '@invoice/shared';
import { db, type Customer, type Invoice, type PaymentEntry } from './db';
import type { ExportTable } from './exportTable';
import { addressLines } from './format';
import { t } from './i18n';
import { buildLedger, modeLabel, moneyOf } from './ledger';
import { newId, putRecord, type Actor } from './repo';
import type { CashMode } from '../components/MoneyEntrySheet';

/**
 * The khata: what each customer owes and how it got there. Bills add, payments and returns take
 * away. Money taken "on account" (not for one bill) first settles the opening balance; what is
 * left is an advance, used later on a bill with "Use advance".
 */

export interface KhataRow {
  date: string;
  label: string;
  /** + customer owes more, − owes less. */
  amount: number;
  balance: number;
  href?: string;
  entry?: PaymentEntry;
}

export interface Khata {
  rows: KhataRow[];
  /** What the customer owes now (negative = we hold their money). */
  balance: number;
  /** Money on account not yet used on a bill. */
  advance: number;
  /** Saved bills with something still to pay, oldest first. */
  pendingBills: { invoice: Invoice; pending: number }[];
  openingLeft: number;
}

const byDate = (a: { date: string; createdAt?: string }, b: { date: string; createdAt?: string }) => (a.date + (a.createdAt ?? '')).localeCompare(b.date + (b.createdAt ?? ''));

async function customerData(businessId: string, customerId: string) {
  const [invoices, notes, allPays] = await Promise.all([
    db.invoices.where('billTo.customerId').equals(customerId).filter((i) => i.businessId === businessId && i.status === 'saved' && !i.deleted).toArray(),
    db.creditNotes.where('billTo.customerId').equals(customerId).filter((n) => n.businessId === businessId && n.status === 'saved' && !n.deleted).toArray(),
    db.payments.where('businessId').equals(businessId).toArray(),
  ]);
  const billIds = new Set(invoices.map((i) => i.id));
  const pays = allPays.filter((p) => !p.deleted && (billIds.has(p.invoiceId) || (!p.invoiceId && p.customerId === customerId)));
  return { invoices, notes, pays };
}

/** On-account money: paid in less given back (voided entries left out). */
const onAccountNet = (pays: PaymentEntry[]) => pays.filter((p) => !p.invoiceId && !p.voidedAt).reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);

export async function khataOf(businessId: string, customer: Customer): Promise<Khata> {
  const { invoices, notes, pays } = await customerData(businessId, customer.id);
  const ledger = buildLedger(pays, notes);
  const opening = customer.openingBalance ?? 0;
  const acct = onAccountNet(pays);
  const rows: Omit<KhataRow, 'balance'>[] = [];
  for (const inv of invoices) rows.push({ date: inv.date, label: t('Bill {number}', { number: inv.number }), amount: inv.totals.grandTotal, href: `/tabs/invoices/${inv.id}` });
  for (const n of notes) rows.push({ date: n.date, label: t('Return {number}', { number: n.number }), amount: -n.totals.grandTotal, href: `/tabs/credit-notes/${n.id}` });
  for (const p of pays) {
    if (p.voidedAt) continue;
    // Using an advance moves money from the account to a bill: no change to what is owed, so skip both halves.
    if (p.mode === 'advance') continue;
    const bill = p.invoiceId ? invoices.find((i) => i.id === p.invoiceId) : undefined;
    const what = p.kind === 'refund' ? t('Refund') : bill ? t('Paid · {number}', { number: bill.number }) : t('Paid on account');
    rows.push({ date: p.date, label: `${what} · ${modeLabel(p.mode)}`, amount: p.kind === 'refund' ? p.amount : -p.amount, href: bill ? `/tabs/invoices/${bill.id}` : undefined, entry: p });
  }
  rows.sort(byDate);
  let balance = opening;
  const out: KhataRow[] = [];
  if (opening) out.push({ date: customer.createdAt.slice(0, 10), label: t('Opening balance'), amount: opening, balance: opening });
  for (const r of rows) out.push({ ...r, balance: (balance += r.amount) });
  const pendingBills = invoices
    .map((invoice) => ({ invoice, pending: moneyOf(invoice, ledger).pending }))
    .filter((b) => b.pending > 0)
    .sort((a, b) => byDate(a.invoice, b.invoice));
  return { rows: out, balance, advance: Math.max(0, acct - opening), pendingBills, openingLeft: Math.max(0, opening - acct) };
}

/**
 * A khata payment: settles the opening balance first, then the oldest bills; anything left stays
 * on account as an advance. All the entries share one receipt id.
 */
export async function receiveKhataPayment(actor: Actor, customer: Customer, input: { amount: number; mode: CashMode; date: string; reference?: string; note?: string }): Promise<PaymentEntry[]> {
  if (!(input.amount > 0)) throw new Error(t('Amount must be more than zero'));
  const k = await khataOf(actor.businessId, customer);
  const receiptId = newId();
  let rest = input.amount;
  const base = {
    kind: 'payment' as const,
    mode: input.mode,
    date: input.date || todayISO(),
    reference: input.reference?.trim() || undefined,
    note: input.note?.trim() || undefined,
    receivedBy: actor.userId,
    receivedByName: actor.userName,
    customerId: customer.id,
    receiptId,
  };
  const out: PaymentEntry[] = [];
  let onAccount = Math.min(rest, k.openingLeft);
  rest -= onAccount;
  for (const b of k.pendingBills) {
    if (rest <= 0) break;
    const amt = Math.min(rest, b.pending);
    rest -= amt;
    out.push(await putRecord('payments', actor, { id: newId(), ...base, invoiceId: b.invoice.id, amount: amt } as PaymentEntry));
  }
  onAccount += rest;
  if (onAccount > 0) out.push(await putRecord('payments', actor, { id: newId(), ...base, invoiceId: '', amount: onAccount } as PaymentEntry));
  return out;
}

/** Pays a bill from the customer's advance (two entries: out of the account, onto the bill). */
export async function applyAdvance(actor: Actor, customer: Customer, invoice: Invoice, amount: number, jobId?: string): Promise<void> {
  const k = await khataOf(actor.businessId, customer);
  const pending = k.pendingBills.find((b) => b.invoice.id === invoice.id)?.pending ?? 0;
  const amt = Math.min(amount, k.advance, pending);
  if (amt <= 0) return;
  const receiptId = newId();
  const base = { mode: 'advance' as const, date: todayISO(), receivedBy: actor.userId, receivedByName: actor.userName, customerId: customer.id, receiptId };
  await putRecord('payments', actor, { id: newId(), ...base, kind: 'refund', invoiceId: '', amount: amt, jobId: jobId ?? null, note: t('Used on bill {number}', { number: invoice.number }) } as PaymentEntry);
  await putRecord('payments', actor, { id: newId(), ...base, kind: 'payment', invoiceId: invoice.id, amount: amt } as PaymentEntry);
}

/** A bill leaving `unpaid` on credit would take the customer above their limit? */
export async function creditOverLimit(businessId: string, customerId: string | null | undefined, unpaid: number): Promise<{ limit: number; balance: number; after: number } | null> {
  const c = customerId ? await db.customers.get(customerId) : undefined;
  if (!c?.creditLimit || unpaid <= 0) return null;
  const balance = (await khataOf(businessId, c)).balance;
  return balance + unpaid > c.creditLimit ? { limit: c.creditLimit, balance, after: balance + unpaid } : null;
}

/** Everyone who owes the store something, biggest first. */
export async function receivables(businessId: string): Promise<{ customer: Customer; balance: number; overdue: number }[]> {
  const customers = await db.customers.where('businessId').equals(businessId).filter((c) => !c.deleted).toArray();
  const [invoices, notes, pays] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter((n) => n.status === 'saved' && !n.deleted).toArray(),
    db.payments.where('businessId').equals(businessId).filter((p) => !p.deleted).toArray(),
  ]);
  const ledger = buildLedger(pays, notes);
  const today = todayISO();
  const owed = new Map<string, { balance: number; overdue: number }>(customers.map((c) => [c.id, { balance: c.openingBalance ?? 0, overdue: 0 }]));
  for (const inv of invoices) {
    const id = inv.billTo?.customerId;
    const slot = id ? owed.get(id) : undefined;
    if (!slot) continue;
    const m = moneyOf(inv, ledger);
    slot.balance += m.pending - m.refundDue;
    if (m.pending > 0 && inv.dueDate && inv.dueDate < today) slot.overdue += m.pending;
  }
  for (const p of pays) {
    if (p.invoiceId || !p.customerId || p.voidedAt) continue;
    const slot = owed.get(p.customerId);
    if (slot) slot.balance -= p.kind === 'refund' ? -p.amount : p.amount;
  }
  return customers
    .map((customer) => ({ customer, ...owed.get(customer.id)! }))
    .filter((r) => r.balance !== 0)
    .sort((a, b) => b.balance - a.balance);
}

/** Statement for a date range: balance brought forward, each entry, balance at the end. */
export async function statementTable(businessId: string, customer: Customer, from: string, to: string): Promise<ExportTable> {
  const k = await khataOf(businessId, customer);
  const before = k.rows.filter((r) => r.date < from);
  const inRange = k.rows.filter((r) => r.date >= from && r.date <= to);
  const brought = before.length ? before[before.length - 1]!.balance : 0;
  const closing = inRange.length ? inRange[inRange.length - 1]!.balance : brought;
  const d = (s: string) => s.split('-').reverse().join('/');
  return {
    title: t('Statement of account'),
    subtitle: [t('{from} to {to}', { from: d(from), to: d(to) })],
    party: { heading: t('Customer'), lines: [customer.name, ...addressLines(customer.billingAddress), customer.phone ?? '', customer.taxId ? `GSTIN: ${customer.taxId}` : ''].filter(Boolean) },
    columns: [
      { label: t('Date'), kind: 'date', width: 'auto' },
      { label: t('Details') },
      { label: t('Bill amount'), kind: 'money' },
      { label: t('Received'), kind: 'money' },
      { label: t('Balance'), kind: 'money' },
    ],
    rows: [
      [from, t('Balance brought forward'), null, null, brought],
      ...inRange.map((r) => [r.date, r.label, r.amount > 0 ? r.amount : null, r.amount < 0 ? -r.amount : null, r.balance]),
    ],
    foot: [['', t('Balance due'), null, null, closing]],
    fileBase: `Statement-${customer.name}-${from}-${to}`,
  };
}

/** WhatsApp text asking for the balance, with a UPI link for the exact amount. */
export function reminderText(storeName: string, customer: Customer, balance: number, upiLink?: string): string {
  const amount = (balance / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [t('Namaste {name},', { name: customer.name }), t('Your balance with {store} is ₹{amount}.', { store: storeName, amount }), upiLink ? t('Pay by UPI: {link}', { link: upiLink }) : '', t('Thank you.')]
    .filter(Boolean)
    .join('\n');
}
