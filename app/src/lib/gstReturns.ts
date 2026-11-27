import { financialYearLabel } from '@invoice/shared';
import { db, type CreditNote, type Invoice, type Purchase } from './db';
import type { CellValue, ExportTable } from './exportTable';
import { t } from './i18n';
import { invoiceGst, purchaseGst, type Period } from './reports';

/**
 * R7 GST return sheets worked out from the bills: GSTR-3B (monthly summary) and GSTR-9 (annual).
 * They follow the GST portal's tables so the numbers can be typed in; the CA checks before filing.
 * Credit notes reduce the month's outward supplies. Non-GST bills (bill of supply) are "non-GST
 * outward supplies"; 0% lines on tax invoices are nil-rated / exempt.
 */

interface Heads {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
}
const zero = (): Heads => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const add = (a: Heads, b: Heads, sign = 1) => {
  a.taxable += sign * b.taxable;
  a.igst += sign * b.igst;
  a.cgst += sign * b.cgst;
  a.sgst += sign * b.sgst;
};
const inRange = (d: string, p: Period) => d >= p.from && d <= p.to;

export interface Gst3b {
  outTaxable: Heads;
  outNil: number;
  outNonGst: number;
  itc: Heads;
  inExempt: number;
  payable: Heads;
}

/** Splits a sale or a return into taxed and 0% parts with their tax heads. */
function saleParts(doc: Invoice | CreditNote, profile: Parameters<typeof invoiceGst>[1]) {
  const g = invoiceGst(doc, profile);
  const taxed = zero();
  let nil = 0;
  let nonGst = 0;
  if (!g.gst) {
    nonGst = doc.totals.grandTotal - doc.totals.roundOff;
    return { taxed, nil, nonGst };
  }
  for (const r of doc.totals.taxBreakdown) {
    if (r.taxPct > 0) taxed.taxable += r.taxable;
    else nil += r.taxable;
  }
  taxed.igst = g.igst;
  taxed.cgst = g.cgst;
  taxed.sgst = g.sgst;
  return { taxed, nil, nonGst };
}

export async function gstr3b(businessId: string, p: Period): Promise<Gst3b> {
  const [invoices, notes, purchases, profile] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && inRange(i.date, p)).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter((n) => n.status === 'saved' && !n.deleted && inRange(n.date, p)).toArray(),
    db.purchases.where('businessId').equals(businessId).filter((x) => x.status === 'saved' && !x.deleted && inRange(x.date, p)).toArray(),
    db.profiles.get(businessId),
  ]);
  const r: Gst3b = { outTaxable: zero(), outNil: 0, outNonGst: 0, itc: zero(), inExempt: 0, payable: zero() };
  for (const [docs, sign] of [
    [invoices, 1],
    [notes, -1],
  ] as const) {
    for (const d of docs as (Invoice | CreditNote)[]) {
      const s = saleParts(d, profile!);
      add(r.outTaxable, s.taxed, sign);
      r.outNil += sign * s.nil;
      r.outNonGst += sign * s.nonGst;
    }
  }
  for (const pu of purchases as Purchase[]) {
    const sign = pu.kind === 'return' ? -1 : 1;
    if (pu.taxMode !== 'gst') {
      r.inExempt += sign * (pu.totals.grandTotal - pu.totals.roundOff);
      continue;
    }
    const g = purchaseGst(pu);
    for (const row of pu.totals.taxBreakdown) {
      if (row.taxPct > 0) r.itc.taxable += sign * row.taxable;
      else r.inExempt += sign * row.taxable;
    }
    r.itc.igst += sign * g.igst;
    r.itc.cgst += sign * g.cgst;
    r.itc.sgst += sign * g.sgst;
  }
  // Tax to pay in cash after input credit, head by head (IGST credit used first against IGST,
  // then CGST and SGST in equal parts, as the portal does).
  let igstCredit = r.itc.igst;
  const pay = { igst: r.outTaxable.igst, cgst: r.outTaxable.cgst, sgst: r.outTaxable.sgst };
  const spend = (head: 'igst' | 'cgst' | 'sgst', credit: number) => {
    const u = Math.min(Math.max(0, pay[head]), credit);
    pay[head] -= u;
    return credit - u;
  };
  igstCredit = spend('igst', igstCredit);
  const half = Math.floor(igstCredit / 2);
  let rest = spend('cgst', half) + spend('sgst', igstCredit - half);
  rest = spend('cgst', r.itc.cgst + rest);
  spend('sgst', r.itc.sgst);
  r.payable = { taxable: 0, igst: Math.max(0, pay.igst), cgst: Math.max(0, pay.cgst), sgst: Math.max(0, pay.sgst) };
  return r;
}

const row = (label: string, h: Partial<Heads>): CellValue[] => [label, h.taxable ?? null, h.igst ?? null, h.cgst ?? null, h.sgst ?? null];

export async function gstr3bTable(businessId: string, p: Period): Promise<ExportTable> {
  const r = await gstr3b(businessId, p);
  return {
    title: 'GSTR-3B',
    subtitle: [`${p.from.split('-').reverse().join('/')} – ${p.to.split('-').reverse().join('/')}`, t('Worked out from your bills. Check with your CA before filing.')],
    columns: [{ label: t('Table') }, { label: t('Taxable value'), kind: 'money' }, { label: 'IGST', kind: 'money' }, { label: 'CGST', kind: 'money' }, { label: 'SGST/UTGST', kind: 'money' }],
    rows: [
      row(t('3.1(a) Outward taxable supplies'), r.outTaxable),
      row(t('3.1(c) Nil rated and exempted'), { taxable: r.outNil }),
      row(t('3.1(e) Non-GST outward supplies'), { taxable: r.outNonGst }),
      row(t('4(A)(5) Input tax credit, all other'), r.itc),
      row(t('5 Exempt, nil and non-GST inward'), { taxable: r.inExempt }),
      row(t('6.1 Tax to pay in cash (after credit)'), r.payable),
    ],
    fileBase: `GSTR-3B-${p.from}-${p.to}`,
  };
}

/** GSTR-9: the financial year of the period's end date, from the same sums. */
export async function gstr9Table(businessId: string, asOf: string): Promise<ExportTable> {
  const fy = financialYearLabel(asOf);
  const start = 2000 + Number(fy.slice(0, 2));
  const p = { from: `${start}-04-01`, to: `${start + 1}-03-31` };
  const r = await gstr3b(businessId, p);
  const [invoices, profile] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && inRange(i.date, p)).toArray(),
    db.profiles.get(businessId),
  ]);
  // Table 4: B2B (buyer has a GSTIN) and B2C.
  const b2b = zero();
  const b2c = zero();
  for (const i of invoices) {
    const s = saleParts(i, profile!);
    add(i.billTo?.taxId ? b2b : b2c, s.taxed);
  }
  return {
    title: 'GSTR-9',
    subtitle: [t('Financial year {fy}', { fy }), t('Annual summary from your bills (returns are taken off in 4N). Check with your CA before filing.')],
    columns: [{ label: t('Table') }, { label: t('Taxable value'), kind: 'money' }, { label: 'IGST', kind: 'money' }, { label: 'CGST', kind: 'money' }, { label: 'SGST/UTGST', kind: 'money' }],
    rows: [
      row(t('4A Supplies to unregistered persons (B2C)'), b2c),
      row(t('4B Supplies to registered persons (B2B)'), b2b),
      row(t('4N Total after credit notes'), r.outTaxable),
      row(t('5D/5E Exempted and nil rated'), { taxable: r.outNil }),
      row(t('5F Non-GST supplies'), { taxable: r.outNonGst }),
      row(t('6A Input tax credit availed'), r.itc),
      row(t('9 Tax payable after credit'), r.payable),
    ],
    fileBase: `GSTR-9-${fy}`,
  };
}
