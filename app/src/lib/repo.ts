import {
  DEFAULT_NUMBER_PATTERN,
  calculateInvoice,
  financialYearLabel,
  formatNumber,
  gstinState,
  resolvePlaceOfSupply,
  stateCode,
  todayISO,
  type GstType,
  type InvoiceTotals,
  type NumberSeries,
  type TaxMode,
} from '@invoice/shared';
import type { Table } from 'dexie';
import {
  db,
  setMeta,
  getMeta,
  type Address,
  type BusinessProfile,
  type BusinessSettings,
  type CreditNote,
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
    billPrefix: 'BILL',
    estimatePrefix: 'EST',
    creditNotePrefix: 'CN',
    numberPattern: DEFAULT_NUMBER_PATTERN,
    numberDigits: 4,
    resetEachFinancialYear: true,
    defaultPaymentTermsDays: 0,
    defaultTaxPct: 0,
    roundOff: true,
    defaultNotes: 'Thank you for your business!',
    defaultTerms: '',
    otherPaymentInstructions: '',
    customFieldLabels: [],
    units: ['pcs', 'kg', 'g', 'ltr', 'box', 'dozen', 'mtr', 'hr', 'day', 'job'],
    // GST slabs since 22 Sep 2025 (3% is for gold and jewellery).
    taxRates: [0, 3, 5, 18, 40],
    reminderTemplate: 'Hi {name}, ₹{pending} is pending against invoice {number} dated {date}. Kindly pay at the earliest. – {business}',
    design: DEFAULT_DESIGN,
  };
}

/**
 * Stored settings with defaults for fields added in later versions. A store that turned off the
 * yearly restart before number patterns existed keeps its old "INV/0001" style.
 */
export function withDefaults(businessId: string, stored: BusinessSettings | undefined): BusinessSettings {
  const d = defaultSettings(businessId);
  if (!stored) return d;
  const legacyPattern = !stored.numberPattern && stored.resetEachFinancialYear === false ? '{PREFIX}/{SEQ}' : undefined;
  return { ...d, ...stored, numberPattern: stored.numberPattern || legacyPattern || d.numberPattern, design: { ...d.design, ...stored.design } };
}

export async function settingsOf(businessId: string): Promise<BusinessSettings> {
  return withDefaults(businessId, await db.settings.get(businessId));
}

/* ---------- GST ---------- */

type GstProfile = Pick<BusinessProfile, 'gstType' | 'taxIdValue' | 'address'>;

/** Stores set up before R1.3 have no GST type: one whose tax ID is a valid GSTIN counts as regular. */
export function effectiveGstType(p: Pick<BusinessProfile, 'gstType' | 'taxIdValue'> | null | undefined): GstType {
  return p?.gstType ?? (gstinState(p?.taxIdValue) ? 'regular' : 'unregistered');
}

/** Only a regular GST store charges GST. */
export const defaultTaxMode = (gstType: GstType): TaxMode => (gstType === 'regular' ? 'gst' : 'none');

/** The store's own state code: from its GSTIN, else its address. */
export function storeStateCode(p: GstProfile | null | undefined): string | undefined {
  if (!p) return undefined;
  return (effectiveGstType(p) !== 'unregistered' ? gstinState(p.taxIdValue) : undefined) ?? stateCode(p.address?.state);
}

/** Place of supply of a document: chosen by hand, else from ship-to / bill-to / GSTIN, else the store's state. */
export function placeOfSupplyOf(doc: Pick<DocBase, 'placeOfSupply' | 'shipTo' | 'billTo'>, store: GstProfile | null | undefined): string | undefined {
  return (
    doc.placeOfSupply ||
    resolvePlaceOfSupply({ shipToState: doc.shipTo?.state, billToState: doc.billTo?.address?.state, buyerGstin: doc.billTo?.taxId }) ||
    storeStateCode(store)
  );
}

/**
 * Makes sure profile + settings exist locally for this business. They are NOT queued for sync:
 * real values arrive from the server (M3) or from the owner editing them.
 */
export async function ensureBusinessRecords(businessId: string, businessName: string, address: Address = {}): Promise<void> {
  await db.transaction('rw', [db.profiles, db.settings], async () => {
    if (!(await db.profiles.get(businessId))) {
      await db.profiles.put({ id: businessId, businessId, createdAt: EPOCH, updatedAt: EPOCH, updatedBy: '', name: businessName, address });
    }
    if (!(await db.settings.get(businessId))) await db.settings.put(defaultSettings(businessId));
  });
}

/* ---------- numbering ---------- */
/*
 * The server hands out numbers per store and series, so two phones never use the same one.
 * Online, a save asks the server for the next number (keeps them in order across phones).
 * Offline, the phone uses its reserved block (topped up to 10 by sync). With no network and an
 * empty block the save is refused; the document can still be kept as a draft.
 * Tests run without a server: then numbers come from a local counter (the M2 behaviour).
 */

export type NumberAllocator = (businessId: string, series: NumberSeries, period: string) => Promise<number | null>;
let allocator: NumberAllocator | null = null;

/** The app installs the server allocator at start-up; unit tests leave it unset. */
export function setNumberAllocator(fn: NumberAllocator | null) {
  allocator = fn;
}

export class NumberingError extends Error {}

export type DocKind = 'invoice' | 'estimate' | 'credit';

export const seriesPeriod = (date: string, resetEachFY: boolean) => (resetEachFY ? financialYearLabel(date) : 'all');

export const numberPoolKey = (businessId: string, series: NumberSeries, period: string) => `numpool:${businessId}:${series}:${period}`;

const localCounterKey = (series: NumberSeries, businessId: string, period: string) => `seq:${businessId}:${series}:${period}`;

/** Which series a document is numbered in. A regular GST store numbers non-GST bills separately. */
export function seriesOf(kind: DocKind, taxMode: TaxMode | undefined, gstType: GstType): NumberSeries {
  if (kind !== 'invoice') return kind;
  return gstType === 'regular' && taxMode === 'none' ? 'bill' : 'invoice';
}

export function prefixOf(s: BusinessSettings, series: NumberSeries): string {
  return { invoice: s.invoicePrefix, bill: s.billPrefix, estimate: s.estimatePrefix, credit: s.creditNotePrefix }[series];
}

export function formatDocNumber(s: BusinessSettings, series: NumberSeries, date: string, seq: number): string {
  return formatNumber(s.numberPattern, prefixOf(s, series), financialYearLabel(date), date, seq, s.numberDigits);
}

/** Peek at the number the next saved document will get (shown in the editor; not reserved). */
export async function previewNextNumber(series: NumberSeries, businessId: string, date: string): Promise<string> {
  const s = await settingsOf(businessId);
  const period = seriesPeriod(date, s.resetEachFinancialYear);
  if (allocator) {
    // The real number is decided at save time; show the next one this phone holds, if any.
    const pool = (await getMeta<number[]>(numberPoolKey(businessId, series, period))) ?? [];
    return pool.length ? formatDocNumber(s, series, date, pool[0]!) : '';
  }
  const last = (await getMeta<number>(localCounterKey(series, businessId, period))) ?? 0;
  return formatDocNumber(s, series, date, last + 1);
}

async function nextSeq(series: NumberSeries, businessId: string, period: string): Promise<number> {
  if (!allocator) {
    const key = localCounterKey(series, businessId, period);
    const seq = ((await getMeta<number>(key)) ?? 0) + 1;
    await setMeta(key, seq);
    return seq;
  }
  const fromServer = await allocator(businessId, series, period).catch(() => null);
  if (fromServer != null) return fromServer;
  const key = numberPoolKey(businessId, series, period);
  const pool = (await getMeta<number[]>(key)) ?? [];
  const seq = pool.shift();
  if (seq == null) {
    const what = { invoice: 'invoice', bill: 'bill', estimate: 'estimate', credit: 'credit note' }[series];
    throw new NumberingError(`No ${what} numbers left on this phone. Connect to the internet once to get more, or save it as a draft for now.`);
  }
  await setMeta(key, pool);
  return seq;
}

const tableOfKind = (kind: DocKind) => (kind === 'invoice' ? db.invoices : kind === 'estimate' ? db.estimates : db.creditNotes) as unknown as Table<DocBase, string>;

async function takeNextNumber(kind: DocKind, series: NumberSeries, businessId: string, date: string): Promise<Pick<DocBase, 'number' | 'numberSeries' | 'numberSeq'>> {
  const s = await settingsOf(businessId);
  const period = seriesPeriod(date, s.resetEachFinancialYear);
  // Skip numbers already used on this phone (e.g. typed by hand).
  for (let tries = 0; tries < 50; tries++) {
    const seq = await nextSeq(series, businessId, period);
    const number = formatDocNumber(s, series, date, seq);
    if (!(await tableOfKind(kind).where('[businessId+number]').equals([businessId, number]).count())) {
      return { number, numberSeries: `${series}:${period}`, numberSeq: seq };
    }
  }
  throw new NumberingError('Could not find a free number. Please try again.');
}

export async function isNumberTaken(kind: DocKind, businessId: string, number: string, exceptId?: string): Promise<boolean> {
  const hits = await tableOfKind(kind).where('[businessId+number]').equals([businessId, number]).toArray();
  return hits.some((d) => d.id !== exceptId && !d.deleted);
}

/* ---------- documents ---------- */

/** A bill without GST charges no tax: the entered price is the price. */
export function computeTotals(doc: Pick<DocBase, 'lines' | 'overallDiscount' | 'charges' | 'roundOff' | 'targetTotal' | 'taxMode'>): InvoiceTotals {
  const noTax = doc.taxMode === 'none';
  return calculateInvoice({
    lines: noTax ? doc.lines.map((l) => ({ ...l, taxPct: 0, rateIncludesTax: false })) : doc.lines,
    overallDiscount: doc.overallDiscount,
    charges: noTax ? doc.charges.map((c) => ({ ...c, taxPct: 0 })) : doc.charges,
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

/** GST fields fixed when a document is saved: tax mode follows the store, place of supply is recorded. */
async function settleGst<D extends DocBase>(businessId: string, doc: D): Promise<D> {
  const profile = await db.profiles.get(businessId);
  const gstType = effectiveGstType(profile);
  const taxMode: TaxMode = gstType === 'regular' ? (doc.taxMode ?? 'gst') : 'none';
  return { ...doc, taxMode, placeOfSupply: taxMode === 'gst' ? (placeOfSupplyOf(doc, profile) ?? null) : null };
}

async function numberFor(kind: DocKind, businessId: string, doc: DocBase): Promise<Pick<DocBase, 'number' | 'numberSeries' | 'numberSeq'>> {
  if (doc.number) return { number: doc.number, numberSeries: doc.numberSeries, numberSeq: doc.numberSeq };
  const gstType = effectiveGstType(await db.profiles.get(businessId));
  return takeNextNumber(kind, seriesOf(kind, doc.taxMode, gstType), businessId, doc.date);
}

/**
 * Save an invoice. `finalize` = true turns a draft into a saved invoice (assigns a number,
 * freezes business details). Staff may not edit an invoice once it is saved.
 */
export async function saveInvoice(actor: Actor, inv: Invoice, opts: { finalize: boolean; editNote?: string }): Promise<Invoice> {
  const existing = await db.invoices.get(inv.id);
  if (existing && existing.status !== 'draft' && actor.role !== 'owner') throw new PermissionError('Only the owner can edit a saved invoice');
  if (existing?.status === 'cancelled') throw new PermissionError('Cancelled invoices cannot be edited');

  let next: Invoice = { ...inv, history: [...(existing?.history ?? inv.history ?? [])] };
  const finalizing = opts.finalize && next.status === 'draft';
  if (finalizing) next = await settleGst(actor.businessId, next);
  const totals = computeTotals(next);
  next.totals = totals;
  if (!existing) next.history.push(historyEntry(actor, 'created'));

  // Payment can never exceed the total (SPEC §3) — re-clamp after edits change the total.
  next.payment = normalisePayment(next.payment, totals.grandTotal, next.credited);

  if (finalizing) {
    Object.assign(next, await numberFor('invoice', actor.businessId, next));
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
  let next: Estimate = { ...est, history: [...(existing?.history ?? est.history ?? [])] };
  const finalizing = opts.finalize && next.status === 'draft';
  if (finalizing) next = await settleGst(actor.businessId, next);
  next.totals = computeTotals(next);
  if (!existing) next.history.push(historyEntry(actor, 'created'));
  if (finalizing) {
    Object.assign(next, await numberFor('estimate', actor.businessId, next));
    next.status = 'open';
    next.businessSnapshot = await snapshotBusiness(actor.businessId);
    next.history.push(historyEntry(actor, 'saved', next.number));
  } else if (existing && existing.status !== 'draft') {
    next.history.push(historyEntry(actor, 'edited'));
  }
  return putRecord('estimates', actor, next);
}

/**
 * Amount paid is kept between 0 and the invoice total. The invoice counts as paid once payments
 * cover the total less credit notes.
 */
export function normalisePayment(p: Invoice['payment'], total: number, credited = 0): Invoice['payment'] {
  const amountPaid = Math.max(0, Math.min(p.amountPaid, total));
  const due = Math.max(0, total - credited);
  const status = amountPaid >= due ? 'paid' : amountPaid === 0 ? 'unpaid' : 'partial';
  return { ...p, amountPaid, status };
}

export async function updatePayment(actor: Actor, invoiceId: string, payment: Invoice['payment']): Promise<Invoice> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') throw new PermissionError('Payment can only be recorded on a saved invoice');
  const p = normalisePayment(payment, inv.totals.grandTotal, inv.credited);
  if (p.amountPaid < inv.payment.amountPaid && actor.role !== 'owner') throw new PermissionError('Only the owner can reduce a recorded payment');
  const detail = p.amountPaid === 0 ? 'marked unpaid' : `paid ₹${(p.amountPaid / 100).toFixed(2)}${p.mode ? ` (${p.mode})` : ''}`;
  return putRecord('invoices', actor, { ...inv, payment: p, history: [...inv.history, historyEntry(actor, 'payment', detail)] });
}

export async function cancelInvoice(actor: Actor, invoiceId: string, reason?: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError('Only the owner can cancel an invoice');
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') return;
  if ((inv.credited ?? 0) > 0) throw new PermissionError('Cancel its credit notes first');
  await putRecord('invoices', actor, { ...inv, status: 'cancelled', history: [...inv.history, historyEntry(actor, 'cancelled', reason)] });
}

export async function deleteDraft(actor: Actor, kind: DocKind, id: string): Promise<void> {
  const doc = await tableOfKind(kind).get(id);
  if (!doc || (doc as DocBase & { status: string }).status !== 'draft') throw new PermissionError('Only drafts can be deleted');
  await deleteRecord(kind === 'invoice' ? 'invoices' : kind === 'estimate' ? 'estimates' : 'creditNotes', actor, id);
}

export async function setEstimateStatus(actor: Actor, id: string, status: 'open' | 'accepted' | 'declined'): Promise<void> {
  const est = await db.estimates.get(id);
  if (!est || est.status === 'draft' || est.status === 'converted') return;
  await putRecord('estimates', actor, { ...est, status, history: [...est.history, historyEntry(actor, status)] });
}

/** Blank document with business defaults applied. */
export async function blankDoc(actor: Actor): Promise<Omit<DocBase, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>> {
  const s = await settingsOf(actor.businessId);
  const profile = await db.profiles.get(actor.businessId);
  const defaultBank = (await db.bankAccounts.where('businessId').equals(actor.businessId).toArray()).find((b) => b.isDefault && !b.deleted);
  const defaultUpi = (await db.upiIds.where('businessId').equals(actor.businessId).toArray()).find((u) => u.isDefault && !u.deleted);
  const date = todayISO();
  const base = {
    number: '',
    date,
    taxMode: defaultTaxMode(effectiveGstType(profile)),
    placeOfSupply: null,
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
    taxMode: est.taxMode ?? draft.taxMode,
    placeOfSupply: est.placeOfSupply ?? null,
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
      // Keep a non-GST bill a non-GST bill (only possible while the store is registered).
      taxMode: draft.taxMode === 'gst' && src.taxMode === 'none' ? 'none' : draft.taxMode,
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

/** What the customer still owes on an invoice: total less credit notes and payments. */
export function pendingAmount(inv: Invoice): number {
  if (inv.status !== 'saved') return 0;
  return Math.max(0, inv.totals.grandTotal - (inv.credited ?? 0) - inv.payment.amountPaid);
}

export function isOverdue(inv: Invoice, today = todayISO()): boolean {
  return inv.status === 'saved' && pendingAmount(inv) > 0 && !!inv.dueDate && inv.dueDate < today;
}

/* ---------- credit notes ---------- */
/*
 * A credit note reduces a saved invoice: goods returned or a price cut. It copies the invoice's
 * customer, GST mode and place of supply; the owner edits quantities or removes lines. Saved
 * notes add up in invoice.credited, which lowers what the customer owes. Owner only.
 */

/** How much of an invoice can still be credited, leaving out `exceptNoteId` (the note being edited). */
export async function creditableAmount(invoiceId: string, exceptNoteId?: string): Promise<number> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) return 0;
  const notes = await db.creditNotes.where('invoiceId').equals(invoiceId).toArray();
  const used = notes.filter((n) => n.id !== exceptNoteId && n.status === 'saved' && !n.deleted).reduce((a, n) => a + n.totals.grandTotal, 0);
  return Math.max(0, inv.totals.grandTotal - used);
}

export async function newCreditNoteDraft(actor: Actor, invoiceId: string): Promise<CreditNote> {
  if (actor.role !== 'owner') throw new PermissionError('Only the owner can make credit notes');
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') throw new PermissionError('Credit notes are made against a saved invoice');
  if ((await creditableAmount(invoiceId)) <= 0) throw new PermissionError('This invoice is already fully credited');
  const now = nowIso();
  const profile = await db.profiles.get(actor.businessId);
  const totalsBase = {
    lines: inv.lines.map((l) => ({ ...l, id: newId() })),
    // A percentage discount still applies to what is returned; a fixed amount or final amount would not.
    overallDiscount: inv.overallDiscount?.type === 'pct' ? inv.overallDiscount : null,
    targetTotal: null,
    charges: [],
    roundOff: inv.roundOff,
    taxMode: inv.taxMode,
  };
  return {
    ...totalsBase,
    id: newId(),
    businessId: actor.businessId,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.userId,
    status: 'draft',
    number: '',
    date: todayISO(),
    placeOfSupply: inv.taxMode === 'gst' ? (inv.placeOfSupply ?? placeOfSupplyOf(inv, profile) ?? null) : null,
    customFields: [],
    billTo: inv.billTo,
    shipTo: inv.shipTo,
    notes: '',
    terms: '',
    bankAccountId: null,
    upiIdId: null,
    totals: computeTotals(totalsBase),
    createdBy: actor.userId,
    history: [],
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    invoiceDate: inv.date,
    reason: 'return',
  };
}

export async function saveCreditNote(actor: Actor, note: CreditNote, opts: { finalize: boolean }): Promise<CreditNote> {
  if (actor.role !== 'owner') throw new PermissionError('Only the owner can make credit notes');
  const existing = await db.creditNotes.get(note.id);
  if (existing?.status === 'cancelled') throw new PermissionError('Cancelled credit notes cannot be edited');
  const next: CreditNote = { ...note, totals: computeTotals(note), history: [...(existing?.history ?? note.history ?? [])] };
  const finalizing = opts.finalize && next.status === 'draft';
  if (finalizing || next.status === 'saved') {
    const room = await creditableAmount(next.invoiceId, next.id);
    if (next.totals.grandTotal > room) throw new PermissionError(`The credit note can be at most ₹${(room / 100).toFixed(2)} (the invoice total less earlier credit notes)`);
  }
  if (!existing) next.history.push(historyEntry(actor, 'created'));
  if (finalizing) {
    Object.assign(next, await numberFor('credit', actor.businessId, next));
    next.status = 'saved';
    next.businessSnapshot = await snapshotBusiness(actor.businessId);
    next.history.push(historyEntry(actor, 'saved', next.number));
  } else if (existing && existing.status === 'saved') {
    next.history.push(historyEntry(actor, 'edited'));
  }
  const saved = await putRecord('creditNotes', actor, next);
  if (saved.status === 'saved') await refreshCredited(actor, saved.invoiceId, `${saved.number} ₹${(saved.totals.grandTotal / 100).toFixed(2)}`);
  return saved;
}

export async function cancelCreditNote(actor: Actor, id: string, reason?: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError('Only the owner can cancel a credit note');
  const note = await db.creditNotes.get(id);
  if (!note || note.status !== 'saved') return;
  await putRecord('creditNotes', actor, { ...note, status: 'cancelled', history: [...note.history, historyEntry(actor, 'cancelled', reason)] });
  await refreshCredited(actor, note.invoiceId, `${note.number} cancelled`);
}

/** Recomputes invoice.credited from its saved credit notes. */
async function refreshCredited(actor: Actor, invoiceId: string, detail: string) {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) return;
  const notes = await db.creditNotes.where('invoiceId').equals(invoiceId).toArray();
  const credited = notes.filter((n) => n.status === 'saved' && !n.deleted).reduce((a, n) => a + n.totals.grandTotal, 0);
  if (credited === (inv.credited ?? 0)) return;
  await putRecord('invoices', actor, {
    ...inv,
    credited,
    payment: normalisePayment(inv.payment, inv.totals.grandTotal, credited),
    history: [...inv.history, historyEntry(actor, 'credit note', detail)],
  });
}
