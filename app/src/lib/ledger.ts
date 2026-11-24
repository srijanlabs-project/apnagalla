import { todayISO } from '@invoice/shared';
import type { CreditNote, Invoice, PaymentEntry } from './db';

/**
 * Money on each bill, worked out from its payment entries and saved credit notes. Nothing here is
 * stored on the invoice, so two phones recording money on the same bill never overwrite each other.
 */
export interface BillMoney {
  /** Invoice total less saved credit notes. */
  due: number;
  credited: number;
  /** Payments less refunds (voided entries left out). */
  paid: number;
  /** Still to collect. */
  pending: number;
  /** Paid more than is now due (e.g. after a return): owed back to the customer. */
  refundDue: number;
  status: 'unpaid' | 'partial' | 'paid' | 'credited';
  entries: PaymentEntry[];
  notes: CreditNote[];
}

export type Ledger = Map<string, { entries: PaymentEntry[]; notes: CreditNote[] }>;

export function buildLedger(payments: PaymentEntry[], notes: CreditNote[]): Ledger {
  const map: Ledger = new Map();
  const slot = (id: string) => {
    let s = map.get(id);
    if (!s) map.set(id, (s = { entries: [], notes: [] }));
    return s;
  };
  for (const p of payments) if (!p.deleted) slot(p.invoiceId).entries.push(p);
  for (const n of notes) if (!n.deleted) slot(n.invoiceId).notes.push(n);
  for (const s of map.values()) s.entries.sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
  return map;
}

export function moneyOf(inv: Pick<Invoice, 'id' | 'status' | 'totals'>, ledger: Ledger): BillMoney {
  const { entries = [], notes = [] } = ledger.get(inv.id) ?? {};
  const live = entries.filter((e) => !e.voidedAt);
  const credited = notes.filter((n) => n.status === 'saved').reduce((a, n) => a + n.totals.grandTotal, 0);
  const paid = live.reduce((a, e) => a + (e.kind === 'refund' ? -e.amount : e.amount), 0);
  const due = Math.max(0, inv.totals.grandTotal - credited);
  const saved = inv.status === 'saved';
  const pending = saved ? Math.max(0, due - paid) : 0;
  const refundDue = saved ? Math.max(0, paid - due) : 0;
  const status = credited > 0 && due === 0 ? 'credited' : pending === 0 && saved ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { due, credited, paid, pending, refundDue, status, entries, notes };
}

export function isOverdue(inv: Invoice, money: BillMoney, today = todayISO()): boolean {
  return inv.status === 'saved' && money.pending > 0 && !!inv.dueDate && inv.dueDate < today;
}

export const MODE_LABEL: Record<PaymentEntry['mode'], string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque', other: 'Other' };
