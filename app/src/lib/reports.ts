import { todayISO } from '@invoice/shared';
import { cashDay } from './cashbook';
import { db, type CreditNote, type Invoice, type Item, type PaymentEntry, type Purchase } from './db';
import type { CellValue, ExportTable } from './exportTable';
import { gstViewOf } from './gstView';
import { t } from './i18n';
import { receivables } from './khata';
import { buildLedger, modeLabel, moneyOf } from './ledger';
import { expenseLabel, payables } from './purchases';
import { isLow, stockEvents, stockLevels, tracksStock } from './stock';

/**
 * Reports, worked out on the phone (or web) from the synced records, so they work offline.
 * Each returns one table that the screen shows and can share as PDF or Excel.
 */

export interface Period {
  from: string;
  to: string;
}

export interface ReportContext extends Period {
  businessId: string;
  /** Only this person's bills (staff filter). */
  staffId?: string | null;
  /** Owner's stores, for the store-wise report. */
  stores?: { id: string; name: string }[];
}

export type ReportId =
  | 'sales'
  | 'collections'
  | 'items'
  | 'categories'
  | 'slow'
  | 'stock'
  | 'lowStock'
  | 'salesRegister'
  | 'purchaseRegister'
  | 'hsn'
  | 'gstSummary'
  | 'profit'
  | 'expenses'
  | 'dayBook'
  | 'staff'
  | 'stores'
  | 'deliveries'
  | 'receivables'
  | 'payables';

const inRange = (d: string, p: Period) => d >= p.from && d <= p.to;
const periodText = (p: Period) => {
  const d = (s: string) => s.split('-').reverse().join('/');
  return p.from === p.to ? d(p.from) : `${d(p.from)} – ${d(p.to)}`;
};
const sum = (rows: CellValue[][], col: number) => rows.reduce((a, r) => a + (typeof r[col] === 'number' ? (r[col] as number) : 0), 0);

async function salesData(ctx: ReportContext) {
  const [invoices, notes, payments, profile] = await Promise.all([
    db.invoices.where('businessId').equals(ctx.businessId).filter((i) => i.status === 'saved' && !i.deleted).toArray(),
    db.creditNotes.where('businessId').equals(ctx.businessId).filter((n) => n.status === 'saved' && !n.deleted).toArray(),
    db.payments.where('businessId').equals(ctx.businessId).filter((p) => !p.deleted).toArray(),
    db.profiles.get(ctx.businessId),
  ]);
  const ledger = buildLedger(payments, notes);
  const mine = (d: { createdBy?: string }) => !ctx.staffId || d.createdBy === ctx.staffId;
  return {
    invoices: invoices.filter((i) => inRange(i.date, ctx) && mine(i)),
    allInvoices: invoices,
    notes: notes.filter((n) => inRange(n.date, ctx) && mine(n)),
    payments: payments.filter((p) => !p.voidedAt && inRange(p.date, ctx)),
    ledger,
    profile,
  };
}

/** Name of whoever made a document (from its history), for staff reports. */
const makerName = (d: Invoice | CreditNote) => d.history?.find((h) => h.by === d.createdBy)?.byName ?? d.history?.[0]?.byName ?? '';

/* ---------- sales ---------- */

async function sales(ctx: ReportContext): Promise<ExportTable> {
  const { invoices, notes, ledger } = await salesData(ctx);
  const days = new Map<string, { bills: number; sales: number; tax: number; returns: number; pending: number }>();
  const slot = (d: string) => days.get(d) ?? (days.set(d, { bills: 0, sales: 0, tax: 0, returns: 0, pending: 0 }), days.get(d)!);
  for (const i of invoices) {
    const s = slot(i.date);
    s.bills++;
    s.sales += i.totals.grandTotal;
    s.tax += i.totals.taxTotal;
    s.pending += moneyOf(i, ledger).pending;
  }
  for (const n of notes) slot(n.date).returns += n.totals.grandTotal;
  const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, s]) => [d, s.bills, s.sales, s.tax, s.returns, s.sales - s.returns, s.pending] as CellValue[]);
  return {
    title: t('Sales report'),
    subtitle: [periodText(ctx)],
    columns: [
      { label: t('Date'), kind: 'date' },
      { label: t('Bills'), kind: 'qty' },
      { label: t('Sales'), kind: 'money' },
      { label: t('Tax'), kind: 'money' },
      { label: t('Returns'), kind: 'money' },
      { label: t('Net sales'), kind: 'money' },
      { label: t('Still to collect'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6)]],
    fileBase: `Sales-${ctx.from}-${ctx.to}`,
  };
}

async function collections(ctx: ReportContext): Promise<ExportTable> {
  const { payments } = await salesData(ctx);
  const modes = [...new Set(payments.filter((p) => p.mode !== 'advance').map((p) => p.mode))].sort();
  const days = new Map<string, Record<string, number>>();
  for (const p of payments) {
    if (p.mode === 'advance') continue;
    const d = days.get(p.date) ?? (days.set(p.date, {}), days.get(p.date)!);
    d[p.mode] = (d[p.mode] ?? 0) + (p.kind === 'refund' ? -p.amount : p.amount);
  }
  const rows = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, m]) => [d, ...modes.map((x) => m[x] ?? 0), modes.reduce((a, x) => a + (m[x] ?? 0), 0)] as CellValue[]);
  return {
    title: t('Money received by mode'),
    subtitle: [periodText(ctx), t('Refunds are taken off.')],
    columns: [{ label: t('Date'), kind: 'date' }, ...modes.map((m) => ({ label: modeLabel(m as PaymentEntry['mode']), kind: 'money' as const })), { label: t('Total'), kind: 'money' }],
    rows,
    foot: [[t('Total'), ...modes.map((_, i) => sum(rows, i + 1)), sum(rows, modes.length + 1)]],
    fileBase: `Collections-${ctx.from}-${ctx.to}`,
  };
}

/** Quantity and amount (before tax) sold per item, less returns. */
async function itemSales(ctx: ReportContext) {
  const { invoices, notes } = await salesData(ctx);
  const items = new Map((await db.items.where('businessId').equals(ctx.businessId).toArray()).map((i) => [i.id, i]));
  const by = new Map<string, { name: string; unit: string; qty: number; amount: number; cost: number; item?: Item }>();
  const add = (doc: Invoice | CreditNote, sign: 1 | -1) =>
    doc.lines.forEach((l, idx) => {
      const key = l.itemId || `name:${l.name.toLowerCase()}`;
      const item = l.itemId ? items.get(l.itemId) : undefined;
      const s = by.get(key) ?? (by.set(key, { name: item?.name ?? l.name, unit: l.unit, qty: 0, amount: 0, cost: 0, item }), by.get(key)!);
      const taxable = doc.totals.lines[idx]?.taxable ?? Math.round(l.qty * l.rate);
      s.qty += sign * l.qty;
      s.amount += sign * taxable;
      s.cost += sign * Math.round(l.qty * (item?.purchasePrice ?? 0));
    });
  invoices.forEach((i) => add(i, 1));
  notes.filter((n) => n.reason === 'return').forEach((n) => add(n, -1));
  return { by, items };
}

async function items(ctx: ReportContext): Promise<ExportTable> {
  const { by } = await itemSales(ctx);
  const rows = [...by.values()].sort((a, b) => b.amount - a.amount).map((s) => [s.name, Math.round(s.qty * 1000) / 1000, s.unit, s.amount] as CellValue[]);
  return {
    title: t('Item-wise sales'),
    subtitle: [periodText(ctx), t('Best sellers first; amounts before tax, returns taken off.')],
    columns: [{ label: t('Item') }, { label: t('Quantity'), kind: 'qty' }, { label: t('Unit'), width: 'auto' }, { label: t('Sales'), kind: 'money' }],
    rows,
    foot: [[t('Total'), null, '', sum(rows, 3)]],
    fileBase: `Item-sales-${ctx.from}-${ctx.to}`,
  };
}

async function categories(ctx: ReportContext): Promise<ExportTable> {
  const { by } = await itemSales(ctx);
  const cats = await db.categories.where('businessId').equals(ctx.businessId).toArray();
  const catOf = new Map(cats.map((c) => [c.id, c]));
  const top = (id: string | null | undefined): string => {
    let c = id ? catOf.get(id) : undefined;
    while (c?.parentId && catOf.get(c.parentId)) c = catOf.get(c.parentId);
    return c?.name ?? t('No category');
  };
  const m = new Map<string, number>();
  for (const s of by.values()) m.set(top(s.item?.categoryId), (m.get(top(s.item?.categoryId)) ?? 0) + s.amount);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => [name, amount] as CellValue[]);
  return {
    title: t('Category-wise sales'),
    subtitle: [periodText(ctx)],
    columns: [{ label: t('Category') }, { label: t('Sales'), kind: 'money' }],
    rows,
    foot: [[t('Total'), sum(rows, 1)]],
    fileBase: `Category-sales-${ctx.from}-${ctx.to}`,
  };
}

async function slow(ctx: ReportContext): Promise<ExportTable> {
  const { by, items } = await itemSales(ctx);
  const stock = await stockLevels(ctx.businessId);
  const rows = [...items.values()]
    .filter((i) => tracksStock(i) && (stock.get(i.id) ?? 0) > 0 && !(by.get(i.id)?.qty ?? 0))
    .sort((a, b) => (stock.get(b.id) ?? 0) * (b.purchasePrice ?? 0) - (stock.get(a.id) ?? 0) * (a.purchasePrice ?? 0))
    .map((i) => [i.name, stock.get(i.id) ?? 0, i.unit, Math.round((stock.get(i.id) ?? 0) * (i.purchasePrice ?? 0))] as CellValue[]);
  return {
    title: t('Slow movers'),
    subtitle: [periodText(ctx), t('In stock but not sold in this period.')],
    columns: [{ label: t('Item') }, { label: t('Stock'), kind: 'qty' }, { label: t('Unit'), width: 'auto' }, { label: t('Value at cost'), kind: 'money' }],
    rows,
    foot: [[t('Total'), null, '', sum(rows, 3)]],
    fileBase: `Slow-movers-${ctx.from}-${ctx.to}`,
  };
}

/* ---------- stock ---------- */

async function stock(ctx: ReportContext, onlyLow = false): Promise<ExportTable> {
  const [all, levels] = await Promise.all([db.items.where('businessId').equals(ctx.businessId).filter((i) => !i.deleted).toArray(), stockLevels(ctx.businessId, ctx.to)]);
  const rows = all
    .filter(tracksStock)
    .filter((i) => !onlyLow || isLow(i, levels.get(i.id) ?? 0))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => {
      const q = levels.get(i.id) ?? 0;
      return [i.name, q, i.unit, i.lowStock ?? null, i.purchasePrice ?? null, Math.round(Math.max(0, q) * (i.purchasePrice ?? 0))] as CellValue[];
    });
  return {
    title: onlyLow ? t('Low stock') : t('Stock report'),
    subtitle: [t('As on {date}', { date: periodText({ from: ctx.to, to: ctx.to }) }), t('Value at purchase price.')],
    columns: [{ label: t('Item') }, { label: t('Stock'), kind: 'qty' }, { label: t('Unit'), width: 'auto' }, { label: t('Low at'), kind: 'qty' }, { label: t('Cost'), kind: 'money' }, { label: t('Value'), kind: 'money' }],
    rows,
    foot: [[t('Total'), null, '', null, null, sum(rows, 5)]],
    fileBase: onlyLow ? 'Low-stock' : `Stock-${ctx.to}`,
  };
}

/* ---------- GST ---------- */

function invoiceGst(doc: Invoice | CreditNote, profile: Parameters<typeof gstViewOf>[2]) {
  const v = gstViewOf(doc.number && 'invoiceId' in doc ? 'credit' : 'invoice', doc, doc.businessSnapshot ?? profile, doc.totals);
  const s = v.split;
  return { pos: v.posLabel, cgst: s?.cgst ?? 0, sgst: s?.sgst ?? 0, igst: s?.igst ?? 0, gst: v.mode === 'gst' };
}

async function salesRegister(ctx: ReportContext): Promise<ExportTable> {
  const { invoices, notes, profile } = await salesData(ctx);
  const docs: (Invoice | CreditNote)[] = [...invoices, ...notes].sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number));
  const rows = docs.map((d) => {
    const g = invoiceGst(d, profile);
    const sign = 'invoiceId' in d ? -1 : 1;
    return [d.date, d.number, d.billTo?.name ?? '', d.billTo?.taxId ?? '', g.pos, sign * d.totals.taxableAmount, sign * g.cgst, sign * g.sgst, sign * g.igst, sign * d.totals.grandTotal] as CellValue[];
  });
  return {
    title: t('Sales register'),
    subtitle: [periodText(ctx), t('Credit notes are shown with a minus sign.')],
    landscape: true,
    columns: [
      { label: t('Date'), kind: 'date' },
      { label: t('Number') },
      { label: t('Customer') },
      { label: 'GSTIN' },
      { label: t('Place of supply') },
      { label: t('Taxable'), kind: 'money' },
      { label: 'CGST', kind: 'money' },
      { label: 'SGST', kind: 'money' },
      { label: 'IGST', kind: 'money' },
      { label: t('Total'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', '', '', '', sum(rows, 5), sum(rows, 6), sum(rows, 7), sum(rows, 8), sum(rows, 9)]],
    fileBase: `Sales-register-${ctx.from}-${ctx.to}`,
  };
}

async function purchaseData(ctx: ReportContext): Promise<Purchase[]> {
  return db.purchases.where('businessId').equals(ctx.businessId).filter((p) => p.status === 'saved' && !p.deleted && inRange(p.date, ctx)).toArray();
}

function purchaseGst(p: Purchase) {
  const rows = p.totals.taxBreakdown;
  const tax = rows.reduce((a, r) => a + r.tax, 0);
  if (p.taxMode !== 'gst') return { cgst: 0, sgst: 0, igst: 0 };
  if (p.interState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.round(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

async function purchaseRegister(ctx: ReportContext): Promise<ExportTable> {
  const rows = (await purchaseData(ctx))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const g = purchaseGst(p);
      const sign = p.kind === 'return' ? -1 : 1;
      return [p.date, p.supplierBillNo, p.supplier?.name ?? '', p.supplier?.taxId ?? '', sign * p.totals.taxableAmount, sign * g.cgst, sign * g.sgst, sign * g.igst, sign * p.totals.grandTotal] as CellValue[];
    });
  return {
    title: t('Purchase register'),
    subtitle: [periodText(ctx), t('Returns to suppliers are shown with a minus sign.')],
    landscape: true,
    columns: [
      { label: t('Date'), kind: 'date' },
      { label: t('Bill no.') },
      { label: t('Supplier') },
      { label: 'GSTIN' },
      { label: t('Taxable'), kind: 'money' },
      { label: 'CGST', kind: 'money' },
      { label: 'SGST', kind: 'money' },
      { label: 'IGST', kind: 'money' },
      { label: t('Total'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', '', '', sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7), sum(rows, 8)]],
    fileBase: `Purchase-register-${ctx.from}-${ctx.to}`,
  };
}

async function hsn(ctx: ReportContext): Promise<ExportTable> {
  const { invoices, notes, profile } = await salesData(ctx);
  const m = new Map<string, { hsn: string; rate: number; unit: string; qty: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  const add = (d: Invoice | CreditNote, sign: number) => {
    if (d.taxMode !== 'gst') return;
    const inter = gstViewOf('invoice', d, d.businessSnapshot ?? profile, d.totals).interState;
    d.lines.forEach((l, i) => {
      const r = d.totals.lines[i];
      if (!r) return;
      const key = `${l.hsn ?? ''}|${l.taxPct}|${l.unit}`;
      const s = m.get(key) ?? (m.set(key, { hsn: l.hsn ?? '', rate: l.taxPct, unit: l.unit, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }), m.get(key)!);
      s.qty += sign * l.qty;
      s.taxable += sign * r.taxable;
      if (inter) s.igst += sign * r.tax;
      else {
        const c = Math.round(r.tax / 2);
        s.cgst += sign * c;
        s.sgst += sign * (r.tax - c);
      }
    });
  };
  invoices.forEach((i) => add(i, 1));
  notes.forEach((n) => add(n, -1));
  const rows = [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate).map((s) => [s.hsn || '—', s.unit, Math.round(s.qty * 1000) / 1000, s.rate, s.taxable, s.cgst, s.sgst, s.igst] as CellValue[]);
  return {
    title: t('HSN summary'),
    subtitle: [periodText(ctx), t('GST bills less credit notes.')],
    landscape: true,
    columns: [
      { label: 'HSN' },
      { label: t('Unit'), width: 'auto' },
      { label: t('Quantity'), kind: 'qty' },
      { label: t('GST %'), kind: 'qty' },
      { label: t('Taxable'), kind: 'money' },
      { label: 'CGST', kind: 'money' },
      { label: 'SGST', kind: 'money' },
      { label: 'IGST', kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', null, null, sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7)]],
    fileBase: `HSN-summary-${ctx.from}-${ctx.to}`,
  };
}

async function gstSummary(ctx: ReportContext): Promise<ExportTable> {
  const [s, p] = await Promise.all([salesRegister(ctx), purchaseRegister(ctx)]);
  const out = s.foot![0]!;
  const inp = p.foot![0]!;
  const n = (v: CellValue) => (typeof v === 'number' ? v : 0);
  const rows: CellValue[][] = [
    [t('Sales (output tax)'), n(out[5]), n(out[6]), n(out[7]), n(out[8])],
    [t('Purchases (input tax credit)'), n(inp[4]), n(inp[5]), n(inp[6]), n(inp[7])],
  ];
  const net = [t('Tax to pay (output − input)'), null, n(out[6]) - n(inp[5]), n(out[7]) - n(inp[6]), n(out[8]) - n(inp[7])];
  return {
    title: t('GST summary'),
    subtitle: [periodText(ctx), t('For GSTR-3B. Check with your CA before filing.')],
    columns: [{ label: '' }, { label: t('Taxable'), kind: 'money' }, { label: 'CGST', kind: 'money' }, { label: 'SGST', kind: 'money' }, { label: 'IGST', kind: 'money' }],
    rows,
    foot: [net],
    fileBase: `GST-summary-${ctx.from}-${ctx.to}`,
  };
}

/* ---------- profit, expenses ---------- */

async function expensesIn(ctx: ReportContext) {
  return db.expenses.where('businessId').equals(ctx.businessId).filter((e) => !e.deleted && inRange(e.date, ctx)).toArray();
}

async function profit(ctx: ReportContext): Promise<ExportTable> {
  const { by } = await itemSales(ctx);
  const sales = [...by.values()].reduce((a, s) => a + s.amount, 0);
  const cost = [...by.values()].reduce((a, s) => a + s.cost, 0);
  const noCost = [...by.values()].filter((s) => s.qty > 0 && !s.item?.purchasePrice).length;
  const expenses = (await expensesIn(ctx)).reduce((a, e) => a + e.amount, 0);
  const rows: CellValue[][] = [
    [t('Sales (before tax, less returns)'), sales],
    [t('Cost of goods sold'), -cost],
    [t('Gross profit'), sales - cost],
    [t('Expenses'), -expenses],
  ];
  return {
    title: t('Profit report'),
    subtitle: [periodText(ctx), t('Cost uses each item’s current purchase price.')],
    columns: [{ label: '' }, { label: t('Amount'), kind: 'money' }],
    rows,
    foot: [[t('Profit'), sales - cost - expenses]],
    after: noCost ? [t('{count} items sold have no purchase price, so their cost is counted as 0.', { count: noCost })] : [],
    fileBase: `Profit-${ctx.from}-${ctx.to}`,
  };
}

async function expenses(ctx: ReportContext): Promise<ExportTable> {
  const list = await expensesIn(ctx);
  const m = new Map<string, number>();
  for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c, a]) => [expenseLabel(c as never), a] as CellValue[]);
  return {
    title: t('Expenses'),
    subtitle: [periodText(ctx)],
    columns: [{ label: t('For') }, { label: t('Amount'), kind: 'money' }],
    rows,
    foot: [[t('Total'), sum(rows, 1)]],
    fileBase: `Expenses-${ctx.from}-${ctx.to}`,
  };
}

/* ---------- day book ---------- */

async function dayBook(ctx: ReportContext): Promise<ExportTable> {
  const { invoices, notes, payments } = await salesData({ ...ctx, staffId: null });
  const [purchases, sPays, exps, events] = await Promise.all([
    purchaseData(ctx),
    db.supplierPayments.where('businessId').equals(ctx.businessId).filter((p) => !p.deleted && !p.voidedAt && inRange(p.date, ctx)).toArray(),
    expensesIn(ctx),
    stockEvents(ctx.businessId),
  ]);
  const numberOf = new Map((await db.invoices.where('businessId').equals(ctx.businessId).toArray()).map((i) => [i.id, i.number]));
  const supplierName = new Map((await db.suppliers.where('businessId').equals(ctx.businessId).toArray()).map((s) => [s.id, s.name]));
  const rows: { at: string; row: CellValue[] }[] = [];
  const push = (date: string, at: string, what: string, ref: string, party: string, amountIn: number | null, amountOut: number | null) =>
    rows.push({ at: date + at, row: [date, what, ref, party, amountIn, amountOut] });
  for (const i of invoices) push(i.date, i.createdAt, t('Sale'), i.number, i.billTo?.name ?? '', null, null);
  for (const n of notes) push(n.date, n.createdAt, t('Credit note'), n.number, n.billTo?.name ?? '', null, null);
  for (const p of payments) {
    if (p.mode === 'advance') continue;
    const ref = p.invoiceId ? (numberOf.get(p.invoiceId) ?? '') : t('On account');
    if (p.kind === 'refund') push(p.date, p.createdAt, t('Refund · {mode}', { mode: modeLabel(p.mode) }), ref, '', null, p.amount);
    else push(p.date, p.createdAt, t('Received · {mode}', { mode: modeLabel(p.mode) }), ref, '', p.amount, null);
  }
  for (const p of purchases) push(p.date, p.createdAt, p.kind === 'return' ? t('Purchase return') : t('Purchase'), p.supplierBillNo, p.supplier?.name ?? '', null, null);
  for (const p of sPays) push(p.date, p.createdAt, t('Paid supplier · {mode}', { mode: modeLabel(p.mode) }), '', supplierName.get(p.supplierId) ?? '', p.kind === 'refund' ? p.amount : null, p.kind === 'refund' ? null : p.amount);
  for (const e of exps) push(e.date, e.createdAt, t('Expense · {what}', { what: expenseLabel(e.category) }), '', e.note ?? '', null, e.amount);
  for (const list of events.values())
    for (const e of list) if (e.move && e.kind !== 'opening' && inRange(e.date, ctx)) push(e.date, e.move.createdAt, t('Stock change'), e.move.itemName, `${e.qty > 0 ? '+' : ''}${e.qty} · ${e.label}`, null, null);
  // Bills show their value in their own column via the totals; money columns are money in / out.
  const out = rows.sort((a, b) => a.at.localeCompare(b.at)).map((r) => r.row);
  for (const r of out) {
    const inv = invoices.find((i) => i.number === r[2] && r[1] === t('Sale'));
    if (inv) r[3] = `${inv.billTo?.name ?? ''} · ${(inv.totals.grandTotal / 100).toFixed(2)}`;
  }
  return {
    title: t('Day book'),
    subtitle: [periodText(ctx)],
    landscape: true,
    columns: [{ label: t('Date'), kind: 'date' }, { label: t('What') }, { label: t('Ref') }, { label: t('Details') }, { label: t('Money in'), kind: 'money' }, { label: t('Money out'), kind: 'money' }],
    rows: out,
    foot: [[t('Total'), '', '', '', sum(out, 4), sum(out, 5)]],
    fileBase: `Day-book-${ctx.from}-${ctx.to}`,
  };
}

/* ---------- people, stores, deliveries, balances ---------- */

async function staff(ctx: ReportContext): Promise<ExportTable> {
  const { invoices, notes, payments } = await salesData({ ...ctx, staffId: null });
  const m = new Map<string, { name: string; bills: number; sales: number; returns: number; received: number }>();
  const slot = (id: string, name: string) => m.get(id) ?? (m.set(id, { name, bills: 0, sales: 0, returns: 0, received: 0 }), m.get(id)!);
  for (const i of invoices) {
    const s = slot(i.createdBy, makerName(i));
    s.bills++;
    s.sales += i.totals.grandTotal;
  }
  for (const n of notes) slot(n.createdBy, makerName(n)).returns += n.totals.grandTotal;
  for (const p of payments) if (p.mode !== 'advance' && p.kind === 'payment') slot(p.receivedBy, p.receivedByName ?? '').received += p.amount;
  const rows = [...m.values()].sort((a, b) => b.sales - a.sales).map((s) => [s.name || '—', s.bills, s.sales, s.returns, s.received] as CellValue[]);
  return {
    title: t('Staff-wise sales'),
    subtitle: [periodText(ctx)],
    columns: [{ label: t('Person') }, { label: t('Bills'), kind: 'qty' }, { label: t('Sales'), kind: 'money' }, { label: t('Returns'), kind: 'money' }, { label: t('Money received'), kind: 'money' }],
    rows,
    foot: [[t('Total'), sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4)]],
    fileBase: `Staff-sales-${ctx.from}-${ctx.to}`,
  };
}

async function stores(ctx: ReportContext): Promise<ExportTable> {
  const rows: CellValue[][] = [];
  for (const s of ctx.stores ?? []) {
    const { invoices, notes, payments } = await salesData({ ...ctx, businessId: s.id, staffId: null });
    const sales = invoices.reduce((a, i) => a + i.totals.grandTotal, 0);
    const returns = notes.reduce((a, n) => a + n.totals.grandTotal, 0);
    const received = payments.filter((p) => p.mode !== 'advance').reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);
    rows.push([s.name, invoices.length, sales, returns, received]);
  }
  return {
    title: t('Store-wise sales'),
    subtitle: [periodText(ctx), t('Stores whose data is on this device.')],
    columns: [{ label: t('Store') }, { label: t('Bills'), kind: 'qty' }, { label: t('Sales'), kind: 'money' }, { label: t('Returns'), kind: 'money' }, { label: t('Money received'), kind: 'money' }],
    rows,
    foot: [[t('Total'), sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4)]],
    fileBase: `Store-sales-${ctx.from}-${ctx.to}`,
  };
}

async function deliveries(ctx: ReportContext): Promise<ExportTable> {
  const { allInvoices, ledger } = await salesData(ctx);
  const estimates = await db.estimates.where('businessId').equals(ctx.businessId).filter((e) => !e.deleted && e.status !== 'draft' && e.status !== 'declined' && e.status !== 'converted').toArray();
  const today = todayISO();
  const docs = [...allInvoices.map((d) => ({ d, pending: moneyOf(d, ledger).pending })), ...estimates.map((d) => ({ d, pending: d.totals.grandTotal }))].filter(({ d }) => d.deliveryDate && inRange(d.deliveryDate, ctx));
  const rows = docs
    .sort((a, b) => a.d.deliveryDate!.localeCompare(b.d.deliveryDate!))
    .map(({ d, pending }) => {
      const status = d.deliveredAt ? (d.deliveredAt.slice(0, 10) > d.deliveryDate! ? t('Delivered late') : t('Delivered')) : d.deliveryDate! < today ? t('Late') : t('Due');
      return [d.deliveryDate, d.number || t('Draft'), d.billTo?.name ?? '', d.lines.map((l) => `${l.name} × ${l.qty}`).join(', '), status, d.deliveryAssignee?.name ?? '', pending] as CellValue[];
    });
  return {
    title: t('Delivery report'),
    subtitle: [periodText(ctx)],
    landscape: true,
    columns: [
      { label: t('Delivery date'), kind: 'date' },
      { label: t('Number') },
      { label: t('Customer') },
      { label: t('Items') },
      { label: t('Status') },
      { label: t('By') },
      { label: t('To collect'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', '', '', '', '', sum(rows, 6)]],
    fileBase: `Deliveries-${ctx.from}-${ctx.to}`,
  };
}

async function receivablesReport(ctx: ReportContext): Promise<ExportTable> {
  const list = (await receivables(ctx.businessId)).filter((r) => r.balance > 0);
  const rows = list.map((r) => [r.customer.name, r.customer.phone ?? '', r.overdue || null, r.balance] as CellValue[]);
  return {
    title: t('To collect from customers'),
    subtitle: [t('As on {date}', { date: periodText({ from: todayISO(), to: todayISO() }) })],
    columns: [{ label: t('Customer') }, { label: t('Mobile') }, { label: t('Overdue'), kind: 'money' }, { label: t('Balance'), kind: 'money' }],
    rows,
    foot: [[t('Total'), '', sum(rows, 2), sum(rows, 3)]],
    fileBase: 'Receivables',
  };
}

async function payablesReport(ctx: ReportContext): Promise<ExportTable> {
  const owed = await payables(ctx.businessId);
  const suppliers = new Map((await db.suppliers.where('businessId').equals(ctx.businessId).toArray()).map((s) => [s.id, s]));
  const rows = [...owed.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => [suppliers.get(id)?.name ?? '', suppliers.get(id)?.phone ?? '', v] as CellValue[]);
  return {
    title: t('To pay suppliers'),
    subtitle: [t('As on {date}', { date: periodText({ from: todayISO(), to: todayISO() }) })],
    columns: [{ label: t('Supplier') }, { label: t('Mobile') }, { label: t('Balance'), kind: 'money' }],
    rows,
    foot: [[t('Total'), '', sum(rows, 2)]],
    fileBase: 'Payables',
  };
}

export interface ReportInfo {
  id: ReportId;
  title: () => string;
  group: 'sales' | 'stock' | 'gst' | 'money' | 'people';
  /** Uses the date range. */
  period: boolean;
  /** Contains purchase costs: owner, or staff allowed to see costs. */
  cost?: boolean;
  ownerOnly?: boolean;
  run: (ctx: ReportContext) => Promise<ExportTable>;
}

export const REPORTS: ReportInfo[] = [
  { id: 'sales', title: () => t('Sales report'), group: 'sales', period: true, run: sales },
  { id: 'collections', title: () => t('Money received by mode'), group: 'sales', period: true, run: collections },
  { id: 'items', title: () => t('Item-wise sales'), group: 'sales', period: true, run: items },
  { id: 'categories', title: () => t('Category-wise sales'), group: 'sales', period: true, run: categories },
  { id: 'deliveries', title: () => t('Delivery report'), group: 'sales', period: true, run: deliveries },
  { id: 'stock', title: () => t('Stock report'), group: 'stock', period: false, cost: true, run: (c) => stock(c) },
  { id: 'lowStock', title: () => t('Low stock'), group: 'stock', period: false, run: (c) => stock(c, true) },
  { id: 'slow', title: () => t('Slow movers'), group: 'stock', period: true, cost: true, run: slow },
  { id: 'salesRegister', title: () => t('Sales register'), group: 'gst', period: true, ownerOnly: true, run: salesRegister },
  { id: 'purchaseRegister', title: () => t('Purchase register'), group: 'gst', period: true, ownerOnly: true, run: purchaseRegister },
  { id: 'hsn', title: () => t('HSN summary'), group: 'gst', period: true, ownerOnly: true, run: hsn },
  { id: 'gstSummary', title: () => t('GST summary'), group: 'gst', period: true, ownerOnly: true, run: gstSummary },
  { id: 'profit', title: () => t('Profit report'), group: 'money', period: true, ownerOnly: true, run: profit },
  { id: 'expenses', title: () => t('Expenses'), group: 'money', period: true, run: expenses },
  { id: 'dayBook', title: () => t('Day book'), group: 'money', period: true, ownerOnly: true, run: dayBook },
  { id: 'receivables', title: () => t('To collect from customers'), group: 'money', period: false, run: receivablesReport },
  { id: 'payables', title: () => t('To pay suppliers'), group: 'money', period: false, cost: true, run: payablesReport },
  { id: 'staff', title: () => t('Staff-wise sales'), group: 'people', period: true, ownerOnly: true, run: staff },
  { id: 'stores', title: () => t('Store-wise sales'), group: 'people', period: true, ownerOnly: true, run: stores },
];

/* ---------- home dashboard ---------- */

export interface Today {
  sales: number;
  bills: number;
  cash: number;
  upi: number;
  /** Bills of today not yet paid (given on credit). */
  credit: number;
  receivable: number;
  payable: number;
  lowStock: number;
  cashInDrawer: number;
}

export async function todaySummary(businessId: string, withPayables: boolean): Promise<Today> {
  const today = todayISO();
  const { invoices, payments, ledger } = await salesData({ businessId, from: today, to: today });
  const [rec, pay, items, levels, drawer] = await Promise.all([
    receivables(businessId),
    withPayables ? payables(businessId) : Promise.resolve(new Map<string, number>()),
    db.items.where('businessId').equals(businessId).filter((i) => !i.deleted).toArray(),
    stockLevels(businessId),
    cashDay(businessId, today),
  ]);
  const money = (mode: string) => payments.filter((p) => p.mode === mode).reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);
  return {
    sales: invoices.reduce((a, i) => a + i.totals.grandTotal, 0),
    bills: invoices.length,
    cash: money('cash'),
    upi: money('upi'),
    credit: invoices.reduce((a, i) => a + moneyOf(i, ledger).pending, 0),
    receivable: rec.reduce((a, r) => a + Math.max(0, r.balance), 0),
    payable: [...pay.values()].reduce((a, v) => a + Math.max(0, v), 0),
    lowStock: items.filter((i) => isLow(i, levels.get(i.id) ?? 0)).length,
    cashInDrawer: drawer.expected,
  };
}
