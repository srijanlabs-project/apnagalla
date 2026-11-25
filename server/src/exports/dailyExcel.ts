import { runCustomReport, type ReportSpec } from '@invoice/shared';
import { and, eq, sql } from 'drizzle-orm';
import writeXlsxFile from 'write-excel-file/node';
import type { DB } from '../db/client';
import { syncRecords } from '../db/schema';

/** The day's business as an Excel file, built from the store's synced records. */

type Data = Record<string, unknown>;
const rupees = (p: unknown) => (typeof p === 'number' ? Math.round(p) / 100 : 0);
const money = (p: unknown) => ({ value: rupees(p), type: Number, format: '#,##0.00' });
const text = (v: unknown) => ({ value: v == null ? '' : String(v), type: String });
const bold = (v: string) => ({ value: v, fontWeight: 'bold' as const });
const MODES: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank transfer', cheque: 'Cheque', other: 'Other', advance: 'From advance' };

async function records(db: DB, businessId: string, table: string, date: string): Promise<Data[]> {
  const rows = await db
    .select({ data: syncRecords.data })
    .from(syncRecords)
    .where(and(eq(syncRecords.businessId, businessId), eq(syncRecords.tableName, table), eq(syncRecords.deleted, false), sql`${syncRecords.data}->>'date' = ${date}`));
  return rows.map((r) => r.data);
}

async function all(db: DB, businessId: string, table: string): Promise<Data[]> {
  const rows = await db
    .select({ data: syncRecords.data })
    .from(syncRecords)
    .where(and(eq(syncRecords.businessId, businessId), eq(syncRecords.tableName, table), eq(syncRecords.deleted, false)));
  return rows.map((r) => r.data);
}

/** The owner's saved reports marked for the nightly Excel, one sheet each. */
async function savedReportSheets(db: DB, businessId: string, date: string) {
  const reports = (await all(db, businessId, 'savedReports')).filter((r) => r.nightly && r.spec);
  if (!reports.length) return [];
  const [invoices, payments, purchases, expenses, items, categories] = await Promise.all(
    ['invoices', 'payments', 'purchases', 'expenses', 'items', 'categories'].map((t) => all(db, businessId, t)),
  );
  return reports.slice(0, 10).map((r, i) => {
    const res = runCustomReport(r.spec as ReportSpec, { invoices: invoices!, payments: payments!, purchases: purchases!, expenses: expenses!, items, categories }, date);
    const cell = (v: string | number | null, kind: string) => (kind === 'money' && typeof v === 'number' ? money(v) : typeof v === 'number' ? { value: v, type: Number } : text(v));
    const data = [res.columns.map((c) => bold(c.label)), ...res.rows.map((row) => row.map((v, j) => cell(v, res.columns[j]!.kind))), res.foot.map((v, j) => ({ ...cell(v, res.columns[j]!.kind), fontWeight: 'bold' as const }))];
    // Sheet names: 31 characters, no []:*?/\ and unique.
    const name = `${i + 1}. ${String(r.name ?? 'Report')}`.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
    return { data: data as never, sheet: name, columns: res.columns.map(() => ({ width: 18 })) };
  });
}

export async function buildDailyExcel(db: DB, businessId: string, storeName: string, date: string): Promise<{ fileName: string; buffer: Buffer; summary: string }> {
  const [invoices, notes, payments, purchases, expenses] = await Promise.all([
    records(db, businessId, 'invoices', date),
    records(db, businessId, 'creditNotes', date),
    records(db, businessId, 'payments', date),
    records(db, businessId, 'purchases', date),
    records(db, businessId, 'expenses', date),
  ]);
  const bills = invoices.filter((i) => i.status === 'saved').sort((a, b) => String(a.number).localeCompare(String(b.number)));
  const returns = notes.filter((n) => n.status === 'saved');
  const pays = payments.filter((p) => !p.voidedAt && p.mode !== 'advance');
  const buys = purchases.filter((p) => p.status === 'saved');
  const total = (list: Data[]) => list.reduce((a, d) => a + Number((d.totals as Data | undefined)?.grandTotal ?? 0), 0);
  const byMode = new Map<string, number>();
  for (const p of pays) byMode.set(String(p.mode), (byMode.get(String(p.mode)) ?? 0) + (p.kind === 'refund' ? -1 : 1) * Number(p.amount ?? 0));
  const sales = total(bills);
  const expenseTotal = expenses.reduce((a, e) => a + Number(e.amount ?? 0), 0);
  const d = date.split('-').reverse().join('/');

  const summary = [
    [bold(`${storeName} — ${d}`)],
    [],
    [text('Bills'), { value: bills.length, type: Number }],
    [text('Sales'), money(sales)],
    [text('Returns (credit notes)'), money(total(returns))],
    [text('Net sales'), money(sales - total(returns))],
    [],
    [bold('Money received')],
    ...[...byMode.entries()].map(([m, v]) => [text(MODES[m] ?? m), money(v)]),
    [text('Total received'), money([...byMode.values()].reduce((a, v) => a + v, 0))],
    [],
    [text('Purchases'), money(total(buys.filter((p) => p.kind !== 'return')) - total(buys.filter((p) => p.kind === 'return')))],
    [text('Expenses'), money(expenseTotal)],
  ];
  const billRows = [
    ['Number', 'Customer', 'GSTIN', 'Items', 'Before tax', 'Tax', 'Total'].map(bold),
    ...bills.map((b) => {
      const t = (b.totals ?? {}) as Data;
      const to = (b.billTo ?? {}) as Data;
      const lines = (b.lines as Data[] | undefined) ?? [];
      return [text(b.number), text(to.name), text(to.taxId), text(lines.map((l) => `${l.name} × ${l.qty}`).join(', ')), money(t.taxableAmount), money(t.taxTotal), money(t.grandTotal)];
    }),
  ];
  const payRows = [
    ['Mode', 'Kind', 'Amount', 'Reference', 'By'].map(bold),
    ...pays.map((p) => [text(MODES[String(p.mode)] ?? p.mode), text(p.kind === 'refund' ? 'Refund' : p.invoiceId ? 'Bill payment' : 'Khata payment'), money(p.amount), text(p.reference), text(p.receivedByName)]),
  ];
  const buyRows = [
    ['Supplier', 'Bill no.', 'Kind', 'Total'].map(bold),
    ...buys.map((p) => [text((p.supplier as Data | null)?.name), text(p.supplierBillNo), text(p.kind === 'return' ? 'Return' : 'Bill'), money((p.totals as Data | undefined)?.grandTotal)]),
  ];
  const expRows = [['For', 'Mode', 'Amount', 'Note'].map(bold), ...expenses.map((e) => [text(e.category), text(MODES[String(e.mode)] ?? e.mode), money(e.amount), text(e.note)])];

  const buffer = await writeXlsxFile([
    { data: summary as never, sheet: 'Summary', columns: [{ width: 28 }, { width: 16 }] },
    { data: billRows as never, sheet: 'Bills', columns: [{ width: 18 }, { width: 24 }, { width: 18 }, { width: 50 }, { width: 14 }, { width: 12 }, { width: 14 }] },
    { data: payRows as never, sheet: 'Payments', columns: [{ width: 16 }, { width: 16 }, { width: 14 }, { width: 20 }, { width: 18 }] },
    { data: buyRows as never, sheet: 'Purchases', columns: [{ width: 24 }, { width: 16 }, { width: 10 }, { width: 14 }] },
    { data: expRows as never, sheet: 'Expenses', columns: [{ width: 18 }, { width: 14 }, { width: 14 }, { width: 30 }] },
    ...(await savedReportSheets(db, businessId, date)),
  ]).toBuffer();
  const safe = storeName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'Store';
  return {
    fileName: `ApnaGalla-${safe}-${date}.xlsx`,
    buffer,
    summary: `${storeName}, ${d}: ${bills.length} bills, sales ₹${rupees(sales).toFixed(2)}, received ₹${rupees([...byMode.values()].reduce((a, v) => a + v, 0)).toFixed(2)}.`,
  };
}
