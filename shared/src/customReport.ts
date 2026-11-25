import { financialYearLabel } from './dates';

/**
 * Custom reports the owner builds: pick what to list (bills, bill items, payments, purchases,
 * expenses), the columns, an optional grouping and filters, and a period. Runs on plain synced
 * records, so the phone shows it and the server can add it to the nightly Excel.
 */

export const REPORT_SOURCES = ['bills', 'billLines', 'payments', 'purchases', 'expenses'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const REPORT_PERIODS = ['today', 'yesterday', 'week', 'month', 'lastMonth', 'fy'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface ReportSpec {
  source: ReportSource;
  columns: string[];
  /** A column key, or "day" / "month" of the date. */
  groupBy?: string | null;
  filters?: { staffId?: string | null; mode?: string | null; categoryId?: string | null };
  period: ReportPeriod;
}

type Data = Record<string, any>;
export type FieldKind = 'text' | 'money' | 'qty' | 'date';

export interface ReportField {
  key: string;
  /** English; the app translates it. */
  label: string;
  kind: FieldKind;
  get: (r: Data) => string | number | null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const maker = (d: Data) => (d.history as Data[] | undefined)?.find((h) => h.by === d.createdBy)?.byName ?? '';

export const REPORT_FIELDS: Record<ReportSource, ReportField[]> = {
  bills: [
    { key: 'date', label: 'Date', kind: 'date', get: (r) => r.date },
    { key: 'number', label: 'Number', kind: 'text', get: (r) => r.number },
    { key: 'customer', label: 'Customer', kind: 'text', get: (r) => r.billTo?.name ?? '' },
    { key: 'gstin', label: 'GSTIN', kind: 'text', get: (r) => r.billTo?.taxId ?? '' },
    { key: 'staff', label: 'Made by', kind: 'text', get: maker },
    { key: 'taxable', label: 'Before tax', kind: 'money', get: (r) => num(r.totals?.taxableAmount) },
    { key: 'tax', label: 'Tax', kind: 'money', get: (r) => num(r.totals?.taxTotal) },
    { key: 'total', label: 'Total', kind: 'money', get: (r) => num(r.totals?.grandTotal) },
    { key: 'items', label: 'Items', kind: 'qty', get: (r) => (r.lines as Data[] | undefined)?.length ?? 0 },
  ],
  billLines: [
    { key: 'date', label: 'Date', kind: 'date', get: (r) => r.date },
    { key: 'number', label: 'Number', kind: 'text', get: (r) => r.number },
    { key: 'customer', label: 'Customer', kind: 'text', get: (r) => r.customer },
    { key: 'item', label: 'Item', kind: 'text', get: (r) => r.name },
    { key: 'category', label: 'Category', kind: 'text', get: (r) => r.category ?? '' },
    { key: 'hsn', label: 'HSN', kind: 'text', get: (r) => r.hsn ?? '' },
    { key: 'staff', label: 'Made by', kind: 'text', get: (r) => r.staff },
    { key: 'qty', label: 'Quantity', kind: 'qty', get: (r) => num(r.qty) },
    { key: 'amount', label: 'Before tax', kind: 'money', get: (r) => num(r.taxable) },
    { key: 'tax', label: 'Tax', kind: 'money', get: (r) => num(r.tax) },
  ],
  payments: [
    { key: 'date', label: 'Date', kind: 'date', get: (r) => r.date },
    { key: 'mode', label: 'Mode', kind: 'text', get: (r) => r.mode },
    { key: 'kind', label: 'Kind', kind: 'text', get: (r) => (r.kind === 'refund' ? 'Refund' : r.invoiceId ? 'Bill payment' : 'Khata payment') },
    { key: 'reference', label: 'Reference', kind: 'text', get: (r) => r.reference ?? '' },
    { key: 'by', label: 'Received by', kind: 'text', get: (r) => r.receivedByName ?? '' },
    { key: 'amount', label: 'Amount', kind: 'money', get: (r) => (r.kind === 'refund' ? -num(r.amount) : num(r.amount)) },
  ],
  purchases: [
    { key: 'date', label: 'Date', kind: 'date', get: (r) => r.date },
    { key: 'supplier', label: 'Supplier', kind: 'text', get: (r) => r.supplier?.name ?? '' },
    { key: 'billNo', label: 'Bill no.', kind: 'text', get: (r) => r.supplierBillNo ?? '' },
    { key: 'kind', label: 'Kind', kind: 'text', get: (r) => (r.kind === 'return' ? 'Return' : 'Bill') },
    { key: 'taxable', label: 'Before tax', kind: 'money', get: (r) => (r.kind === 'return' ? -1 : 1) * num(r.totals?.taxableAmount) },
    { key: 'total', label: 'Total', kind: 'money', get: (r) => (r.kind === 'return' ? -1 : 1) * num(r.totals?.grandTotal) },
  ],
  expenses: [
    { key: 'date', label: 'Date', kind: 'date', get: (r) => r.date },
    { key: 'category', label: 'For', kind: 'text', get: (r) => r.category },
    { key: 'mode', label: 'Mode', kind: 'text', get: (r) => r.mode },
    { key: 'note', label: 'Note', kind: 'text', get: (r) => r.note ?? '' },
    { key: 'amount', label: 'Amount', kind: 'money', get: (r) => num(r.amount) },
  ],
};

const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** From / to dates of a period, counted from `today` (YYYY-MM-DD). */
export function periodRange(p: ReportPeriod, today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const shift = (days: number) => iso(new Date(d.getTime() + days * 86_400_000));
  if (p === 'today') return { from: today, to: today };
  if (p === 'yesterday') return { from: shift(-1), to: shift(-1) };
  if (p === 'week') return { from: shift(-((d.getUTCDay() + 6) % 7)), to: today };
  if (p === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (p === 'lastMonth') {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { from: iso(first), to: iso(last) };
  }
  return { from: `${2000 + Number(financialYearLabel(today).slice(0, 2))}-04-01`, to: today };
}

export interface ReportInput {
  invoices: Data[];
  payments: Data[];
  purchases: Data[];
  expenses: Data[];
  /** For bill items: category of each item. */
  items?: Data[];
  categories?: Data[];
}

export interface ReportResult {
  columns: { label: string; kind: FieldKind }[];
  rows: (string | number | null)[][];
  foot: (string | number | null)[];
}

export function runCustomReport(spec: ReportSpec, input: ReportInput, today: string): ReportResult {
  const { from, to } = periodRange(spec.period, today);
  const inRange = (r: Data) => typeof r.date === 'string' && r.date >= from && r.date <= to && !r.deleted;
  const f = spec.filters ?? {};
  let records: Data[];
  if (spec.source === 'bills' || spec.source === 'billLines') {
    const bills = input.invoices.filter((i) => i.status === 'saved' && inRange(i) && (!f.staffId || i.createdBy === f.staffId));
    if (spec.source === 'bills') records = bills;
    else {
      const items = new Map((input.items ?? []).map((i) => [i.id, i]));
      const cats = new Map((input.categories ?? []).map((c) => [c.id, c]));
      records = bills.flatMap((b) =>
        (b.lines as Data[]).map((l, i) => {
          const item = l.itemId ? items.get(l.itemId) : undefined;
          const catId = item?.categoryId ?? (item?.variantOf ? items.get(item.variantOf)?.categoryId : undefined);
          return {
            date: b.date,
            number: b.number,
            customer: b.billTo?.name ?? '',
            staff: maker(b),
            name: item?.name ?? l.name,
            hsn: l.hsn,
            categoryId: catId,
            category: catId ? cats.get(catId)?.name : '',
            qty: num(l.qty) * num(l.unitFactor ?? 1),
            taxable: num(b.totals?.lines?.[i]?.taxable),
            tax: num(b.totals?.lines?.[i]?.tax),
          };
        }),
      );
      if (f.categoryId) records = records.filter((r) => r.categoryId === f.categoryId);
    }
  } else if (spec.source === 'payments') {
    records = input.payments.filter((p) => inRange(p) && !p.voidedAt && p.mode !== 'advance' && (!f.mode || p.mode === f.mode) && (!f.staffId || p.receivedBy === f.staffId));
  } else if (spec.source === 'purchases') {
    records = input.purchases.filter((p) => p.status === 'saved' && inRange(p));
  } else {
    records = input.expenses.filter((e) => inRange(e) && (!f.mode || e.mode === f.mode));
  }
  records.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const fields = REPORT_FIELDS[spec.source];
  const cols = spec.columns.map((k) => fields.find((x) => x.key === k)).filter((x): x is ReportField => !!x);
  if (!cols.length) cols.push(...fields);

  let rows: (string | number | null)[][];
  let columns = cols.map((c) => ({ label: c.label, kind: c.kind }));
  if (spec.groupBy) {
    const keyOf =
      spec.groupBy === 'day' ? (r: Data) => String(r.date) : spec.groupBy === 'month' ? (r: Data) => String(r.date).slice(0, 7) : (r: Data) => String(fields.find((x) => x.key === spec.groupBy)?.get(r) ?? '');
    const groupLabel = spec.groupBy === 'day' ? 'Date' : spec.groupBy === 'month' ? 'Month' : (fields.find((x) => x.key === spec.groupBy)?.label ?? '');
    const sums = cols.filter((c) => c.kind === 'money' || c.kind === 'qty');
    const groups = new Map<string, { count: number; sums: number[] }>();
    for (const r of records) {
      const k = keyOf(r);
      const g = groups.get(k) ?? { count: 0, sums: sums.map(() => 0) };
      g.count++;
      sums.forEach((c, i) => (g.sums[i]! += num(c.get(r))));
      groups.set(k, g);
    }
    columns = [{ label: groupLabel, kind: spec.groupBy === 'day' ? 'date' : 'text' }, { label: 'Count', kind: 'qty' }, ...sums.map((c) => ({ label: c.label, kind: c.kind }))];
    rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, g]) => [k, g.count, ...g.sums]);
  } else {
    rows = records.map((r) => cols.map((c) => c.get(r)));
  }
  const foot = columns.map((c, i) => (i === 0 ? 'Total' : c.kind === 'money' || c.kind === 'qty' ? rows.reduce((a, r) => a + num(r[i]), 0) : null));
  return { columns, rows, foot };
}
