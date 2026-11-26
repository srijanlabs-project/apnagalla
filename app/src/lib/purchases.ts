import { calculateInvoice, checkGstin, financialYearLabel, gstinState, splitGst, stateName, todayISO, type InvoiceTotals } from '@invoice/shared';
import type { ScannedBillDto } from './api';
import {
  db,
  getMeta,
  setMeta,
  type Expense,
  type HistoryEntry,
  type Item,
  type Purchase,
  type PurchaseLine,
  type PurchaseOrder,
  type Supplier,
  type SupplierPayment,
  type SupplierSnapshot,
} from './db';
import type { ExportTable } from './exportTable';
import { addressLines } from './format';
import { t } from './i18n';
import { PermissionError, effectiveGstType, newId, putRecord, storeStateCode, type Actor, assertNotLocked } from './repo';
import { setOpeningStock } from './stock';
import { withPriceHistory } from './pricing';

/* ---------- suppliers ---------- */

export function blankSupplier(actor: Actor, name = ''): Supplier {
  return { id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', name, address: {}, openingBalance: 0 };
}

export const supplierSnapshot = (s: Supplier): SupplierSnapshot => ({ supplierId: s.id, name: s.name, phone: s.phone, address: s.address, taxId: s.taxId });

/* ---------- purchase orders ---------- */

/** PO/26-27/A7: the person's own letter keeps numbers from two phones apart, no server needed. */
export async function nextPoNumber(actor: Actor, date = todayISO()): Promise<string> {
  const fy = financialYearLabel(date);
  const code = actor.seriesCode ?? '';
  const prefix = `PO/${fy}/${code}`;
  const key = `po:${actor.businessId}:${prefix}`;
  // Also look at orders already synced (e.g. after reinstalling), so a number is never repeated.
  const used = await db.purchaseOrders.where('businessId').equals(actor.businessId).filter((o) => o.number.startsWith(prefix)).toArray();
  const fromOrders = Math.max(0, ...used.map((o) => Number(o.number.slice(prefix.length)) || 0));
  const next = Math.max((await getMeta<number>(key)) ?? 0, fromOrders) + 1;
  await setMeta(key, next);
  return `${prefix}${next}`;
}

export async function newPurchaseOrder(actor: Actor, supplier: Supplier | null, lines: PurchaseOrder['lines']): Promise<PurchaseOrder> {
  const date = todayISO();
  return {
    id: newId(),
    businessId: actor.businessId,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    number: await nextPoNumber(actor, date),
    date,
    supplier: supplier ? supplierSnapshot(supplier) : null,
    lines,
    notes: '',
    status: 'open',
    createdBy: actor.userId,
    byName: actor.userName,
  };
}

export async function poTable(order: PurchaseOrder): Promise<ExportTable> {
  const supplier = order.supplier?.supplierId ? await db.suppliers.get(order.supplier.supplierId) : null;
  const s = supplier ?? order.supplier;
  return {
    title: t('Purchase order {number}', { number: order.number }),
    subtitle: [t('Date: {date}', { date: order.date.split('-').reverse().join('/') })],
    party: s ? { heading: t('To'), lines: [s.name, ...addressLines(s.address), s.phone ?? '', s.taxId ? `GSTIN: ${s.taxId}` : ''].filter(Boolean) } : undefined,
    columns: [{ label: '#', width: 20 }, { label: t('Item') }, { label: t('Quantity'), kind: 'qty' }, { label: t('Unit'), width: 'auto' }],
    rows: order.lines.map((l, i) => [i + 1, l.name, l.qty, l.unit]),
    after: order.notes ? [order.notes] : [],
    fileBase: `Purchase-order-${order.number}`,
  };
}

/* ---------- purchase bills and returns ---------- */

/** Totals of a purchase; a bill without GST has no tax. */
export function purchaseTotals(p: Pick<Purchase, 'lines' | 'overallDiscount' | 'charges' | 'roundOff' | 'taxMode'>): InvoiceTotals {
  const noTax = p.taxMode === 'none';
  return calculateInvoice({
    lines: noTax ? p.lines.map((l) => ({ ...l, taxPct: 0, rateIncludesTax: false })) : p.lines,
    overallDiscount: p.overallDiscount,
    charges: noTax ? p.charges.map((c) => ({ ...c, taxPct: 0 })) : p.charges,
    roundOff: p.roundOff,
  });
}

/** "CGST 120.00, SGST 120.00" or "IGST 240.00" lines for a purchase's tax. */
export function taxLines(p: Pick<Purchase, 'totals' | 'taxMode' | 'interState'>): { label: string; amount: number }[] {
  if (p.taxMode !== 'gst' || !p.totals.taxTotal) return [];
  const g = splitGst(p.totals, p.interState);
  return p.interState ? [{ label: 'IGST', amount: g.igst }] : [{ label: 'CGST', amount: g.cgst }, { label: 'SGST', amount: g.sgst }];
}

/** IGST when the supplier is registered in another state. */
export async function isInterState(businessId: string, supplierTaxId?: string): Promise<boolean> {
  const theirs = gstinState(supplierTaxId);
  const ours = storeStateCode(await db.profiles.get(businessId));
  return !!theirs && !!ours && theirs !== ours;
}

export function purchaseLineFromItem(item: Item, qty = 1): PurchaseLine {
  return {
    id: newId(),
    itemId: item.id,
    name: item.name,
    qty,
    unit: item.unit,
    rate: item.purchasePrice ?? 0,
    rateIncludesTax: false,
    taxPct: item.taxPct,
    hsn: item.hsn,
    mrp: item.mrp,
  };
}

export async function newPurchaseDraft(actor: Actor, opts: { supplier?: Supplier | null; order?: PurchaseOrder | null; returnOf?: Purchase | null } = {}): Promise<Purchase> {
  const profile = await db.profiles.get(actor.businessId);
  const regular = effectiveGstType(profile) === 'regular';
  const supplier = opts.supplier ?? (opts.returnOf?.supplier?.supplierId ? await db.suppliers.get(opts.returnOf.supplier.supplierId) : null) ?? (opts.order?.supplier?.supplierId ? await db.suppliers.get(opts.order.supplier.supplierId) : null);
  let lines: PurchaseLine[] = [];
  if (opts.returnOf) lines = opts.returnOf.lines.map((l) => ({ ...l, id: newId() }));
  else if (opts.order) {
    const items = await db.items.bulkGet(opts.order.lines.map((l) => l.itemId ?? ''));
    lines = opts.order.lines.map((l, i) => {
      const it = items[i];
      return it && !it.deleted
        ? { ...purchaseLineFromItem(it, l.qty), rate: l.rate ?? it.purchasePrice ?? 0 }
        : { id: newId(), name: l.name, qty: l.qty, unit: l.unit, rate: l.rate ?? 0, rateIncludesTax: false, taxPct: 0 };
    });
  }
  const taxMode = opts.returnOf?.taxMode ?? (supplier?.taxId || regular ? 'gst' : 'none');
  const draft: Purchase = {
    id: newId(),
    businessId: actor.businessId,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    kind: opts.returnOf ? 'return' : 'bill',
    status: 'draft',
    supplier: supplier && !supplier.deleted ? supplierSnapshot(supplier) : (opts.returnOf?.supplier ?? null),
    supplierBillNo: '',
    date: todayISO(),
    dueDate: null,
    taxMode,
    interState: await isInterState(actor.businessId, supplier?.taxId),
    lines,
    overallDiscount: null,
    charges: [],
    roundOff: true,
    totals: purchaseTotals({ lines, charges: [], roundOff: true, taxMode, overallDiscount: null }),
    notes: '',
    updatePrices: !opts.returnOf,
    fromOrderId: opts.order?.id ?? null,
    returnOfId: opts.returnOf?.id ?? null,
    photo: null,
    createdBy: actor.userId,
    history: [],
  };
  return draft;
}

const entry = (actor: Actor, action: string, detail?: string): HistoryEntry => ({ at: new Date().toISOString(), by: actor.userId, byName: actor.userName, action, detail });

/** Cost per unit before tax, for the item's purchase price. */
const unitCost = (l: PurchaseLine) => Math.round((l.rateIncludesTax && l.taxPct ? l.rate / (1 + l.taxPct / 100) : l.rate) / (l.unitFactor ?? 1));

/**
 * Landed cost per base unit: the line's cost before tax plus its share of the bill's charges
 * (freight, loading…), shared by value. With `spreadCharges` off, or no charges, the plain cost.
 */
export function landedCosts(p: Pick<Purchase, 'lines' | 'charges' | 'spreadCharges' | 'taxMode' | 'interState' | 'overallDiscount' | 'roundOff'>): number[] {
  const charges = (p.charges ?? []).reduce((a, c) => a + (c.amount || 0), 0);
  if (!charges || p.spreadCharges === false) return p.lines.map(unitCost);
  const totals = purchaseTotals(p as Purchase);
  const taxable = p.lines.map((l, i) => totals.lines[i]?.taxable ?? Math.round(unitCost(l) * l.qty * (l.unitFactor ?? 1)));
  const all = taxable.reduce((a, v) => a + v, 0) || 1;
  return p.lines.map((l, i) => {
    const units = l.qty * (l.unitFactor ?? 1);
    return units > 0 ? Math.round((taxable[i]! + (charges * taxable[i]!) / all) / units) : unitCost(l);
  });
}

export interface SupplierDue {
  purchase: Purchase;
  supplierName: string;
  /** What is still unpaid on this bill (supplier payments settle the opening balance, then the oldest bills). */
  unpaid: number;
  dueDate: string;
  daysLate: number;
}

/** Purchase bills with a pay-by date and money still unpaid, the most urgent first. */
export async function supplierDues(businessId: string, today = todayISO()): Promise<SupplierDue[]> {
  const [suppliers, purchases, pays] = await Promise.all([
    db.suppliers.where('businessId').equals(businessId).filter((s) => !s.deleted).toArray(),
    db.purchases.where('businessId').equals(businessId).filter((p) => p.status === 'saved' && !p.deleted).toArray(),
    db.supplierPayments.where('businessId').equals(businessId).filter((p) => !p.voidedAt && !p.deleted).toArray(),
  ]);
  const out: SupplierDue[] = [];
  for (const s of suppliers) {
    const mine = purchases.filter((p) => p.supplier?.supplierId === s.id);
    let credit = pays.filter((p) => p.supplierId === s.id).reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);
    credit += mine.filter((p) => p.kind === 'return').reduce((a, p) => a + p.totals.grandTotal, 0);
    credit -= Math.max(0, s.openingBalance ?? 0);
    for (const p of mine.filter((x) => x.kind === 'bill').sort((a, b) => a.date.localeCompare(b.date))) {
      const used = Math.max(0, Math.min(credit, p.totals.grandTotal));
      credit -= used;
      const unpaid = p.totals.grandTotal - used;
      if (unpaid > 0 && p.dueDate) {
        const late = Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${p.dueDate}T00:00:00`).getTime()) / 86_400_000);
        out.push({ purchase: p, supplierName: s.name, unpaid, dueDate: p.dueDate, daysLate: late });
      }
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * Saves a purchase. On first save of a bill: lines for things not in the catalogue become new items
 * (so their stock counts), items get this bill's cost / MRP / selling price when asked, and the
 * purchase order it came from is marked received.
 */
export async function savePurchase(actor: Actor, p: Purchase, opts: { finalize: boolean }): Promise<Purchase> {
  const existing = await db.purchases.get(p.id);
  if (existing && existing.status !== 'draft' && actor.role !== 'owner') throw new PermissionError(t('Only the owner can change a saved purchase'));
  await assertNotLocked(actor, existing);
  const finalizing = opts.finalize && (!existing || existing.status === 'draft');
  let lines = p.lines.filter((l) => l.name.trim() && l.qty > 0);

  const landed = landedCosts({ ...p, lines });
  if (finalizing && p.kind === 'bill') {
    const out: PurchaseLine[] = [];
    for (const l of lines) {
      if (l.itemId) {
        out.push(l);
        continue;
      }
      const s = await db.settings.get(actor.businessId);
      const item = await putRecord('items', actor, {
        id: newId(),
        name: l.name.trim(),
        unit: l.unit || s?.units?.[0] || 'pcs',
        rate: l.salePrice ?? 0,
        rateIncludesTax: false,
        taxPct: l.taxPct,
        hsn: l.hsn,
        mrp: l.mrp,
        purchasePrice: landed[lines.indexOf(l)] ?? unitCost(l),
        supplierId: p.supplier?.supplierId ?? null,
      } as Item);
      out.push({ ...l, itemId: item.id });
    }
    lines = out;
  }

  const saved: Purchase = {
    ...p,
    lines,
    totals: purchaseTotals({ ...p, lines }),
    status: opts.finalize ? (existing?.status === 'cancelled' ? 'cancelled' : 'saved') : (existing?.status ?? 'draft'),
    history: [...p.history, entry(actor, finalizing ? 'saved' : existing && existing.status !== 'draft' ? 'edited' : 'draft')],
  };
  const result = await putRecord('purchases', actor, saved);

  if (finalizing && p.kind === 'bill') {
    if (p.updatePrices) {
      for (const l of lines) {
        const item = l.itemId ? await db.items.get(l.itemId) : undefined;
        if (!item || item.deleted) continue;
        const patch: Partial<Item> = {};
        const cost = landed[lines.indexOf(l)] ?? unitCost(l);
        if (cost > 0 && cost !== item.purchasePrice) patch.purchasePrice = cost;
        // MRP and selling price are per the line's unit; the item keeps them per base unit.
        const per = (v: number) => Math.round(v / (l.unitFactor ?? 1));
        if (l.mrp && per(l.mrp) !== item.mrp) patch.mrp = per(l.mrp);
        if (l.salePrice && per(l.salePrice) !== item.rate) patch.rate = per(l.salePrice);
        if (!item.supplierId && p.supplier?.supplierId) patch.supplierId = p.supplier.supplierId;
        // Only the owner changes catalogue prices; staff saves still record the bill.
        if (Object.keys(patch).length && (actor.role === 'owner' || !('rate' in patch))) await putRecord('items', actor, withPriceHistory(item, { ...item, ...patch }, actor.userName));
      }
    }
    if (p.fromOrderId) {
      const order = await db.purchaseOrders.get(p.fromOrderId);
      if (order && order.status === 'open') await putRecord('purchaseOrders', actor, { ...order, status: 'received', purchaseId: p.id });
    }
  }
  return result;
}

export async function cancelPurchase(actor: Actor, id: string, reason?: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can cancel a purchase'));
  const p = await db.purchases.get(id);
  if (!p || p.status !== 'saved') return;
  await putRecord('purchases', actor, { ...p, status: 'cancelled', history: [...p.history, entry(actor, 'cancelled', reason)] });
}

/* ---------- money owed to suppliers ---------- */

export interface SupplierLedgerRow {
  date: string;
  label: string;
  /** + we owe more (bill), − we owe less (payment, return). */
  amount: number;
  balance: number;
  href?: string;
  payment?: SupplierPayment;
}

export async function supplierLedger(businessId: string, supplierId: string): Promise<{ rows: SupplierLedgerRow[]; balance: number }> {
  const supplier = await db.suppliers.get(supplierId);
  const [purchases, pays] = await Promise.all([
    db.purchases.where('supplier.supplierId').equals(supplierId).filter((p) => p.businessId === businessId && p.status === 'saved' && !p.deleted).toArray(),
    db.supplierPayments.where('supplierId').equals(supplierId).filter((p) => p.businessId === businessId && !p.voidedAt && !p.deleted).toArray(),
  ]);
  const raw: Omit<SupplierLedgerRow, 'balance'>[] = [
    ...purchases.map((p) => ({
      date: p.date,
      label: p.kind === 'return' ? t('Returned goods {ref}', { ref: p.supplierBillNo }) : t('Bill {ref}', { ref: p.supplierBillNo || '—' }),
      amount: p.kind === 'return' ? -p.totals.grandTotal : p.totals.grandTotal,
      href: `/tabs/purchases/${p.id}`,
    })),
    ...pays.map((p) => ({ date: p.date, label: p.kind === 'refund' ? t('Refund received') : t('Paid'), amount: p.kind === 'refund' ? p.amount : -p.amount, payment: p })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let balance = supplier?.openingBalance ?? 0;
  const rows: SupplierLedgerRow[] = [];
  if (balance) rows.push({ date: supplier!.createdAt.slice(0, 10), label: t('Opening balance'), amount: balance, balance });
  for (const r of raw) rows.push({ ...r, balance: (balance += r.amount) });
  return { rows, balance };
}

/** What the store owes each supplier (only suppliers with something owed or overpaid). */
export async function payables(businessId: string): Promise<Map<string, number>> {
  const [suppliers, purchases, pays] = await Promise.all([
    db.suppliers.where('businessId').equals(businessId).filter((s) => !s.deleted).toArray(),
    db.purchases.where('businessId').equals(businessId).filter((p) => p.status === 'saved' && !p.deleted).toArray(),
    db.supplierPayments.where('businessId').equals(businessId).filter((p) => !p.voidedAt && !p.deleted).toArray(),
  ]);
  const map = new Map<string, number>(suppliers.map((s) => [s.id, s.openingBalance ?? 0]));
  const add = (id: string | undefined | null, v: number) => id && map.set(id, (map.get(id) ?? 0) + v);
  for (const p of purchases) add(p.supplier?.supplierId, p.kind === 'return' ? -p.totals.grandTotal : p.totals.grandTotal);
  for (const p of pays) add(p.supplierId, p.kind === 'refund' ? p.amount : -p.amount);
  for (const [k, v] of map) if (v === 0) map.delete(k);
  return map;
}

/** Paid so far on one purchase bill (payments recorded against it). */
export async function paidOnPurchase(purchaseId: string): Promise<number> {
  const pays = await db.supplierPayments.filter((p) => p.purchaseId === purchaseId && !p.voidedAt && !p.deleted).toArray();
  return pays.reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);
}

export async function recordSupplierPayment(
  actor: Actor,
  input: Pick<SupplierPayment, 'supplierId' | 'amount' | 'mode' | 'date'> & Partial<Pick<SupplierPayment, 'purchaseId' | 'reference' | 'note' | 'kind' | 'accountId'>>,
): Promise<SupplierPayment> {
  if (!(input.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return putRecord('supplierPayments', actor, {
    id: newId(),
    kind: 'payment',
    ...input,
    reference: input.reference?.trim() || undefined,
    note: input.note?.trim() || undefined,
    paidByName: actor.userName,
  } as SupplierPayment);
}

export async function voidSupplierPayment(actor: Actor, id: string, reason: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can void a payment'));
  const p = await db.supplierPayments.get(id);
  if (!p || p.voidedAt) return;
  await putRecord('supplierPayments', actor, { ...p, voidedAt: new Date().toISOString(), voidedBy: actor.userId, voidedByName: actor.userName, voidReason: reason.trim() });
}

/* ---------- expenses ---------- */

const EXPENSE_TEXT: Record<Expense['category'], () => string> = {
  rent: () => t('Rent'),
  salary: () => t('Salary'),
  electricity: () => t('Electricity'),
  transport: () => t('Transport'),
  tea: () => t('Tea / snacks'),
  repairs: () => t('Repairs'),
  phone: () => t('Phone / internet'),
  other: () => t('Other'),
};
export const expenseLabel = (c: Expense['category']): string => EXPENSE_TEXT[c]?.() ?? c;

export async function saveExpense(actor: Actor, e: Expense): Promise<Expense> {
  const existing = await db.expenses.get(e.id);
  if (existing && actor.role !== 'owner') throw new PermissionError(t('Only the owner can change an expense'));
  return putRecord('expenses', actor, { ...e, note: e.note?.trim() || undefined, paidByName: existing?.paidByName ?? actor.userName });
}

/** Item ids from "id:qty,id:qty" (the low-stock list's link to a new purchase order). */
export function parseItemList(raw: string | null): { itemId: string; qty: number }[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((p) => p.split(':'))
    .filter(([id, q]) => id && Number(q) > 0)
    .map(([id, q]) => ({ itemId: id!, qty: Number(q) }));
}

/**
 * Fills a purchase draft from a scanned bill: finds the supplier (by GSTIN, then name; adds a new
 * one if needed) and each item (by name); anything not found stays a new line to check.
 */
export async function applyScan(actor: Actor, draft: Purchase, bill: ScannedBillDto, photo: string | null): Promise<Purchase> {
  const suppliers = await db.suppliers.where('businessId').equals(actor.businessId).filter((x) => !x.deleted).toArray();
  const gstin = checkGstin(bill.supplierGstin ?? '');
  const name = bill.supplierName.trim();
  let supplier =
    (gstin.ok ? suppliers.find((x) => x.taxId === gstin.gstin) : undefined) ?? (name ? suppliers.find((x) => x.name.trim().toLowerCase() === name.toLowerCase()) : undefined) ?? null;
  if (!supplier && name) {
    supplier = await putRecord('suppliers', actor, {
      ...blankSupplier(actor, name),
      taxId: gstin.ok ? gstin.gstin : undefined,
      address: gstin.ok ? { state: stateName(gstin.stateCode) } : {},
    });
  }
  const items = await db.items.where('businessId').equals(actor.businessId).filter((i) => !i.deleted).toArray();
  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const paise = (rupees: number) => (Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : 0);
  const lines: PurchaseLine[] = bill.lines
    .filter((l) => l.name.trim() && l.qty > 0)
    .map((l) => {
      const item = byName.get(l.name.trim().toLowerCase());
      return {
        id: newId(),
        itemId: item?.id ?? null,
        name: item?.name ?? l.name.trim(),
        qty: l.qty,
        unit: item?.unit ?? (l.unit.trim().slice(0, 10) || 'pcs'),
        rate: paise(l.rate),
        rateIncludesTax: false,
        taxPct: bill.hasGst ? l.taxPct : 0,
        hsn: l.hsn.replace(/\D/g, '') || item?.hsn,
        mrp: paise(l.mrp) || item?.mrp,
      };
    });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(bill.date) && bill.date <= todayISO() ? bill.date : draft.date;
  return {
    ...draft,
    supplier: supplier ? supplierSnapshot(supplier) : draft.supplier,
    supplierBillNo: bill.billNo.trim() || draft.supplierBillNo,
    date,
    taxMode: bill.hasGst ? 'gst' : 'none',
    interState: bill.igst || (await isInterState(actor.businessId, supplier?.taxId)),
    lines: [...draft.lines, ...lines],
    photo: photo ?? draft.photo,
  };
}

export { setOpeningStock };
