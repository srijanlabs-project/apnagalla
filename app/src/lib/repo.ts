import { calculateInvoice, financialYearLabel, todayISO, type InvoiceTotals } from '@invoice/shared';
import type { Table } from 'dexie';
import {
  db,
  setMeta,
  getMeta,
  type BusinessProfile,
  type BusinessSettings,
  type DesignSettings,
  type DocBase,
  type Estimate,
  type HistoryEntry,
  type Invoice,
  type SyncedRecord,
  type SyncedTable,
} from './db';

/** Who is acting: needed for updatedBy / history / permissions. */
export interface Actor {
  businessId: string;
  userId: string;
  userName: string;
  role: 'owner' | 'staff';
}

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for non-secure contexts (plain-http LAN testing).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const nowIso = () => new Date().toISOString();

function tableOf(name: SyncedTable): Table<SyncedRecord, string> {
  return db.table(name) as Table<SyncedRecord, string>;
}

/** Insert or replace a record and queue it for sync — atomically. */
export async function putRecord<R extends { id: string; createdAt?: string }>(name: SyncedTable, actor: Actor, record: R): Promise<R & SyncedRecord> {
  const now = nowIso();
  const full = { ...record, createdAt: record.createdAt || now, businessId: actor.businessId, updatedAt: now, updatedBy: actor.userId } as R & SyncedRecord;
  await db.transaction('rw', [tableOf(name), db.outbox], async () => {
    await tableOf(name).put(full);
    await enqueue(name, full.id, actor.businessId, 'upsert');
  });
  return full;
}

/** Soft delete (the deletion must sync too). */
export async function deleteRecord(name: SyncedTable, actor: Actor, id: string): Promise<void> {
  await db.transaction('rw', [tableOf(name), db.outbox], async () => {
    await tableOf(name).update(id, { deleted: true, updatedAt: nowIso(), updatedBy: actor.userId });
    await enqueue(name, id, actor.businessId, 'delete');
  });
}

async function enqueue(table: SyncedTable, recordId: string, businessId: string, op: 'upsert' | 'delete') {
  // Collapse repeated edits of the same record into one outbox entry.
  await db.outbox.where('[table+recordId]').equals([table, recordId]).delete();
  await db.outbox.add({ table, recordId, businessId, op, createdAt: nowIso() });
}

/* ---------- defaults ---------- */

export const DEFAULT_DESIGN: DesignSettings = {
  template: 'classic',
  color: '#3b5bdb',
  fontSize: 'M',
  paper: 'A4',
  show: {
    logo: true,
    taxId: true,
    shipTo: true,
    itemDescription: true,
    unitColumn: true,
    discountColumn: true,
    taxColumn: true,
    bankDetails: true,
    upiQr: true,
    signature: true,
    terms: true,
    amountInWords: true,
  },
};

/** Placeholder timestamp for auto-created defaults so any real edit (from any device) wins in sync. */
const EPOCH = '1970-01-01T00:00:00.000Z';

export function defaultSettings(businessId: string): BusinessSettings {
  return {
    id: businessId,
    businessId,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    updatedBy: '',
    invoicePrefix: 'INV',
    estimatePrefix: 'EST',
    resetEachFinancialYear: true,
    defaultPaymentTermsDays: 0,
    defaultTaxPct: 0,
    roundOff: true,
    defaultNotes: 'Thank you for your business!',
    defaultTerms: '',
    otherPaymentInstructions: '',
    customFieldLabels: [],
    units: ['pcs', 'kg', 'g', 'ltr', 'box', 'dozen', 'mtr', 'hr', 'day', 'job'],
    taxRates: [0, 5, 12, 18, 28],
    reminderTemplate: 'Hi {name}, ₹{pending} is pending against invoice {number} dated {date}. Kindly pay at the earliest. – {business}',
    design: DEFAULT_DESIGN,
  };
}

/**
 * Makes sure profile + settings exist locally for this business. They are NOT queued for sync:
 * real values arrive from the server (M3) or from the owner editing them.
 */
export async function ensureBusinessRecords(businessId: string, businessName: string): Promise<void> {
  await db.transaction('rw', [db.profiles, db.settings], async () => {
    if (!(await db.profiles.get(businessId))) {
      await db.profiles.put({ id: businessId, businessId, createdAt: EPOCH, updatedAt: EPOCH, updatedBy: '', name: businessName, address: {} });
    }
    if (!(await db.settings.get(businessId))) await db.settings.put(defaultSettings(businessId));
  });
}

/* ---------- numbering (M2: per device; M3 replaces with server allocation + offline blocks) ---------- */

export function numberSeriesKey(kind: 'invoice' | 'estimate', businessId: string, date: string, resetEachFY: boolean) {
  return `seq:${businessId}:${kind}:${resetEachFY ? financialYearLabel(date) : 'all'}`;
}

export function formatDocNumber(prefix: string, date: string, seq: number, resetEachFY: boolean) {
  const n = String(seq).padStart(4, '0');
  return resetEachFY ? `${prefix}/${financialYearLabel(date)}/${n}` : `${prefix}/${n}`;
}

/** Peek at the number the next saved document will get (shown in the editor; not reserved). */
export async function previewNextNumber(kind: 'invoice' | 'estimate', businessId: string, date: string): Promise<string> {
  const s = (await db.settings.get(businessId)) ?? defaultSettings(businessId);
  const prefix = kind === 'invoice' ? s.invoicePrefix : s.estimatePrefix;
  const last = (await getMeta<number>(numberSeriesKey(kind, businessId, date, s.resetEachFinancialYear))) ?? 0;
  return formatDocNumber(prefix, date, last + 1, s.resetEachFinancialYear);
}

async function takeNextNumber(kind: 'invoice' | 'estimate', businessId: string, date: string): Promise<string> {
  const s = (await db.settings.get(businessId)) ?? defaultSettings(businessId);
  const prefix = kind === 'invoice' ? s.invoicePrefix : s.estimatePrefix;
  const key = numberSeriesKey(kind, businessId, date, s.resetEachFinancialYear);
  const table = kind === 'invoice' ? db.invoices : db.estimates;
  let seq = (await getMeta<number>(key)) ?? 0;
  let number: string;
  // Skip numbers already used (e.g. typed manually).
  do {
    seq += 1;
    number = formatDocNumber(prefix, date, seq, s.resetEachFinancialYear);
  } while (await (table as Table<DocBase, string>).where('[businessId+number]').equals([businessId, number]).count());
  await setMeta(key, seq);
  return number;
}

export async function isNumberTaken(kind: 'invoice' | 'estimate', businessId: string, number: string, exceptId?: string): Promise<boolean> {
  const table = (kind === 'invoice' ? db.invoices : db.estimates) as Table<DocBase, string>;
  const hits = await table.where('[businessId+number]').equals([businessId, number]).toArray();
  return hits.some((d) => d.id !== exceptId && !d.deleted);
}

/* ---------- documents ---------- */

export function computeTotals(doc: Pick<DocBase, 'lines' | 'overallDiscount' | 'charges' | 'roundOff' | 'targetTotal'>): InvoiceTotals {
  return calculateInvoice({
    lines: doc.lines,
    overallDiscount: doc.overallDiscount,
    charges: doc.charges,
    roundOff: doc.roundOff,
    targetTotal: doc.targetTotal,
  });
}

function historyEntry(actor: Actor, action: string, detail?: string): HistoryEntry {
  return { at: nowIso(), by: actor.userId, byName: actor.userName, action, detail };
}

async function snapshotBusiness(businessId: string) {
  const p = await db.profiles.get(businessId);
  if (!p) return null;
  const { id: _i, businessId: _b, createdAt: _c, updatedAt: _u, updatedBy: _ub, deleted: _d, ...rest } = p;
  return rest as Omit<BusinessProfile, keyof SyncedRecord>;
}

export class PermissionError extends Error {}

/**
 * Save an invoice. `finalize` = true turns a draft into a saved invoice (assigns a number,
 * freezes business details). Staff may not edit an invoice once it is saved.
 */
export async function saveInvoice(actor: Actor, inv: Invoice, opts: { finalize: boolean; editNote?: string }): Promise<Invoice> {
  const existing = await db.invoices.get(inv.id);
  if (existing && existing.status !== 'draft' && actor.role !== 'owner') throw new PermissionError('Only the owner can edit a saved invoice');
  if (existing?.status === 'cancelled') throw new PermissionError('Cancelled invoices cannot be edited');

  const totals = computeTotals(inv);
  const next: Invoice = { ...inv, totals, history: [...(existing?.history ?? inv.history ?? [])] };
  if (!existing) next.history.push(historyEntry(actor, 'created'));

  // Payment can never exceed the total (SPEC §3) — re-clamp after edits change the total.
  if (next.payment.amountPaid > totals.grandTotal) next.payment = { ...next.payment, amountPaid: totals.grandTotal };
  next.payment = normalisePayment(next.payment, totals.grandTotal);

  if (opts.finalize && next.status === 'draft') {
    if (!next.number) next.number = await takeNextNumber('invoice', actor.businessId, next.date);
    next.status = 'saved';
    next.businessSnapshot = await snapshotBusiness(actor.businessId);
    next.history.push(historyEntry(actor, 'saved', next.number));
  } else if (existing && existing.status === 'saved') {
    next.businessSnapshot = existing.businessSnapshot;
    next.history.push(historyEntry(actor, 'edited', opts.editNote));
  }
  return putRecord('invoices', actor, next);
}

export async function saveEstimate(actor: Actor, est: Estimate, opts: { finalize: boolean }): Promise<Estimate> {
  const existing = await db.estimates.get(est.id);
  if (existing && existing.status !== 'draft' && actor.role !== 'owner' && existing.createdBy !== actor.userId) {
    throw new PermissionError('Only the owner can edit this estimate');
  }
  const totals = computeTotals(est);
  const next: Estimate = { ...est, totals, history: [...(existing?.history ?? est.history ?? [])] };
  if (!existing) next.history.push(historyEntry(actor, 'created'));
  if (opts.finalize && next.status === 'draft') {
    if (!next.number) next.number = await takeNextNumber('estimate', actor.businessId, next.date);
    next.status = 'open';
    next.businessSnapshot = await snapshotBusiness(actor.businessId);
    next.history.push(historyEntry(actor, 'saved', next.number));
  } else if (existing && existing.status !== 'draft') {
    next.history.push(historyEntry(actor, 'edited'));
  }
  return putRecord('estimates', actor, next);
}

export function normalisePayment(p: Invoice['payment'], total: number): Invoice['payment'] {
  const amountPaid = Math.max(0, Math.min(p.amountPaid, total));
  const status = amountPaid === 0 ? 'unpaid' : amountPaid >= total ? 'paid' : 'partial';
  return { ...p, amountPaid, status };
}

export async function updatePayment(actor: Actor, invoiceId: string, payment: Invoice['payment']): Promise<Invoice> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') throw new PermissionError('Payment can only be recorded on a saved invoice');
  const p = normalisePayment(payment, inv.totals.grandTotal);
  if (p.amountPaid < inv.payment.amountPaid && actor.role !== 'owner') throw new PermissionError('Only the owner can reduce a recorded payment');
  const detail = p.status === 'unpaid' ? 'marked unpaid' : `paid ₹${(p.amountPaid / 100).toFixed(2)}${p.mode ? ` (${p.mode})` : ''}`;
  return putRecord('invoices', actor, { ...inv, payment: p, history: [...inv.history, historyEntry(actor, 'payment', detail)] });
}

export async function cancelInvoice(actor: Actor, invoiceId: string, reason?: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError('Only the owner can cancel an invoice');
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') return;
  await putRecord('invoices', actor, { ...inv, status: 'cancelled', history: [...inv.history, historyEntry(actor, 'cancelled', reason)] });
}

export async function deleteDraft(actor: Actor, kind: 'invoice' | 'estimate', id: string): Promise<void> {
  const doc = kind === 'invoice' ? await db.invoices.get(id) : await db.estimates.get(id);
  if (!doc || doc.status !== 'draft') throw new PermissionError('Only drafts can be deleted');
  await deleteRecord(kind === 'invoice' ? 'invoices' : 'estimates', actor, id);
}

export async function setEstimateStatus(actor: Actor, id: string, status: 'open' | 'accepted' | 'declined'): Promise<void> {
  const est = await db.estimates.get(id);
  if (!est || est.status === 'draft' || est.status === 'converted') return;
  await putRecord('estimates', actor, { ...est, status, history: [...est.history, historyEntry(actor, status)] });
}

/** Blank document with business defaults applied. */
export async function blankDoc(actor: Actor): Promise<Omit<DocBase, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>> {
  const s = (await db.settings.get(actor.businessId)) ?? defaultSettings(actor.businessId);
  const defaultBank = (await db.bankAccounts.where('businessId').equals(actor.businessId).toArray()).find((b) => b.isDefault && !b.deleted);
  const defaultUpi = (await db.upiIds.where('businessId').equals(actor.businessId).toArray()).find((u) => u.isDefault && !u.deleted);
  const date = todayISO();
  const base = {
    number: '',
    date,
    paymentTermsDays: s.defaultPaymentTermsDays,
    customFields: s.customFieldLabels.filter(Boolean).map((label) => ({ label, value: '' })),
    billTo: null,
    shipTo: null,
    lines: [],
    overallDiscount: null,
    targetTotal: null,
    charges: [],
    roundOff: s.roundOff,
    notes: s.defaultNotes,
    terms: s.defaultTerms,
    bankAccountId: defaultBank?.id ?? null,
    upiIdId: defaultUpi?.id ?? null,
    createdBy: actor.userId,
    history: [],
  };
  return { ...base, totals: computeTotals(base) };
}

export async function newInvoiceDraft(actor: Actor): Promise<Invoice> {
  const base = await blankDoc(actor);
  const now = nowIso();
  return {
    ...base,
    id: newId(),
    businessId: actor.businessId,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.userId,
    status: 'draft',
    payment: { status: 'unpaid', amountPaid: 0 },
  };
}

export async function newEstimateDraft(actor: Actor): Promise<Estimate> {
  const base = await blankDoc(actor);
  const now = nowIso();
  return { ...base, id: newId(), businessId: actor.businessId, createdAt: now, updatedAt: now, updatedBy: actor.userId, status: 'draft' };
}

/** Estimate → new draft invoice with everything copied (SPEC §4.6). */
export async function convertEstimate(actor: Actor, estimateId: string): Promise<Invoice> {
  const est = await db.estimates.get(estimateId);
  if (!est) throw new Error('Estimate not found');
  const draft = await newInvoiceDraft(actor);
  const inv: Invoice = {
    ...draft,
    reference: est.number ? `Estimate ${est.number}` : est.reference,
    customFields: est.customFields,
    billTo: est.billTo,
    shipTo: est.shipTo,
    lines: est.lines.map((l) => ({ ...l, id: newId() })),
    overallDiscount: est.overallDiscount,
    targetTotal: est.targetTotal,
    charges: est.charges,
    roundOff: est.roundOff,
    notes: est.notes,
    terms: est.terms,
    bankAccountId: est.bankAccountId,
    upiIdId: est.upiIdId,
    fromEstimateId: est.id,
  };
  const saved = await saveInvoice(actor, inv, { finalize: false });
  await putRecord('estimates', actor, {
    ...est,
    status: 'converted',
    convertedInvoiceId: saved.id,
    history: [...est.history, historyEntry(actor, 'converted', 'to invoice draft')],
  });
  return saved;
}

export async function duplicateInvoice(actor: Actor, id: string): Promise<Invoice> {
  const src = await db.invoices.get(id);
  if (!src) throw new Error('Invoice not found');
  const draft = await newInvoiceDraft(actor);
  return saveInvoice(
    actor,
    {
      ...draft,
      billTo: src.billTo,
      shipTo: src.shipTo,
      customFields: src.customFields.map((f) => ({ ...f })),
      lines: src.lines.map((l) => ({ ...l, id: newId() })),
      overallDiscount: src.overallDiscount,
      targetTotal: src.targetTotal,
      charges: src.charges,
      roundOff: src.roundOff,
      notes: src.notes,
      terms: src.terms,
      bankAccountId: src.bankAccountId,
      upiIdId: src.upiIdId,
    },
    { finalize: false },
  );
}

/** Pending (unpaid) amount on an invoice. */
export function pendingAmount(inv: Invoice): number {
  if (inv.status !== 'saved') return 0;
  return Math.max(0, inv.totals.grandTotal - inv.payment.amountPaid);
}

export function isOverdue(inv: Invoice, today = todayISO()): boolean {
  return inv.status === 'saved' && pendingAmount(inv) > 0 && !!inv.dueDate && inv.dueDate < today;
}
