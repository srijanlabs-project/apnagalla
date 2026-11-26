import { todayISO } from '@invoice/shared';
import { db, type BusinessSettings, type Item, type StockMove } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { newId, PermissionError, putRecord, type Actor } from './repo';
import { stockEvents } from './stock';

/**
 * Godowns inside one store (a back room, a warehouse down the road). The shop counter is the place
 * "" ("Shop"). Purchase bills say where goods arrived, bills and challans where they left from, and
 * a godown transfer is two stock entries (out of one place, into the other) that add up to zero, so
 * the store's total stock never changes by moving goods.
 */

export const SHOP = '';

export const godownsOf = (s: Pick<BusinessSettings, 'godowns'>) => (s.godowns ?? []).filter((g) => !g.deleted);
export const placeName = (s: Pick<BusinessSettings, 'godowns'>, id: string | null | undefined) => (!id ? t('Shop') : ((s.godowns ?? []).find((g) => g.id === id)?.name ?? t('Godown')));

/** Stock of every item in every place: itemId → placeId → qty. */
export async function stockByPlace(businessId: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  for (const [itemId, list] of await stockEvents(businessId)) {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.godownId ?? SHOP, Math.round(((m.get(e.godownId ?? SHOP) ?? 0) + e.qty) * 1000) / 1000);
    out.set(itemId, m);
  }
  return out;
}

/** Moves goods between two places of this store (anyone who can change stock). */
export async function moveBetweenGodowns(actor: Actor, from: string, to: string, lines: { item: Pick<Item, 'id' | 'name'>; qty: number }[], note?: string, date = todayISO()): Promise<string> {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
  if (from === to) throw new Error(t('Pick two different places'));
  const transferId = newId();
  for (const l of lines.filter((x) => x.qty > 0)) {
    const base = { itemId: l.item.id, itemName: l.item.name, kind: 'transfer' as const, reason: 'transfer' as const, date, byName: actor.userName, transferId, note: note?.trim() || undefined };
    await putRecord('stockMoves', actor, { ...base, id: newId(), qty: -l.qty, godownId: from || undefined, toGodownId: to || SHOP } as StockMove);
    await putRecord('stockMoves', actor, { ...base, id: newId(), qty: l.qty, godownId: to || undefined, fromGodownId: from || SHOP } as StockMove);
  }
  return transferId;
}

/** Stock by godown report: one row per item with stock, a column per place. */
export async function godownStockTable(businessId: string, settings: Pick<BusinessSettings, 'godowns'>): Promise<ExportTable> {
  const places = [SHOP, ...godownsOf(settings).map((g) => g.id)];
  const [items, byPlace] = await Promise.all([db.items.where('businessId').equals(businessId).filter((i) => !i.deleted).toArray(), stockByPlace(businessId)]);
  const rows = items
    .map((it) => ({ it, m: byPlace.get(it.id) }))
    .filter(({ m }) => m && [...m.values()].some((q) => q !== 0))
    .sort((a, b) => a.it.name.localeCompare(b.it.name))
    .map(({ it, m }) => [it.name, it.unit, ...places.map((p) => m!.get(p) ?? 0), [...m!.values()].reduce((a, q) => a + q, 0)]);
  return {
    title: t('Stock by godown'),
    columns: [{ label: t('Item') }, { label: t('Unit') }, ...places.map((p) => ({ label: placeName(settings, p), kind: 'qty' as const })), { label: t('Total'), kind: 'qty' as const }],
    rows,
    fileBase: 'Stock-by-godown',
  };
}
