import { db, type DocLine, type Item, type PriceLevel } from './db';
import { newId, putRecord, type Actor } from './repo';
import { t } from './i18n';

/** Price per base unit for a customer type (falls back to the retail price). */
export function priceFor(item: Pick<Item, 'rate' | 'prices'>, level: PriceLevel = 'retail'): number {
  if (level === 'retail') return item.rate;
  return item.prices?.[level] || item.rate;
}

export interface UnitOption {
  unit: string;
  factor: number;
  rate: number;
}

/** The base unit and the item's other units, each with its price for this customer type. */
export function unitOptions(item: Pick<Item, 'unit' | 'rate' | 'prices' | 'altUnits'>, level: PriceLevel = 'retail'): UnitOption[] {
  const base = priceFor(item, level);
  return [
    { unit: item.unit, factor: 1, rate: base },
    ...(item.altUnits ?? [])
      .filter((u) => u.unit && u.factor > 0)
      .map((u) => ({ unit: u.unit, factor: u.factor, rate: level === 'retail' && u.rate ? u.rate : Math.round(base * u.factor) })),
  ];
}

/** Quantity in the item's base unit. */
export const baseQty = (l: Pick<DocLine, 'qty' | 'unitFactor'>) => l.qty * (l.unitFactor ?? 1);

export const levelLabel = (l: PriceLevel): string => ({ retail: t('Retail'), wholesale: t('Wholesale'), special: t('Special') })[l];

/** Re-prices lines from catalogue items for a customer type (e.g. a wholesale customer picked). */
export async function repriceLines<L extends DocLine>(lines: L[], level: PriceLevel): Promise<L[]> {
  const items = await db.items.bulkGet(lines.map((l) => l.itemId ?? ''));
  return lines.map((l, i) => {
    const it = items[i];
    if (!it || l.dims) return l;
    const opt = unitOptions(it, level).find((u) => u.unit === l.unit && u.factor === (l.unitFactor ?? 1));
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
