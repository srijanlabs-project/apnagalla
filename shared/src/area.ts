/**
 * Area / length billing for job work (painting, glass and acrylic cutting, carpentry, flex):
 * the quantity is worked out from the size, and the rate is per sq ft or per running foot.
 */
export type AreaPricing = 'sqft' | 'rft';

export interface Dims {
  length: number;
  /** Only for sq ft. */
  width?: number;
  pieces: number;
  /** Unit the sizes were measured in. */
  in: 'ft' | 'in';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Square feet or running feet for the size, rounded to 2 decimals (0 until filled in). */
export function areaQty(d: Dims, pricing: AreaPricing): number {
  const pieces = d.pieces > 0 ? d.pieces : 0;
  if (pricing === 'sqft') {
    const sq = (d.length || 0) * (d.width || 0) * pieces;
    return round2(d.in === 'in' ? sq / 144 : sq);
  }
  const run = (d.length || 0) * pieces;
  return round2(d.in === 'in' ? run / 12 : run);
}

export const AREA_UNIT: Record<AreaPricing, string> = { sqft: 'sq ft', rft: 'rft' };

/** "4 ft × 6 ft × 2 = 48 sq ft" (pieces left out when 1). */
export function dimsLabel(d: Dims, pricing: AreaPricing): string {
  const u = d.in === 'in' ? 'in' : 'ft';
  const size = pricing === 'sqft' ? `${d.length} ${u} × ${d.width ?? 0} ${u}` : `${d.length} ${u}`;
  return `${size}${d.pieces !== 1 ? ` × ${d.pieces}` : ''} = ${areaQty(d, pricing)} ${AREA_UNIT[pricing]}`;
}
