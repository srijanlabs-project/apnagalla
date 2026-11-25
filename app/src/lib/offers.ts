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
  const min = o.minBill ? ` · ${t('bills of {amount}+', { amount: (o.minBill / 100).toFixed(0) })}` : '';
  const code = o.code ? ` · ${t('code {code}', { code: o.code })}` : '';
  return describeKind(o, itemName, catName) + min + code;
}

function describeKind(o: Offer, itemName: (id: string) => string, catName: (id: string) => string): string {
  if (o.kind === 'amount') return t('₹{amount} off {what}', { amount: ((o.amount ?? 0) / 100).toFixed(0), what: o.categoryId ? catName(o.categoryId) : t('the bill') });
  if (o.kind === 'percent') return t('{pct}% off {what}', { pct: o.pct ?? 0, what: o.categoryId ? catName(o.categoryId) : o.itemId ? itemName(o.itemId) : t('everything') });
  if (o.kind === 'buyget') return t('Buy {buy} get {get} free: {item}', { buy: o.buyQty ?? 0, get: o.getQty ?? 0, item: itemName(o.itemId ?? '') });
  return t('{items} for {price}', { items: (o.combo ?? []).map((c) => `${c.qty} × ${itemName(c.itemId)}`).join(' + '), price: ((o.comboPrice ?? 0) / 100).toFixed(2) });
}

/** Returns the lines with offer discounts set (or cleared where an offer no longer applies). */
export function applyOffers(lines: DocLine[], offers: Offer[], items: Map<string, Item>, cats: Category[], date = todayISO(), coupon?: string | null, noTax = false): DocLine[] {
  const code = coupon?.trim().toUpperCase() || null;
  // Coupons apply only with their code; the bill's value (before discounts) decides "minimum bill".
  const billValue = lines.reduce((a, l) => a + gross(l), 0);
  const running = offers.filter((o) => offerRuns(o, date) && (!o.code || o.code.toUpperCase() === code) && (!o.minBill || billValue >= o.minBill));
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
    if (o.kind === 'amount' && (o.amount ?? 0) > 0) {
      const inCat = o.categoryId ? withDescendants(o.categoryId, cats) : null;
      const idx = out
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => {
          if (!free(l)) return false;
          if (!inCat) return true;
          const it = items.get(l.itemId!);
          const cat = it?.categoryId ?? (it?.variantOf ? items.get(it.variantOf)?.categoryId : undefined);
          return !!cat && inCat.has(cat);
        });
      const weights = idx.map(({ l }) => gross(l));
      const total = weights.reduce((a, w) => a + w, 0);
      if (total > 0) {
        // ₹ off as the customer pays it: before tax on each line, in proportion to its value.
        const off = Math.min(o.amount!, total);
        const shares = allocateProportionally(off, weights);
        idx.forEach(({ l, i }, k) => {
          const share = shares[k]!;
          const base = !noTax && l.taxPct ? Math.round(share / (1 + l.taxPct / 100)) : share;
          if (base > 0) out[i] = { ...l, discount: { type: 'amount', value: Math.min(base, gross(l)) }, offer: o.name };
        });
      }
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

/** Is this coupon code usable on a bill now? (exists, running, uses left) */
export async function checkCoupon(businessId: string, raw: string, date = todayISO(), exceptInvoiceId?: string): Promise<{ ok: true; offer: Offer } | { ok: false; reason: string }> {
  const code = raw.trim().toUpperCase();
  if (!code) return { ok: false, reason: t('Type a coupon code') };
  const { db } = await import('./db');
  const offer = (await db.offers.where('businessId').equals(businessId).toArray()).find((o) => !o.deleted && o.code?.toUpperCase() === code);
  if (!offer) return { ok: false, reason: t('No such coupon') };
  if (!offerRuns(offer, date)) return { ok: false, reason: t('This coupon is not on now') };
  if (offer.maxUses) {
    const used = await db.invoices
      .where('businessId')
      .equals(businessId)
      .filter((i) => !i.deleted && i.status === 'saved' && i.id !== exceptInvoiceId && i.coupon?.toUpperCase() === code)
      .count();
    if (used >= offer.maxUses) return { ok: false, reason: t('This coupon has been used up') };
  }
  return { ok: true, offer };
}
