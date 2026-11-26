import { todayISO } from '@invoice/shared';
import { db, type Estimate, type Invoice, type StockMove } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { newId, newInvoiceDraft, PermissionError, putRecord, saveInvoice, type Actor } from './repo';

/**
 * Consignment (sale or return): goods go to a dealer or customer on a delivery challan marked
 * `consignment`. The challan takes them out of stock. Later the shop bills what was sold (a bill
 * from the challan, which doesn't move stock again) and takes back what wasn't (a stock entry
 * back in, tagged with the challan and line). What is still with the party = sent − sold − returned.
 */

export interface ConsignLine {
  lineId: string;
  itemId?: string | null;
  name: string;
  unit: string;
  rate: number;
  sent: number;
  sold: number;
  returned: number;
  out: number;
}

export interface ConsignProgress {
  doc: Estimate;
  lines: ConsignLine[];
  bills: Invoice[];
  /** Value still with the party (rate × out, before tax). */
  outValue: number;
  settled: boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function consignmentProgress(doc: Estimate): Promise<ConsignProgress> {
  const [bills, moves] = await Promise.all([
    db.invoices.where('businessId').equals(doc.businessId).filter((i) => i.fromEstimateId === doc.id && !i.deleted && i.status !== 'cancelled').toArray(),
    db.stockMoves.where('businessId').equals(doc.businessId).filter((m) => m.consignmentId === doc.id && !m.deleted && !m.voidedAt).toArray(),
  ]);
  const saved = bills.filter((b) => b.status === 'saved');
  const lines = doc.lines.map((l) => {
    const sold = r3(saved.reduce((a, b) => a + b.lines.filter((x) => x.fromLineId === l.id).reduce((s, x) => s + x.qty, 0), 0));
    const returned = r3(moves.filter((m) => m.fromLineId === l.id).reduce((a, m) => a + m.qty / (l.unitFactor ?? 1), 0));
    return { lineId: l.id, itemId: l.itemId, name: l.name, unit: l.unit, rate: l.rate, sent: l.qty, sold, returned, out: Math.max(0, r3(l.qty - sold - returned)) };
  });
  return { doc, lines, bills, outValue: Math.round(lines.reduce((a, l) => a + l.out * l.rate, 0)), settled: lines.every((l) => l.out <= 0) };
}

/** A bill draft for goods still out (edit the quantities to what was actually sold). */
export async function billConsignment(actor: Actor, docId: string): Promise<Invoice> {
  const doc = await db.estimates.get(docId);
  if (!doc?.consignment) throw new Error(t('Not found'));
  const p = await consignmentProgress(doc);
  const out = new Map(p.lines.map((l) => [l.lineId, l.out]));
  const lines = doc.lines.filter((l) => (out.get(l.id) ?? 0) > 0).map((l) => ({ ...l, id: newId(), qty: out.get(l.id)!, fromLineId: l.id }));
  if (!lines.length) throw new Error(t('Nothing is still with the party'));
  const draft = await newInvoiceDraft(actor);
  return saveInvoice(
    actor,
    { ...draft, reference: t('Challan {number}', { number: doc.number }), taxMode: doc.taxMode ?? draft.taxMode, placeOfSupply: doc.placeOfSupply ?? null, billTo: doc.billTo, shipTo: doc.shipTo, lines, charges: [], roundOff: doc.roundOff, fromEstimateId: doc.id, godownId: doc.godownId },
    { finalize: false },
  );
}

/** Goods the party sent back: stock comes in again, tagged with the challan line. */
export async function takeBackConsignment(actor: Actor, docId: string, qtys: Record<string, number>, date = todayISO()): Promise<number> {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
  const doc = await db.estimates.get(docId);
  if (!doc?.consignment) throw new Error(t('Not found'));
  const p = await consignmentProgress(doc);
  let n = 0;
  for (const l of p.lines) {
    const q = Math.min(qtys[l.lineId] ?? 0, l.out);
    if (!(q > 0) || !l.itemId) continue;
    const factor = doc.lines.find((x) => x.id === l.lineId)?.unitFactor ?? 1;
    await putRecord('stockMoves', actor, {
      id: newId(),
      itemId: l.itemId,
      itemName: l.name,
      qty: r3(q * factor),
      kind: 'adjust',
      reason: 'other',
      note: t('Returned from challan {number}', { number: doc.number }),
      date,
      byName: actor.userName,
      consignmentId: doc.id,
      fromLineId: l.lineId,
      godownId: doc.godownId,
    } as StockMove);
    n++;
  }
  return n;
}

/** Goods out on sale-or-return, per party and item. */
export async function consignmentTable(businessId: string): Promise<ExportTable> {
  const docs = await db.estimates.where('businessId').equals(businessId).filter((e) => !!e.consignment && !e.deleted && e.status !== 'draft' && e.status !== 'declined').toArray();
  const rows: (string | number)[][] = [];
  for (const d of docs.sort((a, b) => a.date.localeCompare(b.date))) {
    const p = await consignmentProgress(d);
    for (const l of p.lines.filter((x) => x.out > 0)) rows.push([d.date, d.number, d.billTo?.name ?? '', l.name, l.sent, l.sold, l.returned, l.out, Math.round(l.out * l.rate)]);
  }
  return {
    title: t('Goods on sale or return'),
    landscape: true,
    columns: [
      { label: t('Date'), kind: 'date' },
      { label: t('Challan') },
      { label: t('Party') },
      { label: t('Item') },
      { label: t('Sent'), kind: 'qty' },
      { label: t('Sold'), kind: 'qty' },
      { label: t('Returned'), kind: 'qty' },
      { label: t('With them'), kind: 'qty' },
      { label: t('Value'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', '', '', '', '', '', '', rows.reduce((a, r) => a + (r[8] as number), 0)]],
    fileBase: 'Sale-or-return',
  };
}
