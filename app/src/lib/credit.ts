import { todayISO } from '@invoice/shared';
import { db, type CreditNote, type Invoice, type PaymentEntry } from './db';
import { t } from './i18n';
import { buildLedger, moneyOf } from './ledger';
import { newId, putRecord, type Actor } from './repo';

/**
 * A return credit note on a paid bill leaves money owed to the customer. It is settled once:
 * refunded (cash / UPI…: the usual refund entry), or kept as credit. Kept credit lives on the note
 * and pays later bills (payment mode "Credit note"); nothing moves through the cash drawer.
 */

const live = (p: PaymentEntry) => !p.voidedAt && !p.deleted;

/** Credit kept on a note, less what later bills used. */
export async function creditLeft(businessId: string, noteId: string): Promise<number> {
  const pays = await db.payments.where('businessId').equals(businessId).filter((p) => live(p) && p.mode === 'creditnote' && p.creditNoteId === noteId).toArray();
  return pays.reduce((a, p) => a + (p.kind === 'refund' ? p.amount : -p.amount), 0);
}

/** Owed back on the note's bill right now (paid more than is now due). */
export async function refundDueOf(note: CreditNote): Promise<number> {
  const inv = await db.invoices.get(note.invoiceId);
  if (!inv) return 0;
  const [pays, notes] = await Promise.all([db.payments.where('businessId').equals(note.businessId).toArray(), db.creditNotes.where('businessId').equals(note.businessId).toArray()]);
  return moneyOf(inv, buildLedger(pays, notes)).refundDue;
}

/** Settles the note by keeping the money as credit (the bill is closed, no cash moves). */
export async function keepAsCredit(actor: Actor, note: CreditNote): Promise<number> {
  const due = await refundDueOf(note);
  if (due <= 0) return 0;
  await putRecord('payments', actor, {
    id: newId(),
    invoiceId: note.invoiceId,
    creditNoteId: note.id,
    customerId: note.billTo?.customerId ?? null,
    kind: 'refund',
    amount: due,
    mode: 'creditnote',
    date: todayISO(),
    note: t('Kept as credit on {number}', { number: note.number }),
    receivedBy: actor.userId,
    receivedByName: actor.userName,
  } as PaymentEntry);
  return due;
}

/** How a note was settled: refunded, kept as credit (and what's left), or still open. */
export async function settlementOf(note: CreditNote): Promise<{ state: 'open' | 'refunded' | 'credit'; left: number; due: number }> {
  const pays = await db.payments.where('businessId').equals(note.businessId).filter((p) => live(p) && p.creditNoteId === note.id).toArray();
  const kept = pays.some((p) => p.kind === 'refund' && p.mode === 'creditnote');
  const refunded = pays.some((p) => p.kind === 'refund' && p.mode !== 'creditnote');
  return { state: kept ? 'credit' : refunded ? 'refunded' : 'open', left: kept ? await creditLeft(note.businessId, note.id) : 0, due: await refundDueOf(note) };
}

/** A customer's notes with credit left (or, for a walk-in, the note with this number). */
export async function openCredits(businessId: string, opts: { customerId?: string | null; number?: string }): Promise<{ note: CreditNote; left: number }[]> {
  const notes = await db.creditNotes
    .where('businessId')
    .equals(businessId)
    .filter((n) => n.status === 'saved' && !n.deleted && (opts.number ? n.number.toUpperCase() === opts.number.trim().toUpperCase() : !!opts.customerId && n.billTo?.customerId === opts.customerId))
    .toArray();
  const out: { note: CreditNote; left: number }[] = [];
  for (const note of notes) {
    const left = await creditLeft(businessId, note.id);
    if (left > 0) out.push({ note, left });
  }
  return out;
}

/** Pays (part of) a bill from a note's credit. */
export async function payWithCredit(actor: Actor, invoice: Invoice, noteId: string, amount: number): Promise<number> {
  const left = await creditLeft(actor.businessId, noteId);
  const [pays, notes] = await Promise.all([db.payments.where('businessId').equals(actor.businessId).toArray(), db.creditNotes.where('businessId').equals(actor.businessId).toArray()]);
  const pending = moneyOf(invoice, buildLedger(pays, notes)).pending;
  const use = Math.min(amount, left, pending);
  if (use <= 0) return 0;
  const note = await db.creditNotes.get(noteId);
  await putRecord('payments', actor, {
    id: newId(),
    invoiceId: invoice.id,
    creditNoteId: noteId,
    customerId: invoice.billTo?.customerId ?? null,
    kind: 'payment',
    amount: use,
    mode: 'creditnote',
    date: todayISO(),
    reference: note?.number,
    receivedBy: actor.userId,
    receivedByName: actor.userName,
  } as PaymentEntry);
  return use;
}
