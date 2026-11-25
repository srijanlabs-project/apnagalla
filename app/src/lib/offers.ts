import { allocateProportionally, todayISO } from '@invoice/shared';
import { withDescendants } from './categories';
import type { Category, DocLine, Item, Offer } from './db';
import { t } from './i18n';

/**
 * Offers set line discounts on a bill: % off a category (or everything), buy N get M free of an
 * item, or a combo of items for a set price. Lines with a discount typed by hand are left alone,
 * and a line the cashier took the offer off (offer = "off") stays without it.
 */

export const OFF = 'off';

export function offerRuns(o: Offer, date = todayISO()): boolean {
  return o.active && !o.deleted && (!o.from || o.from <= date) && (!o.to || o.to >= date);
}

const baseRate = (l: DocLine) => (l.rateIncludesTax && l.taxPct ? l.rate / (1 + l.taxPct / 100) : l.rate);
const gross = (l: DocLine) => Math.round(l.qty * baseRate(l));

export function describeOffer(o: Offer, itemName: (id: string) => string, catName: (id: string) => string): string {
  if (o.kind === 'percent') return t('{pct}% off {what}', { pct: o.pct ?? 0, what: o.categoryId ? catName(o.categoryId) : o.itemId ? itemName(o.itemId) : t('everything') });
  if (o.kind === 'buyget') return t('Buy {buy} get {get} free: {item}', { buy: o.buyQty ?? 0, get: o.getQty ?? 0, item: itemName(o.itemId ?? '') });
  return t('{items} for {price}', { items: (o.combo ?? []).map((c) => `${c.qty} × ${itemName(c.itemId)}`).join(' + '), price: ((o.comboPrice ?? 0) / 100).toFixed(2) });
}

/** Returns the lines with offer discounts set (or cleared where an offer no longer applies). */
export function applyOffers(lines: DocLine[], offers: Offer[], items: Map<string, Item>, cats: Category[], date = todayISO()): DocLine[] {
  const running = offers.filter((o) => offerRuns(o, date));
  // Start from the lines without any earlier offer discount; hand discounts and "off" stay.
  const out = lines.map((l) => (l.offer && l.offer !== OFF ? { ...l, offer: null, discount: null } : l));
  const free = (l: DocLine) => !l.offer && !(l.discount && l.discount.value > 0) && !!l.itemId && !l.dims;

  for (const o of running) {
    if (o.kind === 'percent' && o.pct && o.pct > 0) {
      const inCat = o.categoryId ? withDescendants(o.categoryId, cats) : null;
      out.forEach((l, i) => {
        if (!free(l)) return;
        const it = items.get(l.itemId!);
        const parentCat = it?.variantOf ? items.get(it.variantOf)?.categoryId : undefined;
        const match = o.itemId ? l.itemId === o.itemId || it?.variantOf === o.itemId : inCat ? !!(it?.categoryId && inCat.has(it.categoryId)) || !!(parentCat && inCat.has(parentCat)) : true;
        if (match) out[i] = { ...l, discount: { type: 'pct', value: Math.min(o.pct!, 100) }, offer: o.name };
      });
    }
    if (o.kind === 'buyget' && o.itemId && (o.buyQty ?? 0) > 0 && (o.getQty ?? 0) > 0) {
      out.forEach((l, i) => {
        if (!free(l) || (l.itemId !== o.itemId && items.get(l.itemId!)?.variantOf !== o.itemId)) return;
        const units = l.qty * (l.unitFactor ?? 1);
        const freeUnits = Math.floor(units / (o.buyQty! + o.getQty!)) * o.getQty!;
        if (freeUnits <= 0) return;
        const value = Math.round((freeUnits / (l.unitFactor ?? 1)) * baseRate(l));
        out[i] = { ...l, discount: { type: 'amount', value }, offer: o.name };
      });
    }
    if (o.kind === 'combo' && o.combo?.length && (o.comboPrice ?? 0) > 0) {
      const idx = o.combo.map((c) => out.findIndex((l) => free(l) && l.itemId === c.itemId));
      if (idx.some((i) => i < 0)) continue;
      const sets = Math.min(...o.combo.map((c, k) => Math.floor((out[idx[k]!]!.qty * (out[idx[k]!]!.unitFactor ?? 1)) / c.qty)));
      if (sets <= 0) continue;
      // Value of the sets at the normal prices (before tax), less the combo price before tax.
      const parts = o.combo.map((c, k) => {
        const l = out[idx[k]!]!;
        return Math.round(((sets * c.qty) / (l.unitFactor ?? 1)) * baseRate(l));
      });
      const normal = parts.reduce((a, v) => a + v, 0);
      const firstLine = out[idx[0]!]!;
      const comboBase = Math.round((sets * o.comboPrice!) / (firstLine.rateIncludesTax && firstLine.taxPct ? 1 + firstLine.taxPct / 100 : 1));
      const saving = Math.max(0, normal - comboBase);
      if (!saving) continue;
      const shares = allocateProportionally(saving, parts);
      idx.forEach((i, k) => {
        const l = out[i]!;
        out[i] = { ...l, discount: { type: 'amount', value: Math.min(shares[k]!, gross(l)) }, offer: o.name };
      });
    }
  }
  return out;
}

/** Same lines, same discounts and offers? (to avoid re-saving unchanged lines) */
export const sameOffers = (a: DocLine[], b: DocLine[]) =>
  a.length === b.length && a.every((l, i) => (l.offer ?? null) === (b[i]!.offer ?? null) && JSON.stringify(l.discount ?? null) === JSON.stringify(b[i]!.discount ?? null));
