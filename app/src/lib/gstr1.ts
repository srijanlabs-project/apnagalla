import { checkGstin } from '@invoice/shared';
import { db, type CreditNote, type Invoice } from './db';
import type { CellValue, ExportTable } from './exportTable';
import { gstViewOf } from './gstView';
import { t } from './i18n';

/**
 * GSTR-1 for one month, in the GST offline tool's JSON (B2B, B2C large, B2C small, credit notes to
 * registered buyers, HSN summary split B2B / B2C, documents issued) plus a sheet to check it.
 * Only GST bills of a regular store count. Check with the CA before filing.
 */

const r2 = (paise: number) => Math.round(paise) / 100;
const dmy = (iso: string) => iso.split('-').reverse().join('-');
/** Inter-state B2C bills above this (₹1 lakh) are "B2C large". */
const B2CL_LIMIT = 100_000_00;

const UQC: [RegExp, string][] = [
  [/^(pcs|pc|piece|pieces|nos|no|unit|units)$/i, 'NOS'],
  [/^(kg|kgs|kilo)$/i, 'KGS'],
  [/^(g|gm|gms|gram|grams)$/i, 'GMS'],
  [/^(l|ltr|litre|liter|litres)$/i, 'LTR'],
  [/^(ml)$/i, 'MLT'],
  [/^(m|mtr|metre|meter)$/i, 'MTR'],
  [/^(sq ?ft|sqft)$/i, 'SQF'],
  [/^(box|boxes)$/i, 'BOX'],
  [/^(bag|bags)$/i, 'BAG'],
  [/^(dozen|doz)$/i, 'DOZ'],
  [/^(pkt|pack|packet)$/i, 'PAC'],
  [/^(set|sets)$/i, 'SET'],
  [/^(pair|pairs)$/i, 'PRS'],
];
export const uqcOf = (unit: string) => UQC.find(([re]) => re.test(unit.trim()))?.[1] ?? 'OTH';

interface Row {
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
}

function rowsOf(doc: Invoice | CreditNote, profile: Parameters<typeof gstViewOf>[2]): { pos: string; inter: boolean; rows: Row[] } {
  const v = gstViewOf('invoice', doc, doc.businessSnapshot ?? profile, doc.totals);
  const rows = (v.split?.rows ?? []).map((r) => ({ rt: r.taxPct, txval: r.taxable, iamt: r.igst, camt: r.cgst, samt: r.sgst }));
  return { pos: v.pos ?? '', inter: v.interState, rows };
}

const items = (rows: Row[]) => rows.map((r, i) => ({ num: i + 1, itm_det: { txval: r2(r.txval), rt: r.rt, iamt: r2(r.iamt), camt: r2(r.camt), samt: r2(r.samt), csamt: 0 } }));

export async function buildGstr1(businessId: string, month: string): Promise<{ json: unknown; table: ExportTable; problems: string[] }> {
  const profile = await db.profiles.get(businessId);
  const gstin = profile?.taxIdValue ?? '';
  const inMonth = (d: string) => d.startsWith(month);
  const [invoicesAll, notesAll] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((i) => !i.deleted && inMonth(i.date) && !!i.number).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter((n) => !n.deleted && inMonth(n.date) && !!n.number).toArray(),
  ]);
  const invoices = invoicesAll.filter((i) => i.status === 'saved' && i.taxMode === 'gst');
  const notes = notesAll.filter((n) => n.status === 'saved' && n.taxMode === 'gst');
  const problems: string[] = [];
  if (!checkGstin(gstin).ok) problems.push(t('The store GSTIN is missing or wrong (Business profile).'));

  const b2b = new Map<string, unknown[]>();
  const b2cl = new Map<string, unknown[]>();
  const b2cs = new Map<string, Row & { sply_ty: string; pos: string }>();
  const cdnr = new Map<string, unknown[]>();
  const hsn = { b2b: new Map<string, Record<string, number | string>>(), b2c: new Map<string, Record<string, number | string>>() };
  const sheet: CellValue[][] = [];

  const addHsn = (doc: Invoice | CreditNote, sign: number, registered: boolean) => {
    const { inter } = rowsOf(doc, profile);
    doc.lines.forEach((l, i) => {
      const r = doc.totals.lines[i];
      if (!r) return;
      const code = l.hsn ?? '';
      if (!code) problems.push(t('{number}: “{item}” has no HSN', { number: doc.number, item: l.name }));
      const key = `${code}|${l.taxPct}|${uqcOf(l.unit)}`;
      const map = registered ? hsn.b2b : hsn.b2c;
      const h = map.get(key) ?? { hsn_sc: code, desc: l.name.slice(0, 30), uqc: uqcOf(l.unit), qty: 0, rt: l.taxPct, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
      const c = Math.round(r.tax / 2);
      h.qty = (h.qty as number) + sign * l.qty * (l.unitFactor ?? 1);
      h.txval = (h.txval as number) + sign * r.taxable;
      if (inter) h.iamt = (h.iamt as number) + sign * r.tax;
      else {
        h.camt = (h.camt as number) + sign * c;
        h.samt = (h.samt as number) + sign * (r.tax - c);
      }
      map.set(key, h);
    });
  };

  const addB2cs = (pos: string, inter: boolean, rows: Row[], sign: number) => {
    for (const r of rows) {
      const key = `${inter ? 'INTER' : 'INTRA'}|${pos}|${r.rt}`;
      const s = b2cs.get(key) ?? { sply_ty: inter ? 'INTER' : 'INTRA', pos, rt: r.rt, txval: 0, iamt: 0, camt: 0, samt: 0 };
      s.txval += sign * r.txval;
      s.iamt += sign * r.iamt;
      s.camt += sign * r.camt;
      s.samt += sign * r.samt;
      b2cs.set(key, s);
    }
  };

  for (const inv of invoices.sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number))) {
    const { pos, inter, rows } = rowsOf(inv, profile);
    const buyer = checkGstin(inv.billTo?.taxId ?? '');
    const entry = { inum: inv.number, idt: dmy(inv.date), val: r2(inv.totals.grandTotal), pos, rchrg: 'N', inv_typ: 'R', itms: items(rows) };
    let section: string;
    if (buyer.ok) {
      b2b.set(buyer.gstin, [...(b2b.get(buyer.gstin) ?? []), entry]);
      section = 'B2B';
    } else if (inter && inv.totals.grandTotal > B2CL_LIMIT) {
      b2cl.set(pos, [...(b2cl.get(pos) ?? []), { inum: entry.inum, idt: entry.idt, val: entry.val, itms: entry.itms }]);
      section = 'B2CL';
    } else {
      addB2cs(pos, inter, rows, 1);
      section = 'B2CS';
    }
    addHsn(inv, 1, buyer.ok);
    const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0);
    sheet.push([section, inv.number, inv.date, inv.billTo?.name ?? '', buyer.ok ? buyer.gstin : '', pos, sum('txval'), sum('camt'), sum('samt'), sum('iamt'), inv.totals.grandTotal]);
  }

  for (const n of notes.sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number))) {
    const { pos, inter, rows } = rowsOf(n, profile);
    const buyer = checkGstin(n.billTo?.taxId ?? '');
    if (buyer.ok) {
      cdnr.set(buyer.gstin, [...(cdnr.get(buyer.gstin) ?? []), { ntty: 'C', nt_num: n.number, nt_dt: dmy(n.date), val: r2(n.totals.grandTotal), pos, rchrg: 'N', inv_typ: 'R', itms: items(rows) }]);
    } else addB2cs(pos, inter, rows, -1);
    addHsn(n, -1, buyer.ok);
    const sum = (k: keyof Row) => -rows.reduce((a, r) => a + (r[k] as number), 0);
    sheet.push([buyer.ok ? 'CDNR' : 'B2CS (credit note)', n.number, n.date, n.billTo?.name ?? '', buyer.ok ? buyer.gstin : '', pos, sum('txval'), sum('camt'), sum('samt'), sum('iamt'), -n.totals.grandTotal]);
  }

  // Documents issued: each number series, first and last number, how many, cancelled.
  const series = (docs: (Invoice | CreditNote)[], docNum: number) => {
    const by = new Map<string, (Invoice | CreditNote)[]>();
    for (const d of docs) by.set(d.numberSeries ?? 'old', [...(by.get(d.numberSeries ?? 'old') ?? []), d]);
    const list = [...by.values()].map((g, i) => {
      const sorted = g.sort((a, b) => (a.numberSeq ?? 0) - (b.numberSeq ?? 0) || a.number.localeCompare(b.number));
      const cancel = g.filter((d) => d.status === 'cancelled').length;
      return { num: i + 1, from: sorted[0]!.number, to: sorted[sorted.length - 1]!.number, totnum: g.length, cancel, net_issue: g.length - cancel };
    });
    return list.length ? [{ doc_num: docNum, docs: list }] : [];
  };
  const hsnRows = (m: Map<string, Record<string, number | string>>) =>
    [...m.values()].map((h, i) => ({ num: i + 1, ...h, qty: Math.round((h.qty as number) * 1000) / 1000, txval: r2(h.txval as number), iamt: r2(h.iamt as number), camt: r2(h.camt as number), samt: r2(h.samt as number) }));

  const [y, m] = month.split('-');
  const json = {
    gstin,
    fp: `${m}${y}`,
    version: 'GST3.2',
    hash: 'hash',
    b2b: [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv })),
    b2cs: [...b2cs.values()].map((s) => ({ sply_ty: s.sply_ty, pos: s.pos, typ: 'OE', rt: s.rt, txval: r2(s.txval), iamt: r2(s.iamt), camt: r2(s.camt), samt: r2(s.samt), csamt: 0 })),
    cdnr: [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt })),
    hsn: { hsn_b2b: hsnRows(hsn.b2b), hsn_b2c: hsnRows(hsn.b2c) },
    doc_issue: { doc_det: [...series(invoicesAll.filter((i) => i.status !== 'draft'), 1), ...series(notesAll.filter((n) => n.status !== 'draft'), 5)] },
  };

  const table: ExportTable = {
    title: t('GSTR-1 {month}', { month: `${m}/${y}` }),
    subtitle: [`GSTIN ${gstin}`, t('Check with your CA before filing.')],
    landscape: true,
    columns: [
      { label: t('Section') },
      { label: t('Number') },
      { label: t('Date'), kind: 'date' },
      { label: t('Customer') },
      { label: 'GSTIN' },
      { label: t('Place of supply') },
      { label: t('Taxable'), kind: 'money' },
      { label: 'CGST', kind: 'money' },
      { label: 'SGST', kind: 'money' },
      { label: 'IGST', kind: 'money' },
      { label: t('Total'), kind: 'money' },
    ],
    rows: sheet,
    after: [...new Set(problems)].slice(0, 30),
    fileBase: `GSTR1-${gstin}-${m}${y}`,
  };
  return { json, table, problems: [...new Set(problems)] };
}
