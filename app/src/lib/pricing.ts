import { db, type DocLine, type Item, type PriceLevel } from './db';
import { newId, putRecord, type Actor } from './repo';
import { t } from './i18n';

/** Price per base unit for a customer type (falls back to the retail price). */
export function priceFor(item: Pick<Item, 'rate' | 'prices'>, level: PriceLevel = 'retail'): number {
  if (level === 'retail') return item.rate;
  return item.prices?.[level] || item.rate;
}

/** R9: a customer's own prices (itemId → paise per base unit), if any. */
export type CustomPrices = Record<string, number> | undefined;

/** The price for this customer: their own price for the item, else their type's price. */
export const customerPrice = (item: Pick<Item, 'id' | 'rate' | 'prices'>, level: PriceLevel = 'retail', custom?: CustomPrices) => (custom?.[item.id] ? custom[item.id]! : priceFor(item, level));

export interface UnitOption {
  unit: string;
  factor: number;
  rate: number;
}

/** The base unit and the item's other units, each with its price for this customer type. */
export function unitOptions(item: Pick<Item, 'id' | 'unit' | 'rate' | 'prices' | 'altUnits'>, level: PriceLevel = 'retail', custom?: CustomPrices): UnitOption[] {
  const base = customerPrice(item, level, custom);
  return [
    { unit: item.unit, factor: 1, rate: base },
    ...(item.altUnits ?? [])
      .filter((u) => u.unit && u.factor > 0)
      .map((u) => ({ unit: u.unit, factor: u.factor, rate: level === 'retail' && u.rate && !custom?.[item.id] ? u.rate : Math.round(base * u.factor) })),
  ];
}

/** Quantity in the item's base unit. */
export const baseQty = (l: Pick<DocLine, 'qty' | 'unitFactor'>) => l.qty * (l.unitFactor ?? 1);

export const levelLabel = (l: PriceLevel): string => ({ retail: t('Retail'), wholesale: t('Wholesale'), special: t('Special') })[l];

/** Re-prices lines from catalogue items for a customer type (e.g. a wholesale customer picked). */
export async function repriceLines<L extends DocLine>(lines: L[], level: PriceLevel, custom?: CustomPrices): Promise<L[]> {
  const items = await db.items.bulkGet(lines.map((l) => l.itemId ?? ''));
  return lines.map((l, i) => {
    const it = items[i];
    if (!it || l.dims) return l;
    const opt = unitOptions(it, level, custom).find((u) => u.unit === l.unit && u.factor === (l.unitFactor ?? 1));
    return opt ? { ...l, rate: opt.rate } : l;
  });
}

/** Variant children of an item. */
export async function variantsOf(parentId: string): Promise<Item[]> {
  return (await db.items.filter((i) => i.variantOf === parentId && !i.deleted).toArray()).sort((a, b) => (a.variantLabel ?? a.name).localeCompare(b.variantLabel ?? b.name));
}

/** Items that can go on a bill: not variant groups, not deleted. */
export const sellable = (i: Item) => !i.deleted && !i.hasVariants;

/**
 * Makes variants of an item for each size × colour (either list may be empty). The item becomes
 * their group: it keeps the shared details, each variant its own stock, barcode and price.
 */
export async function createVariants(actor: Actor, parent: Item, sizes: string[], colours: string[]): Promise<Item[]> {
  const clean = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))];
  const S = clean(sizes);
  const C = clean(colours);
  const labels = S.length && C.length ? S.flatMap((s) => C.map((c) => `${s} · ${c}`)) : [...S, ...C];
  if (!labels.length) return [];
  const existing = new Set((await variantsOf(parent.id)).map((v) => v.variantLabel));
  const made: Item[] = [];
  for (const label of labels) {
    if (existing.has(label)) continue;
    const { id: _id, createdAt: _c, updatedAt: _u, updatedBy: _b, barcode: _bc, code: _code, hasVariants: _h, ...shared } = parent;
    made.push(await putRecord('items', actor, { ...shared, id: newId(), name: `${parent.name} · ${label}`, variantOf: parent.id, variantLabel: label, hasVariants: false } as Item));
  }
  if (!parent.hasVariants) await putRecord('items', actor, { ...parent, hasVariants: true });
  return made;
}

/** Copies the group's price, tax, HSN and MRP to all its variants. */
export async function applyToVariants(actor: Actor, parent: Item): Promise<number> {
  const list = await variantsOf(parent.id);
  for (const v of list) {
    await putRecord('items', actor, { ...v, rate: parent.rate, rateIncludesTax: parent.rateIncludesTax, taxPct: parent.taxPct, hsn: parent.hsn, mrp: parent.mrp, prices: parent.prices, purchasePrice: parent.purchasePrice ?? v.purchasePrice });
  }
  return list.length;
}

/** Adds a price change to the item's history (last 20), when the selling price changed. */
export function withPriceHistory(before: Pick<Item, 'rate' | 'priceHistory'> | undefined, next: Item, byName: string): Item {
  if (!before || before.rate === next.rate) return next;
  const entry = { at: new Date().toISOString(), from: before.rate, to: next.rate, byName };
  return { ...next, priceHistory: [...(before.priceHistory ?? []), entry].slice(-20) };
}

export interface BulkChange {
  categoryIds: Set<string> | null;
  /** + raise, − lower. */
  by: number;
  kind: 'pct' | 'amount';
  /** Round the new price to this many rupees (0 = to the paisa). */
  roundTo: 0 | 1 | 5 | 10;
}

/** New selling price per item (unchanged ones left out). */
export function bulkPrices(items: Item[], c: BulkChange): { item: Item; to: number }[] {
  const step = c.roundTo * 100;
  return items
    .filter((i) => !i.deleted && !i.hasVariants && (!c.categoryIds || (i.categoryId && c.categoryIds.has(i.categoryId))))
    .map((item) => {
      let to = c.kind === 'pct' ? item.rate * (1 + c.by / 100) : item.rate + c.by;
      to = step ? Math.round(to / step) * step : Math.round(to);
      return { item, to: Math.max(0, to) };
    })
    .filter((x) => x.to !== x.item.rate);
}

export async function applyBulkPrices(actor: Actor, changes: { item: Item; to: number }[]): Promise<number> {
  for (const { item, to } of changes) await putRecord('items', actor, withPriceHistory(item, { ...item, rate: to }, actor.userName));
  return changes.length;
}
