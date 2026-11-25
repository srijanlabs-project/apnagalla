import { todayISO } from '@invoice/shared';
import { db, type Item, type StockMove, type StockReason } from './db';
import { t } from './i18n';
import { newId, putRecord, type Actor } from './repo';

/**
 * Stock is never kept as one number (two phones would overwrite each other). It is added up from
 * what happened: opening stock and manual changes, purchase bills and returns to suppliers, sales
 * and customer returns. Cancelled and draft documents don't count.
 */

/** Does this item keep count of stock? Services and area-priced items don't. */
export const tracksStock = (item: Pick<Item, 'trackStock' | 'pricing' | 'deleted'>): boolean =>
  !item.deleted && item.trackStock !== false && (item.pricing ?? 'unit') === 'unit';

const round = (n: number) => Math.round(n * 1000) / 1000;

/** One change to an item's stock, for its history. */
export interface StockEvent {
  date: string;
  /** Signed quantity. */
  qty: number;
  kind: 'opening' | 'adjust' | 'count' | 'sale' | 'return' | 'purchase' | 'purchase_return';
  label: string;
  /** Where to open it in the app. */
  href?: string;
  /** Manual change: can be voided by the owner. */
  move?: StockMove;
}

/** Everything that changed stock in a store, per item. `upTo` = include only up to that date. */
export async function stockEvents(businessId: string, upTo?: string): Promise<Map<string, StockEvent[]>> {
  const [moves, invoices, notes, purchases] = await Promise.all([
    db.stockMoves.where('businessId').equals(businessId).toArray(),
    db.invoices.where('businessId').equals(businessId).filter((d) => d.status === 'saved' && !d.deleted).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter((d) => d.status === 'saved' && !d.deleted && d.reason === 'return').toArray(),
    db.purchases.where('businessId').equals(businessId).filter((d) => d.status === 'saved' && !d.deleted).toArray(),
  ]);
  const map = new Map<string, StockEvent[]>();
  const add = (itemId: string | null | undefined, e: StockEvent) => {
    if (!itemId || (upTo && e.date > upTo)) return;
    let list = map.get(itemId);
    if (!list) map.set(itemId, (list = []));
    list.push(e);
  };
  for (const m of moves) {
    if (m.deleted || m.voidedAt) continue;
    add(m.itemId, { date: m.date, qty: m.qty, kind: m.kind, label: m.kind === 'opening' ? t('Opening stock') : reasonLabel(m.reason), move: m });
  }
  for (const inv of invoices) {
    for (const l of inv.lines) add(l.itemId, { date: inv.date, qty: -l.qty, kind: 'sale', label: t('Sale {number}', { number: inv.number }), href: `/tabs/invoices/${inv.id}` });
  }
  for (const n of notes) {
    for (const l of n.lines) add(l.itemId, { date: n.date, qty: l.qty, kind: 'return', label: t('Return {number}', { number: n.number }), href: `/tabs/credit-notes/${n.id}` });
  }
  for (const p of purchases) {
    const ret = p.kind === 'return';
    for (const l of p.lines) {
      add(l.itemId, {
        date: p.date,
        qty: ret ? -l.qty : l.qty,
        kind: ret ? 'purchase_return' : 'purchase',
        label: p.supplier?.name ? (ret ? t('Returned to {name}', { name: p.supplier.name }) : t('Bought from {name}', { name: p.supplier.name })) : ret ? t('Purchase return') : t('Purchase'),
        href: `/tabs/purchases/${p.id}`,
      });
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

/** Stock of every item in the store (items with nothing recorded are 0). */
export async function stockLevels(businessId: string, upTo?: string): Promise<Map<string, number>> {
  const events = await stockEvents(businessId, upTo);
  const levels = new Map<string, number>();
  for (const [itemId, list] of events) levels.set(itemId, round(list.reduce((a, e) => a + e.qty, 0)));
  return levels;
}

export const isLow = (item: Pick<Item, 'lowStock' | 'trackStock' | 'pricing' | 'deleted'>, qty: number): boolean =>
  tracksStock(item) && item.lowStock != null && qty <= item.lowStock;

/** Quantity to suggest ordering: the item's usual order, else enough to get back above the low level. */
export function suggestedOrder(item: Pick<Item, 'lowStock' | 'reorderQty'>, qty: number): number {
  if (item.reorderQty && item.reorderQty > 0) return item.reorderQty;
  const target = Math.max(1, (item.lowStock ?? 0) * 2);
  return Math.max(1, Math.ceil(target - qty));
}

export const STOCK_REASONS: StockReason[] = ['damage', 'theft', 'expired', 'count', 'gift', 'own_use', 'other'];

const REASON_TEXT: Record<StockReason, () => string> = {
  opening: () => t('Opening stock'),
  damage: () => t('Damaged'),
  theft: () => t('Lost / stolen'),
  expired: () => t('Expired'),
  count: () => t('Stock count'),
  gift: () => t('Free / sample'),
  own_use: () => t('Own use'),
  other: () => t('Other'),
};
export const reasonLabel = (r: StockReason): string => REASON_TEXT[r]?.() ?? r;

/** Opening stock for an item (when it is first entered, or by Excel import). */
export async function setOpeningStock(actor: Actor, item: Pick<Item, 'id' | 'name'>, qty: number, date = todayISO()): Promise<StockMove> {
  return putRecord('stockMoves', actor, {
    id: newId(),
    itemId: item.id,
    itemName: item.name,
    qty: round(qty),
    kind: 'opening',
    reason: 'opening',
    date,
    byName: actor.userName,
  } as StockMove);
}

/**
 * A manual change. `count` = the shelf was counted: the change is what makes stock equal to the
 * counted number. Otherwise `qty` is the signed change itself.
 */
export async function adjustStock(
  actor: Actor,
  item: Pick<Item, 'id' | 'name'>,
  input: { kind: 'adjust'; qty: number; reason: StockReason; note?: string } | { kind: 'count'; counted: number; note?: string },
  date = todayISO(),
): Promise<StockMove | null> {
  let qty: number;
  let reason: StockReason;
  if (input.kind === 'count') {
    const now = (await stockLevels(actor.businessId)).get(item.id) ?? 0;
    qty = round(input.counted - now);
    reason = 'count';
  } else {
    qty = round(input.qty);
    reason = input.reason;
  }
  if (qty === 0) return null;
  return putRecord('stockMoves', actor, {
    id: newId(),
    itemId: item.id,
    itemName: item.name,
    qty,
    kind: input.kind,
    reason,
    note: input.note?.trim() || undefined,
    date,
    byName: actor.userName,
  } as StockMove);
}

/** The owner voids a wrong manual change; it stays in the history. */
export async function voidStockMove(actor: Actor, id: string, reason: string): Promise<void> {
  const m = await db.stockMoves.get(id);
  if (!m || m.voidedAt) return;
  await putRecord('stockMoves', actor, { ...m, voidedAt: new Date().toISOString(), voidedBy: actor.userId, voidedByName: actor.userName, voidReason: reason.trim() });
}

/** "12", "2.5" — up to 3 decimals, no trailing zeros. */
export const qtyText = (n: number): string => String(round(n));
