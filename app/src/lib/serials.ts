import { db, type DocLine } from './db';
import { t } from './i18n';

/**
 * Serial / IMEI numbers: in on purchase bills (out on returns to the supplier), out on sales (back
 * in on customer returns). A number in stock is one that came in more times than it went out.
 */

const norm = (s: string) => s.trim().toUpperCase();

export interface SerialEvent {
  date: string;
  kind: 'bought' | 'returned_to_supplier' | 'sold' | 'returned_by_customer';
  itemId: string;
  itemName: string;
  party: string;
  ref: string;
  href: string;
  warrantyMonths?: number | null;
}

export async function serialEvents(businessId: string): Promise<Map<string, SerialEvent[]>> {
  const [purchases, invoices, notes] = await Promise.all([
    db.purchases.where('businessId').equals(businessId).filter((p) => p.status === 'saved' && !p.deleted).toArray(),
    db.invoices.where('businessId').equals(businessId).filter((d) => d.status === 'saved' && !d.deleted).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter((d) => d.status === 'saved' && !d.deleted && d.reason === 'return').toArray(),
  ]);
  const map = new Map<string, SerialEvent[]>();
  const add = (s: string, e: SerialEvent) => {
    const k = norm(s);
    if (!k) return;
    map.set(k, [...(map.get(k) ?? []), e]);
  };
  for (const p of purchases)
    for (const l of p.lines)
      for (const s of l.serials ?? [])
        add(s, { date: p.date, kind: p.kind === 'return' ? 'returned_to_supplier' : 'bought', itemId: l.itemId ?? '', itemName: l.name, party: p.supplier?.name ?? '', ref: p.supplierBillNo, href: `/tabs/purchases/${p.id}` });
  for (const inv of invoices)
    for (const l of inv.lines)
      for (const s of l.serials ?? [])
        add(s, { date: inv.date, kind: 'sold', itemId: l.itemId ?? '', itemName: l.name, party: inv.billTo?.name ?? '', ref: inv.number, href: `/tabs/invoices/${inv.id}`, warrantyMonths: l.warrantyMonths });
  for (const n of notes)
    for (const l of n.lines)
      for (const s of l.serials ?? [])
        add(s, { date: n.date, kind: 'returned_by_customer', itemId: l.itemId ?? '', itemName: l.name, party: n.billTo?.name ?? '', ref: n.number, href: `/tabs/credit-notes/${n.id}` });
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

const IN = new Set<SerialEvent['kind']>(['bought', 'returned_by_customer']);

/** Serial numbers of an item that are in the shop now. */
export async function serialsInStock(businessId: string, itemId: string): Promise<string[]> {
  const out: string[] = [];
  for (const [serial, list] of await serialEvents(businessId)) {
    const mine = list.filter((e) => e.itemId === itemId);
    if (!mine.length) continue;
    const balance = mine.reduce((a, e) => a + (IN.has(e.kind) ? 1 : -1), 0);
    if (balance > 0) out.push(serial);
  }
  return out.sort();
}

/** "2026-11-25" + 12 months → "2027-11-24" (the day before). */
export function warrantyEnd(saleDate: string, months: number): string {
  const d = new Date(`${saleDate}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Printed under the line: "IMEI / S.No: 3567…, 3567… · Warranty till 24/11/2027". */
export function serialText(l: Pick<DocLine, 'serials' | 'warrantyMonths'>, docDate: string): string {
  const parts: string[] = [];
  if (l.serials?.length) parts.push(`IMEI / S.No: ${l.serials.join(', ')}`);
  if (l.warrantyMonths) parts.push(t('Warranty till {date}', { date: warrantyEnd(docDate, l.warrantyMonths).split('-').reverse().join('/') }));
  return parts.join(' · ');
}

export const SERIAL_KIND_TEXT: Record<SerialEvent['kind'], () => string> = {
  bought: () => t('Bought'),
  returned_to_supplier: () => t('Returned to supplier'),
  sold: () => t('Sold'),
  returned_by_customer: () => t('Returned by customer'),
};
