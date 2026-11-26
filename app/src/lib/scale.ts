import type { BusinessSettings, Item } from './db';

/**
 * Weighing-scale barcodes. A shop scale prints a label for loose goods (vegetables, sweets, dry
 * fruit) whose EAN-13 barcode holds the item's scale code (PLU) and the weight or the price:
 * [prefix][PLU][value][check digit], e.g. "2 001234 01250 7" = PLU 1234, 1.250 kg.
 * The layout is set in Invoice settings to match the scale.
 */

export interface ScaleSettings {
  enabled: boolean;
  /** Leading digits that mark a scale label (usually "2", sometimes "20"–"29"). */
  prefix: string;
  codeDigits: number;
  /** What the label carries: the weight (grams) or the price (paise). */
  value: 'weight' | 'price';
  valueDigits: number;
}

export const DEFAULT_SCALE: ScaleSettings = { enabled: false, prefix: '2', codeDigits: 6, value: 'weight', valueDigits: 5 };

export const scaleOf = (s: Pick<BusinessSettings, 'scale'>): ScaleSettings => ({ ...DEFAULT_SCALE, ...(s.scale ?? {}) });

/** EAN-13 check digit of the first 12 digits. */
export function ean13Check(d12: string): number {
  const sum = [...d12].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

/** Reads a scale label, or null when the code isn't one. */
export function parseScaleBarcode(code: string, s: ScaleSettings): { plu: string; grams?: number; paise?: number } | null {
  if (!s.enabled || !/^\d{13}$/.test(code) || !code.startsWith(s.prefix)) return null;
  if (s.prefix.length + s.codeDigits + s.valueDigits + 1 !== 13) return null;
  if (ean13Check(code.slice(0, 12)) !== Number(code[12])) return null;
  const plu = String(Number(code.slice(s.prefix.length, s.prefix.length + s.codeDigits)));
  const value = Number(code.slice(s.prefix.length + s.codeDigits, 12));
  return s.value === 'weight' ? { plu, grams: value } : { plu, paise: value };
}

/** The quantity to bill for an item from a scale label (kg for weight, price ÷ rate otherwise). */
export function scaleQty(item: Pick<Item, 'unit' | 'rate'>, read: { grams?: number; paise?: number }): number {
  if (read.grams != null) {
    const u = item.unit.toLowerCase();
    return u === 'g' || u === 'gm' || u === 'gram' || u === 'grams' ? read.grams : Math.round(read.grams) / 1000;
  }
  return item.rate > 0 ? Math.round(((read.paise ?? 0) / item.rate) * 1000) / 1000 : 0;
}

export const samePlu = (item: Pick<Item, 'scaleCode'>, plu: string) => !!item.scaleCode && String(Number(item.scaleCode)) === plu;
