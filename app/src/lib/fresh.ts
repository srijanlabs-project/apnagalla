import { todayISO } from '@invoice/shared';
import { db, type Item, type StockMove } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { withPriceHistory } from './pricing';
import { newId, PermissionError, putRecord, type Actor } from './repo';

/**
 * R11 fruit and vegetable shops (and anything sold loose): today's rates in one go, a rate card to
 * send customers, selling by amount ("₹20 of dhaniya"), daily wastage and the margin after it.
 */

const canChange = (actor: Actor) => {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
};

/** Saves the morning's prices (each change goes into the item's price history). */
export async function saveRates(actor: Actor, changes: { item: Item; rate: number }[]): Promise<number> {
  canChange(actor);
  let n = 0;
  for (const c of changes) {
    if (!(c.rate > 0) || c.rate === c.item.rate) continue;
    await putRecord('items', actor, withPriceHistory(c.item, { ...c.item, rate: Math.round(c.rate) }, actor.userName));
    n++;
  }
  return n;
}

/** "Today's rates" message for WhatsApp. */
export function rateCardText(storeName: string, items: Pick<Item, 'name' | 'rate' | 'unit'>[], date = todayISO()): string {
  const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  return [`*${storeName}*`, t('Today’s rates ({date})', { date: date.split('-').reverse().join('/') }), '', ...items.map((i) => `${i.name}: ${rs(i.rate)}/${i.unit}`)].join('\n');
}

/** Quantity for an amount the customer wants to spend ("₹20 of dhaniya"), to 3 decimals. */
export function qtyForAmount(amount: number, rate: number, taxPct = 0, rateIncludesTax = true): number {
  const perUnit = rateIncludesTax ? rate : rate * (1 + taxPct / 100);
  return perUnit > 0 ? Math.round((amount / perUnit) * 1000) / 1000 : 0;
}

/** Records the day's wastage (thrown away, spoilt) as stock taken out. */
export async function saveWastage(actor: Actor, entries: { item: Pick<Item, 'id' | 'name'>; qty: number }[], date = todayISO()): Promise<number> {
  canChange(actor);
  let n = 0;
  for (const e of entries) {
    if (!(e.qty > 0)) continue;
    await putRecord('stockMoves', actor, { id: newId(), itemId: e.item.id, itemName: e.item.name, qty: -Math.round(e.qty * 1000) / 1000, kind: 'adjust', reason: 'wastage', date, byName: actor.userName } as StockMove);
    n++;
  }
  return n;
}

/** Wastage report: per item, sold vs wasted, the cost of what was thrown, and the margin after it. */
export async function wastageTable(businessId: string, from: string, to: string): Promise<ExportTable> {
  const [items, moves, invoices] = await Promise.all([
    db.items.where('businessId').equals(businessId).toArray(),
    db.stockMoves.where('businessId').equals(businessId).filter((m) => !m.deleted && !m.voidedAt && (m.reason === 'wastage' || m.reason === 'expired' || m.reason === 'damage') && m.date >= from && m.date <= to).toArray(),
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && i.date >= from && i.date <= to).toArray(),
  ]);
  const itemOf = new Map(items.map((i) => [i.id, i]));
  const m = new Map<string, { name: string; unit: string; sold: number; sales: number; waste: number }>();
  const slot = (id: string) => {
    const it = itemOf.get(id);
    return m.get(id) ?? (m.set(id, { name: it?.name ?? '', unit: it?.unit ?? '', sold: 0, sales: 0, waste: 0 }), m.get(id)!);
  };
  for (const mv of moves) slot(mv.itemId).waste += -mv.qty;
  for (const inv of invoices)
    inv.lines.forEach((l, i) => {
      if (!l.itemId || !m.has(l.itemId)) return;
      const s = slot(l.itemId);
      s.sold += l.qty * (l.unitFactor ?? 1);
      s.sales += inv.totals.lines[i]?.taxable ?? 0;
    });
  const rows = [...m.entries()]
    .map(([id, s]) => {
      const cost = itemOf.get(id)?.purchasePrice ?? 0;
      const wasteCost = Math.round(s.waste * cost);
      const margin = s.sales - Math.round(s.sold * cost);
      const pct = s.sold + s.waste > 0 ? Math.round((s.waste / (s.sold + s.waste)) * 1000) / 10 : 0;
      return [s.name, Math.round(s.sold * 1000) / 1000, Math.round(s.waste * 1000) / 1000, s.unit, `${pct}%`, wasteCost, margin - wasteCost];
    })
    .sort((a, b) => (b[5] as number) - (a[5] as number));
  return {
    title: t('Wastage'),
    subtitle: [`${from.split('-').reverse().join('/')} – ${to.split('-').reverse().join('/')}`, t('Thrown away, spoilt, expired and damaged; cost at the item’s purchase price.')],
    landscape: true,
    columns: [{ label: t('Item') }, { label: t('Sold'), kind: 'qty' }, { label: t('Wasted'), kind: 'qty' }, { label: t('Unit') }, { label: t('Wasted %') }, { label: t('Cost of wastage'), kind: 'money' }, { label: t('Margin after wastage'), kind: 'money' }],
    rows,
    foot: [[t('Total'), null, null, '', '', rows.reduce((a, r) => a + (r[5] as number), 0), rows.reduce((a, r) => a + (r[6] as number), 0)]],
    fileBase: `Wastage-${from}-${to}`,
  };
}
