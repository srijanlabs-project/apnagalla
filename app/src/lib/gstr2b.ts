import { db, type Purchase } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { purchaseGst } from './reports';

/**
 * R7 GSTR-2B match. The store downloads its GSTR-2B (or 2A) JSON from the GST portal; the app reads
 * the suppliers' invoices in it and matches them with the purchase bills entered here by the
 * supplier's GSTIN and bill number. Four outcomes: matched; amounts differ; in 2B but not entered
 * (enter the bill to claim its credit); entered but not in 2B (the supplier hasn't filed: the credit
 * is at risk, follow up).
 */

export interface PortalInvoice {
  gstin: string;
  supplier: string;
  number: string;
  date: string;
  taxable: number;
  tax: number;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const paise = (rupees: unknown) => Math.round(num(rupees) * 100);
const isoFrom = (dmy: string) => (/^\d{2}-\d{2}-\d{4}$/.test(dmy) ? `${dmy.slice(6)}-${dmy.slice(3, 5)}-${dmy.slice(0, 2)}` : dmy);
/** Bill numbers are written many ways: compare letters and digits only, without leading zeros. */
export const billKey = (gstin: string, number: string) => `${gstin.trim().toUpperCase()}|${number.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(^|[A-Z])0+(?=\d)/g, '$1')}`;

/** Reads the b2b invoices of a GSTR-2B or GSTR-2A JSON file. Returns the period ("MMYYYY") if given. */
export function parsePortalJson(text: string): { invoices: PortalInvoice[]; period?: string } {
  const j = JSON.parse(text) as Record<string, unknown>;
  const data = (j.data ?? j) as Record<string, unknown>;
  const docdata = (data.docdata ?? data) as Record<string, unknown>;
  const b2b = (docdata.b2b ?? []) as Record<string, unknown>[];
  const invoices: PortalInvoice[] = [];
  for (const s of b2b) {
    const gstin = String(s.ctin ?? '');
    const supplier = String(s.trdnm ?? s.ctin ?? '');
    for (const inv of (s.inv ?? []) as Record<string, unknown>[]) {
      let taxable = 0;
      let tax = 0;
      const items = (inv.items ?? inv.itms ?? []) as Record<string, unknown>[];
      if (items.length) {
        for (const it of items) {
          const d = (it.itm_det ?? it) as Record<string, unknown>;
          taxable += paise(d.txval);
          tax += paise(d.igst ?? d.iamt) + paise(d.cgst ?? d.camt) + paise(d.sgst ?? d.samt) + paise(d.cess ?? d.csamt);
        }
      } else {
        taxable = paise(inv.txval);
        tax = paise(inv.igst) + paise(inv.cgst) + paise(inv.sgst) + paise(inv.cess);
      }
      invoices.push({ gstin, supplier, number: String(inv.inum ?? ''), date: isoFrom(String(inv.dt ?? inv.idt ?? '')), taxable, tax });
    }
  }
  const period = typeof data.rtnprd === 'string' ? data.rtnprd : typeof j.fp === 'string' ? j.fp : undefined;
  return { invoices, period };
}

export type MatchState = 'matched' | 'differs' | 'notEntered' | 'notIn2b';

export interface MatchRow {
  state: MatchState;
  gstin: string;
  supplier: string;
  number: string;
  date: string;
  portalTax?: number;
  bookTax?: number;
  purchase?: Purchase;
}

/** Matches the portal's invoices with the purchase bills of the same months. */
export async function match2b(businessId: string, portal: PortalInvoice[], period?: string): Promise<MatchRow[]> {
  let from: string;
  let to: string;
  if (period && /^\d{6}$/.test(period)) {
    const y = period.slice(2);
    const m = period.slice(0, 2);
    from = `${y}-${m}-01`;
    to = `${y}-${m}-31`;
  } else {
    const dates = portal.map((p) => p.date).sort();
    from = dates[0] ?? '0000';
    to = dates[dates.length - 1] ?? '9999';
  }
  const purchases = await db.purchases.where('businessId').equals(businessId).filter((p) => p.status === 'saved' && !p.deleted && p.kind === 'bill' && p.taxMode === 'gst').toArray();
  const supplierGstin = new Map((await db.suppliers.where('businessId').equals(businessId).toArray()).map((s) => [s.id, s.taxId ?? '']));
  const gstinOf = (p: Purchase) => (p.supplier?.taxId || supplierGstin.get(p.supplier?.supplierId ?? '') || '').toUpperCase();
  const books = new Map(purchases.filter((p) => gstinOf(p)).map((p) => [billKey(gstinOf(p), p.supplierBillNo), p]));
  const seen = new Set<string>();
  const out: MatchRow[] = [];
  for (const inv of portal) {
    const key = billKey(inv.gstin, inv.number);
    const p = books.get(key);
    if (!p) {
      out.push({ state: 'notEntered', gstin: inv.gstin, supplier: inv.supplier, number: inv.number, date: inv.date, portalTax: inv.tax });
      continue;
    }
    seen.add(key);
    const g = purchaseGst(p);
    const bookTax = g.cgst + g.sgst + g.igst;
    out.push({ state: Math.abs(bookTax - inv.tax) <= 100 ? 'matched' : 'differs', gstin: inv.gstin, supplier: inv.supplier, number: inv.number, date: inv.date, portalTax: inv.tax, bookTax, purchase: p });
  }
  for (const [key, p] of books) {
    if (seen.has(key) || p.date < from || p.date > to) continue;
    const g = purchaseGst(p);
    out.push({ state: 'notIn2b', gstin: gstinOf(p), supplier: p.supplier?.name ?? '', number: p.supplierBillNo, date: p.date, bookTax: g.cgst + g.sgst + g.igst, purchase: p });
  }
  const order: MatchState[] = ['differs', 'notEntered', 'notIn2b', 'matched'];
  return out.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.supplier.localeCompare(b.supplier));
}

export const matchLabel = (s: MatchState) =>
  ({ matched: () => t('Matched'), differs: () => t('Tax differs'), notEntered: () => t('In 2B, not entered'), notIn2b: () => t('Entered, not in 2B') })[s]();

export function matchTable(rows: MatchRow[]): ExportTable {
  return {
    title: t('GSTR-2B match'),
    landscape: true,
    columns: [{ label: t('Result') }, { label: t('Supplier') }, { label: 'GSTIN' }, { label: t('Bill no.') }, { label: t('Date'), kind: 'date' }, { label: t('Tax in 2B'), kind: 'money' }, { label: t('Tax in books'), kind: 'money' }],
    rows: rows.map((r) => [matchLabel(r.state), r.supplier, r.gstin, r.number, r.date, r.portalTax ?? null, r.bookTax ?? null]),
    fileBase: 'GSTR-2B-match',
  };
}
