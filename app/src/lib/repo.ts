import { DEFAULT_NUMBER_PATTERN, calculateInvoice, financialYearLabel, formatNumber, gstinState, parseDocNumber, parseSeriesKey, seriesKey, resolvePlaceOfSupply, stateCode, todayISO, type GstType, type InvoiceTotals, type NumberSeries, type TaxMode, billLocked, type StaffAccess } from '@invoice/shared';
import type { Table } from 'dexie';
import { t } from './i18n';
import { buildLedger, moneyOf, type BillMoney } from './ledger';
import {
  db,
  setMeta,
  getMeta,
  type Address,
  type BusinessProfile,
  type BusinessSettings,
  type CreditNote,
  type DesignSettings,
  type PaymentEntry,
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
  /** Letter of this person's own number series in the store ("" / missing for the owner). */
  seriesCode?: string;
  /** Staff: most discount % allowed on a bill (missing / 100 = no limit). */
  maxDiscountPct?: number;
  /** Staff: full, warehouse (deliveries only) or read-only (accountant). */
  access?: StaffAccess;
  /** Staff allowed to cancel saved bills. */
  cancelBills?: boolean;
}

/** Locked old bill: payments and notes only (the store's lock setting). */
export async function assertNotLocked(actor: Actor, doc: { status: string; date: string } | undefined): Promise<void> {
  if (!doc || doc.status !== 'saved') return;
  const s = await settingsOf(actor.businessId);
  if (billLocked(doc.date, { afterDays: s.lockBillsAfterDays, until: s.booksClosedUntil }, todayISO())) {
    throw new PermissionError(t('This bill is locked (its period is closed). Make a credit note instead.'));
  }
}

/**
 * The biggest discount on a bill as a % of its value before discounts: each line's own discount,
 * and the discount on the whole bill. Discounts from offers (set by the owner) don't count.
 */
export function biggestDiscountPct(doc: Pick<DocBase, 'lines' | 'overallDiscount' | 'charges' | 'roundOff' | 'targetTotal' | 'taxMode'>): number {
  const totals = computeTotals(doc);
  let most = 0;
  doc.lines.forEach((l, i) => {
    const r = totals.lines[i];
    if (!r || !r.gross || l.offer) return;
    most = Math.max(most, (r.lineDiscount / r.gross) * 100);
  });
  const net = totals.lines.reduce((a, r) => a + r.net, 0);
  const overall = totals.lines.reduce((a, r) => a + r.overallShare, 0);
  if (net > 0) most = Math.max(most, (overall / net) * 100);
  return Math.round(most * 100) / 100;
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
  if (actor.role !== 'owner' && actor.access === 'readonly') throw new PermissionError(t('This login can only view the books'));
  if (actor.role !== 'owner' && actor.access === 'warehouse' && name !== 'invoices' && name !== 'estimates') throw new PermissionError(t('The warehouse login only marks deliveries'));
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
    mrpColumn: false,
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
    // Short enough for staff numbers like BOS-B/26-27/0001 to stay within GST's 16 characters.
    billPrefix: 'BOS',
    estimatePrefix: 'EST',
    creditNotePrefix: 'CN',
    numberPattern: DEFAULT_NUMBER_PATTERN,
    numberDigits: 4,
    numberingMode: 'perPerson',
    areaBilling: false,
    deliveryAlertTime: '09:00',
    staffSeeCost: false,
    staffMustLock: false,
    creditLimitBlocks: false,
    challanPrefix: 'DC',
    billLanguage: 'en',
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
  const legacyPattern = !stored.numberPattern && stored.resetEachFinancialYear === false ? '{PREFIX}-{CODE}/{SEQ}' : undefined;
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
 * Two ways to number tax invoices, bills and credit notes (Invoice settings):
 *  - perPerson (default): each person has their own series (the owner's has no letter, staff
 *    member B gets INV-B/…). The phone numbers them itself, so offline saving never runs out.
 *    The phone continues after the highest number it has seen in its series (its own saves and
 *    everything pulled from the server, so a new phone carries on where the old one stopped).
 *  - shared: one series for everyone. Each phone holds a block from the server sized to its own
 *    use (about 3 days, 20–200) and uses it first, online or not; unused numbers go back on logout.
 * Estimates always use one shared series.
 * Tests run without a server: shared series then count locally too.
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

/** Highest number this phone has used or seen in a series ("invoice-B:26-27"). */
export const localCounterKey = (businessId: string, key: string) => `seq:${businessId}:${key}`;

/** Which series a document is numbered in. A regular GST store numbers non-GST bills separately. */
export function seriesOf(kind: DocKind, taxMode: TaxMode | undefined, gstType: GstType): NumberSeries {
  if (kind !== 'invoice') return kind;
  return gstType === 'regular' && taxMode === 'none' ? 'bill' : 'invoice';
}

/** True when this series is numbered per person on the phone. */
export const isPersonalSeries = (s: BusinessSettings, series: NumberSeries) => s.numberingMode !== 'shared' && series !== 'estimate';

/** The letter a person's numbers carry in this series ("" for the owner and for shared series). */
export const codeFor = (s: BusinessSettings, series: NumberSeries, actor: Pick<Actor, 'seriesCode'>) => (isPersonalSeries(s, series) ? (actor.seriesCode ?? '') : '');

export function prefixOf(s: BusinessSettings, series: NumberSeries): string {
  return { invoice: s.invoicePrefix, bill: s.billPrefix, estimate: s.estimatePrefix, credit: s.creditNotePrefix, challan: s.challanPrefix || 'DC' }[series];
}

export function formatDocNumber(s: BusinessSettings, series: NumberSeries, date: string, seq: number, code = ''): string {
  let pattern = s.numberPattern;
  // Safety net: a staff letter must always show, or two people could print the same number.
  if (code && !pattern.includes('{CODE}')) pattern = pattern.includes('{PREFIX}') ? pattern.replace('{PREFIX}', '{PREFIX}-{CODE}') : `{CODE}-${pattern}`;
  return formatNumber(pattern, prefixOf(s, series), financialYearLabel(date), date, seq, s.numberDigits, code);
}

/** Remembers that `seq` is used in a series, so this phone never hands it out again. */
export async function noteUsedNumber(businessId: string, key: string, seq: number): Promise<void> {
  const k = localCounterKey(businessId, key);
  if (((await getMeta<number>(k)) ?? 0) < seq) await setMeta(k, seq);
}

/** Peek at the number the next saved document will get (shown in the editor; not reserved). */
export async function previewNextNumber(series: NumberSeries, actor: Pick<Actor, 'businessId' | 'seriesCode'>, date: string): Promise<string> {
  const s = await settingsOf(actor.businessId);
  const period = seriesPeriod(date, s.resetEachFinancialYear);
  const code = codeFor(s, series, actor);
  if (allocator && !isPersonalSeries(s, series)) {
    const pool = (await getMeta<number[]>(numberPoolKey(actor.businessId, series, period))) ?? [];
    return pool.length ? formatDocNumber(s, series, date, pool[0]!) : '';
  }
  const key = seriesKey(series, code, period);
  const last = (await getMeta<number>(localCounterKey(actor.businessId, key))) ?? (await highestOnPhone(actor.businessId, series, key));
  return formatDocNumber(s, series, date, last + 1, code);
}

/* --- how many numbers this phone uses per day, to size its block of a shared series --- */
const usageKey = (businessId: string, series: NumberSeries) => `numuse:${businessId}:${series}`;
const USAGE_DAYS = 7;

async function recordUse(businessId: string, series: NumberSeries) {
  const today = todayISO();
  const days = (await getMeta<Record<string, number>>(usageKey(businessId, series))) ?? {};
  days[today] = (days[today] ?? 0) + 1;
  const keep = Object.keys(days).sort().slice(-USAGE_DAYS);
  await setMeta(usageKey(businessId, series), Object.fromEntries(keep.map((d) => [d, days[d]!])));
}

export const MIN_BLOCK = 20;
export const MAX_BLOCK = 200;

/** Numbers to keep on this phone for a shared series: about 3 days of its own use, 20–200. */
export async function blockTarget(businessId: string, series: NumberSeries): Promise<number> {
  const days = (await getMeta<Record<string, number>>(usageKey(businessId, series))) ?? {};
  const perDay = Object.values(days).reduce((a, b) => a + b, 0) / USAGE_DAYS;
  return Math.min(MAX_BLOCK, Math.max(MIN_BLOCK, Math.ceil(perDay * 3)));
}

async function nextSeq(s: BusinessSettings, series: NumberSeries, actor: Pick<Actor, 'businessId' | 'seriesCode'>, period: string): Promise<number> {
  const businessId = actor.businessId;
  const key = seriesKey(series, codeFor(s, series, actor), period);
  if (isPersonalSeries(s, series) || !allocator) {
    const seq = ((await getMeta<number>(localCounterKey(businessId, key))) ?? (await highestOnPhone(businessId, series, key))) + 1;
    await setMeta(localCounterKey(businessId, key), seq);
    return seq;
  }
  // Shared series: this phone's block first (keeps numbers dense), then straight from the server.
  const poolKey = numberPoolKey(businessId, series, period);
  const pool = (await getMeta<number[]>(poolKey)) ?? [];
  let seq = pool.shift();
  if (seq != null) await setMeta(poolKey, pool);
  else seq = (await allocator(businessId, series, period).catch(() => null)) ?? undefined;
  if (seq == null) {
    const messages: Record<NumberSeries, () => string> = {
      invoice: () => t('No invoice numbers left on this phone. Connect to the internet once to get more, or save it as a draft for now.'),
      bill: () => t('No bill numbers left on this phone. Connect to the internet once to get more, or save it as a draft for now.'),
      estimate: () => t('No estimate numbers left on this phone. Connect to the internet once to get more, or save it as a draft for now.'),
      credit: () => t('No credit note numbers left on this phone. Connect to the internet once to get more, or save it as a draft for now.'),
      challan: () => t('No challan numbers left on this phone. Connect to the internet once to get more, or save it as a draft for now.'),
    };
    throw new NumberingError(messages[series]());
  }
  await recordUse(businessId, series);
  return seq;
}

/**
 * Highest number of a series among documents already on this phone. Starts the counter on a
 * phone that had documents before it kept one (an app update, or before its first save).
 */
async function highestOnPhone(businessId: string, series: NumberSeries, key: string): Promise<number> {
  const { code, period } = parseSeriesKey(key)!;
  const docs = await tableOfKind(series === 'bill' ? 'invoice' : series === 'challan' ? 'estimate' : series).where('businessId').equals(businessId).toArray();
  let max = 0;
  for (const d of docs) {
    if (d.numberSeries === key && d.numberSeq) max = Math.max(max, d.numberSeq);
    else if (!d.numberSeries && !code && d.number && series !== 'bill') {
      // Saved before documents recorded their series: read it from the number.
      const p = parseDocNumber(d.number);
      if (p && p.period === period) max = Math.max(max, p.seq);
    }
  }
  return max;
}

const tableOfKind = (kind: DocKind) => (kind === 'invoice' ? db.invoices : kind === 'estimate' ? db.estimates : db.creditNotes) as unknown as Table<DocBase, string>;

async function takeNextNumber(kind: DocKind, series: NumberSeries, actor: Pick<Actor, 'businessId' | 'seriesCode'>, date: string): Promise<Pick<DocBase, 'number' | 'numberSeries' | 'numberSeq'>> {
  const s = await settingsOf(actor.businessId);
  const period = seriesPeriod(date, s.resetEachFinancialYear);
  const code = codeFor(s, series, actor);
  // Skip numbers already used on this phone (e.g. typed by hand).
  for (let tries = 0; tries < 50; tries++) {
    const seq = await nextSeq(s, series, actor, period);
    const number = formatDocNumber(s, series, date, seq, code);
    if (!(await tableOfKind(kind).where('[businessId+number]').equals([actor.businessId, number]).count())) {
      return { number, numberSeries: seriesKey(series, code, period), numberSeq: seq };
    }
  }
  throw new NumberingError(t('Could not find a free number. Please try again.'));
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

async function numberFor(kind: DocKind, actor: Actor, doc: DocBase): Promise<Pick<DocBase, 'number' | 'numberSeries' | 'numberSeq'>> {
  if (doc.number) return { number: doc.number, numberSeries: doc.numberSeries, numberSeq: doc.numberSeq };
  const gstType = effectiveGstType(await db.profiles.get(actor.businessId));
  return takeNextNumber(kind, seriesOf(kind, doc.taxMode, gstType), actor, doc.date);
}

/**
 * Save an invoice. `finalize` = true turns a draft into a saved invoice (assigns a number,
 * freezes business details). Staff may not edit an invoice once it is saved.
 */
export async function saveInvoice(actor: Actor, inv: Invoice, opts: { finalize: boolean; editNote?: string }): Promise<Invoice> {
  if (opts.finalize && actor.role === 'staff' && (actor.maxDiscountPct ?? 100) < 100 && biggestDiscountPct(inv) > (actor.maxDiscountPct ?? 100) + 0.001) {
    throw new PermissionError(t('Discount above {pct}% needs the owner', { pct: actor.maxDiscountPct ?? 100 }));
  }
  const existing = await db.invoices.get(inv.id);
  if (existing && existing.status !== 'draft' && actor.role !== 'owner') throw new PermissionError(t('Only the owner can edit a saved invoice'));
  if (existing?.status === 'cancelled') throw new PermissionError(t('Cancelled invoices cannot be edited'));
  await assertNotLocked(actor, existing);

  let next: Invoice = { ...inv, history: [...(existing?.history ?? inv.history ?? [])] };
  const finalizing = opts.finalize && next.status === 'draft';
  if (finalizing) next = await settleGst(actor.businessId, next);
  const totals = computeTotals(next);
  next.totals = totals;
  if (!existing) next.history.push(historyEntry(actor, 'created'));

  if (finalizing) {
    Object.assign(next, await numberFor('invoice', actor, next));
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
    throw new PermissionError(t('Only the owner can edit this estimate'));
  }
  let next: Estimate = { ...est, history: [...(existing?.history ?? est.history ?? [])] };
  const finalizing = opts.finalize && next.status === 'draft';
  if (finalizing) next = await settleGst(actor.businessId, next);
  next.totals = computeTotals(next);
  if (!existing) next.history.push(historyEntry(actor, 'created'));
  if (finalizing) {
    Object.assign(next, next.challan && !next.number ? await takeNextNumber('estimate', 'challan', actor, next.date) : await numberFor('estimate', actor, next));
    next.status = 'open';
    next.businessSnapshot = await snapshotBusiness(actor.businessId);
    next.history.push(historyEntry(actor, 'saved', next.number));
  } else if (existing && existing.status !== 'draft') {
    next.history.push(historyEntry(actor, 'edited'));
  }
  return putRecord('estimates', actor, next);
}

/* ---------- payments ---------- */
/*
 * Each payment (or refund) is its own record: added, never edited; the owner voids a mistake.
 * Several entries saved together make a split payment (cash + UPI).
 */

export interface NewPayment {
  amount: number;
  mode: PaymentEntry['mode'];
  reference?: string;
  note?: string;
}

/** Money on one bill right now (from the local copy of its entries and credit notes). */
export async function billMoney(invoiceId: string): Promise<BillMoney> {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) throw new Error(t('Invoice not found'));
  const [payments, notes] = await Promise.all([db.payments.where('invoiceId').equals(invoiceId).toArray(), db.creditNotes.where('invoiceId').equals(invoiceId).toArray()]);
  return moneyOf(inv, buildLedger(payments, notes));
}

/**
 * Records money received for a bill (or, with kind 'refund', paid back after a return). Payments
 * can't add up to more than is pending; refunds not more than was overpaid.
 */
export async function recordPayments(
  actor: Actor,
  invoiceId: string,
  parts: NewPayment[],
  opts: { date?: string; kind?: 'payment' | 'refund'; creditNoteId?: string } = {},
): Promise<PaymentEntry[]> {
  const kind = opts.kind ?? 'payment';
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') throw new PermissionError(t('Money can only be recorded on a saved invoice'));
  const lines = parts.filter((p) => p.amount > 0).map((p) => ({ ...p, amount: Math.round(p.amount) }));
  if (!lines.length) throw new PermissionError(t('Enter an amount'));
  const total = lines.reduce((a, p) => a + p.amount, 0);
  const money = await billMoney(invoiceId);
  const limit = kind === 'payment' ? money.pending : money.refundDue;
  if (total > limit) {
    throw new PermissionError(
      kind === 'payment'
        ? t('Only {amount} is pending on this bill', { amount: `₹${(limit / 100).toFixed(2)}` })
        : t('Only {amount} can be refunded on this bill', { amount: `₹${(limit / 100).toFixed(2)}` }),
    );
  }
  const date = opts.date ?? todayISO();
  const saved: PaymentEntry[] = [];
  for (const p of lines) {
    saved.push(
      await putRecord('payments', actor, {
        id: newId(),
        invoiceId,
        creditNoteId: opts.creditNoteId ?? null,
        kind,
        amount: p.amount,
        mode: p.mode,
        date,
        reference: p.reference?.trim() || undefined,
        note: p.note?.trim() || undefined,
        receivedBy: actor.userId,
        receivedByName: actor.userName,
        ...(p.mode === 'cheque' && kind === 'payment' ? { chequeStatus: 'pending' as const } : {}),
      }),
    );
  }
  return saved;
}

/** Owner only: marks an entry as a mistake. It stays in the history, crossed out. */
export async function voidPayment(actor: Actor, paymentId: string, reason: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can void a payment'));
  const p = await db.payments.get(paymentId);
  if (!p || p.voidedAt) return;
  await putRecord('payments', actor, { ...p, voidedAt: nowIso(), voidedBy: actor.userId, voidedByName: actor.userName, voidReason: reason.trim() || 'Voided' });
}

/**
 * Bills saved before R1.4 kept one paid amount on the invoice; turn it into a payment entry once.
 * The entry's id comes from the invoice, so every phone doing this creates the same record.
 */
export async function convertLegacyPayments(actor: Actor): Promise<number> {
  const invoices = await db.invoices.where('businessId').equals(actor.businessId).toArray();
  let made = 0;
  for (const inv of invoices) {
    const amount = inv.payment?.amountPaid ?? 0;
    if (inv.deleted || inv.status === 'draft' || amount <= 0) continue;
    const id = `legacy-${inv.id}`;
    if (await db.payments.get(id)) continue;
    await putRecord('payments', actor, {
      id,
      invoiceId: inv.id,
      creditNoteId: null,
      kind: 'payment' as const,
      amount,
      mode: inv.payment?.mode ?? 'other',
      date: inv.payment?.date ?? inv.date,
      note: 'Recorded before payment entries',
      receivedBy: inv.updatedBy,
      receivedByName: '',
      createdAt: inv.updatedAt,
    });
    made++;
  }
  return made;
}

export async function cancelInvoice(actor: Actor, invoiceId: string, reason?: string): Promise<void> {
  if (actor.role !== 'owner' && !actor.cancelBills) throw new PermissionError(t('Only the owner can cancel an invoice'));
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') return;
  await assertNotLocked(actor, inv);
  const money = await billMoney(invoiceId);
  if (money.credited > 0) throw new PermissionError(t('Cancel its credit notes first'));
  if (money.paid > 0) throw new PermissionError(t('Void or refund its payments first'));
  await putRecord('invoices', actor, { ...inv, status: 'cancelled', history: [...inv.history, historyEntry(actor, 'cancelled', reason)] });
}

export async function deleteDraft(actor: Actor, kind: DocKind, id: string): Promise<void> {
  const doc = await tableOfKind(kind).get(id);
  if (!doc || (doc as DocBase & { status: string }).status !== 'draft') throw new PermissionError(t('Only drafts can be deleted'));
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
  if (!est) throw new Error(t('Estimate not found'));
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
  if (!src) throw new Error(t('Invoice not found'));
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

/* ---------- credit notes ---------- */
/*
 * A credit note reduces a saved invoice: goods returned or a price cut. It copies the invoice's
 * customer, GST mode and place of supply; quantities can be edited or lines removed. Saved notes
 * lower what the customer owes (see ledger.ts); money already paid can then be refunded.
 * Anyone may take a return on any bill; price cuts, other corrections, editing a saved note and
 * cancelling are the owner's.
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
  const inv = await db.invoices.get(invoiceId);
  if (!inv || inv.status !== 'saved') throw new PermissionError(t('Credit notes are made against a saved invoice'));
  if ((await creditableAmount(invoiceId)) <= 0) throw new PermissionError(t('This invoice is already fully credited'));
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
  if (opts.finalize && actor.role !== 'owner' && note.reason === 'return' && note.lines.some((l) => l.nonReturnable && l.qty > 0)) {
    throw new PermissionError(t('Non-returnable items: only the owner can take them back'));
  }
  const existing = await db.creditNotes.get(note.id);
  if (actor.role !== 'owner') {
    if (note.reason !== 'return') throw new PermissionError(t('Only the owner can make this credit note'));
    if (existing && existing.status !== 'draft') throw new PermissionError(t('Only the owner can change a saved credit note'));
  }
  if (existing?.status === 'cancelled') throw new PermissionError(t('Cancelled credit notes cannot be edited'));
  await assertNotLocked(actor, existing);
  const next: CreditNote = { ...note, totals: computeTotals(note), history: [...(existing?.history ?? note.history ?? [])] };
  const finalizing = opts.finalize && next.status === 'draft';
  if (finalizing || next.status === 'saved') {
    const room = await creditableAmount(next.invoiceId, next.id);
    if (next.totals.grandTotal > room) throw new PermissionError(t('The credit note can be at most {amount} (the invoice total less earlier credit notes)', { amount: `₹${(room / 100).toFixed(2)}` }));
  }
  if (!existing) next.history.push(historyEntry(actor, 'created'));
  if (finalizing) {
    Object.assign(next, await numberFor('credit', actor, next));
    next.status = 'saved';
    next.businessSnapshot = await snapshotBusiness(actor.businessId);
    next.history.push(historyEntry(actor, 'saved', next.number));
  } else if (existing && existing.status === 'saved') {
    next.history.push(historyEntry(actor, 'edited'));
  }
  const saved = await putRecord('creditNotes', actor, next);
  if (finalizing) await noteOnInvoice(actor, saved.invoiceId, 'credit note', `${saved.number} ₹${(saved.totals.grandTotal / 100).toFixed(2)}`);
  return saved;
}

export async function cancelCreditNote(actor: Actor, id: string, reason?: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can cancel a credit note'));
  const note = await db.creditNotes.get(id);
  if (!note || note.status !== 'saved') return;
  await assertNotLocked(actor, note);
  await putRecord('creditNotes', actor, { ...note, status: 'cancelled', history: [...note.history, historyEntry(actor, 'cancelled', reason)] });
  await noteOnInvoice(actor, note.invoiceId, 'credit note', `${note.number} cancelled`);
}

/** Adds a line to the invoice's history (allowed for staff: only `history` changes). */
async function noteOnInvoice(actor: Actor, invoiceId: string, action: string, detail: string) {
  const inv = await db.invoices.get(invoiceId);
  if (!inv) return;
  await putRecord('invoices', actor, { ...inv, history: [...inv.history, historyEntry(actor, action, detail)] });
}
