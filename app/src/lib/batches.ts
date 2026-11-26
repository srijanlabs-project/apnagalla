import { todayISO } from '@invoice/shared';
import { db, type DocLine } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { stockEvents } from './stock';

/**
 * Batch and expiry (medicines, packaged food, paint, seeds…). An item that keeps batches gets the
 * batch number and expiry month on each purchase line; a sale takes from a batch (the one expiring
 * first, unless the seller picks another). Stock per batch is added up from those lines, the same
 * way the item's stock is. Expiry is a month, "YYYY-MM", as printed on packs.
 */

export interface BatchStock {
  batch: string;
  expiry?: string;
  qty: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
export const thisMonth = (today = todayISO()) => today.slice(0, 7);
export const isExpired = (expiry: string | undefined, today = todayISO()) => !!expiry && expiry < thisMonth(today);

/** Batches of an item with stock left, the one expiring first at the top. */
export async function batchStock(businessId: string, itemId: string): Promise<BatchStock[]> {
  const events = (await stockEvents(businessId)).get(itemId) ?? [];
  const m = new Map<string, BatchStock>();
  for (const e of events) {
    const key = e.batch ?? '';
    const s = m.get(key) ?? (m.set(key, { batch: key, qty: 0 }), m.get(key)!);
    s.qty = round(s.qty + e.qty);
    if (e.expiry && (!s.expiry || e.kind === 'purchase' || e.kind === 'opening')) s.expiry = e.expiry;
  }
  return [...m.values()].filter((b) => b.qty > 0).sort((a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999') || a.batch.localeCompare(b.batch));
}

/** First expiry first: the oldest batch that hasn't expired (else the oldest one). */
export function pickBatch(list: BatchStock[], today = todayISO()): BatchStock | undefined {
  const named = list.filter((b) => b.batch);
  return named.find((b) => !isExpired(b.expiry, today)) ?? named[0];
}

/** Lines of batch items that have no batch yet get the one expiring first (when a bill is saved). */
export async function fillBatches<L extends DocLine>(businessId: string, lines: L[]): Promise<L[]> {
  const ids = [...new Set(lines.filter((l) => l.itemId && !l.batch).map((l) => l.itemId!))];
  if (!ids.length) return lines;
  const items = await db.items.bulkGet(ids);
  const batchItems = new Set(items.filter((i) => i?.trackBatch).map((i) => i!.id));
  if (!batchItems.size) return lines;
  const out: L[] = [];
  for (const l of lines) {
    if (!l.itemId || l.batch || !batchItems.has(l.itemId)) {
      out.push(l);
      continue;
    }
    const b = pickBatch(await batchStock(businessId, l.itemId));
    out.push(b ? { ...l, batch: b.batch, expiry: b.expiry } : l);
  }
  return out;
}

/** "Batch B12 · Exp 03/2027", printed under a line. */
export function batchText(l: Pick<DocLine, 'batch' | 'expiry'>): string {
  const exp = l.expiry ? `${l.expiry.slice(5, 7)}/${l.expiry.slice(0, 4)}` : '';
  return [l.batch ? `Batch ${l.batch}` : '', exp ? `Exp ${exp}` : ''].filter(Boolean).join(' · ');
}

/** Months between this month and the expiry month (negative = expired). */
export function monthsLeft(expiry: string, today = todayISO()): number {
  const [y, m] = expiry.split('-').map(Number) as [number, number];
  const [ty, tm] = thisMonth(today).split('-').map(Number) as [number, number];
  return (y - ty) * 12 + (m - tm);
}

/** Expiry report: batches with stock that expire within `months` (and those already expired). */
export async function expiryTable(businessId: string, months = 3, withCost = true): Promise<ExportTable> {
  const items = await db.items.where('businessId').equals(businessId).filter((i) => !!i.trackBatch && !i.deleted).toArray();
  const rows: (string | number | null)[][] = [];
  for (const it of items) {
    for (const b of await batchStock(businessId, it.id)) {
      if (!b.expiry) continue;
      const left = monthsLeft(b.expiry);
      if (left > months) continue;
      rows.push([it.name, b.batch || '—', `${b.expiry.slice(5, 7)}/${b.expiry.slice(0, 4)}`, left < 0 ? t('Expired') : left === 0 ? t('This month') : t('{n} months', { n: left }), b.qty, it.unit, withCost ? Math.round(b.qty * (it.purchasePrice ?? 0)) : null]);
    }
  }
  rows.sort((a, b) => String(a[2]).split('/').reverse().join('').localeCompare(String(b[2]).split('/').reverse().join('')));
  return {
    title: t('Expiring stock'),
    subtitle: [t('Expired and expiring within {n} months', { n: months })],
    columns: [
      { label: t('Item') },
      { label: t('Batch') },
      { label: t('Expiry') },
      { label: t('Left') },
      { label: t('Qty'), kind: 'qty' },
      { label: t('Unit') },
      ...(withCost ? [{ label: t('Value at cost'), kind: 'money' as const }] : []),
    ],
    rows: withCost ? rows : rows.map((r) => r.slice(0, 6)),
    ...(withCost ? { foot: [[t('Total'), '', '', '', '', '', rows.reduce((a, r) => a + ((r[6] as number) ?? 0), 0)]] } : {}),
    fileBase: 'Expiring-stock',
  };
}
