/**
 * The same item added again goes onto its existing line (quantity added) instead of a new line,
 * when nothing else differs: same price, unit, tax and discount. Lines measured by size, with
 * serial / IMEI numbers, or with an offer applied stay separate.
 */
interface Mergeable {
  id: string;
  itemId?: string | null;
  qty: number;
  rate: number | null;
  unit?: string;
  unitFactor?: number;
  taxPct?: number;
  rateIncludesTax?: boolean;
  discount?: unknown;
  dims?: unknown;
  serials?: string[];
  offer?: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function sameItemLine<L extends Mergeable>(lines: L[], line: L): L | undefined {
  if (!line.itemId || line.dims || line.serials?.length || line.offer) return undefined;
  return lines.find(
    (l) =>
      l.id !== line.id &&
      l.itemId === line.itemId &&
      !l.dims &&
      !l.serials?.length &&
      !l.offer &&
      l.rate === line.rate &&
      (l.unit ?? '') === (line.unit ?? '') &&
      (l.unitFactor ?? 1) === (line.unitFactor ?? 1) &&
      (l.taxPct ?? 0) === (line.taxPct ?? 0) &&
      !!l.rateIncludesTax === !!line.rateIncludesTax &&
      same(l.discount, line.discount),
  );
}

/** Adds a new line, or its quantity to the matching line already there. */
export function addOrMerge<L extends Mergeable>(lines: L[], line: L): L[] {
  const match = sameItemLine(lines, line);
  if (!match) return [...lines, line];
  const qty = Math.round((match.qty + line.qty) * 1000) / 1000;
  return lines.map((l) => (l === match ? { ...l, qty } : l));
}
