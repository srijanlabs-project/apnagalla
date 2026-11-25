/**
 * Area / length billing for job work (painting, glass and acrylic cutting, carpentry, flex):
 * the quantity is worked out from the size, and the rate is per sq ft / sq m or per running
 * foot / metre. Sizes can be measured in feet, inches, metres, centimetres or millimetres.
 */
export type AreaPricing = 'sqft' | 'rft' | 'sqm' | 'rmt';
export const AREA_PRICINGS: AreaPricing[] = ['sqft', 'rft', 'sqm', 'rmt'];
export const isAreaPricing = (p: string | undefined | null): p is AreaPricing => !!p && (AREA_PRICINGS as string[]).includes(p);

export type SizeUnit = 'ft' | 'in' | 'm' | 'cm' | 'mm';
export const SIZE_UNITS: SizeUnit[] = ['ft', 'in', 'm', 'cm', 'mm'];

export interface Dims {
  length: number;
  /** Only for areas (sq ft / sq m). */
  width?: number;
  pieces: number;
  /** Unit the sizes were measured in. */
  in: SizeUnit;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One measured unit in feet, or in metres. */
const IN_FEET: Record<SizeUnit, number> = { ft: 1, in: 1 / 12, m: 1 / 0.3048, cm: 1 / 30.48, mm: 1 / 304.8 };
const IN_METRES: Record<SizeUnit, number> = { ft: 0.3048, in: 0.0254, m: 1, cm: 0.01, mm: 0.001 };

export const isAreaOf = (p: AreaPricing) => p === 'sqft' || p === 'sqm';
const metric = (p: AreaPricing) => p === 'sqm' || p === 'rmt';

/** Area or running length for the size, rounded to 2 decimals (0 until filled in). */
export function areaQty(d: Dims, pricing: AreaPricing): number {
  const pieces = d.pieces > 0 ? d.pieces : 0;
  const k = (metric(pricing) ? IN_METRES : IN_FEET)[d.in] ?? 1;
  if (isAreaOf(pricing)) return round2((d.length || 0) * k * ((d.width || 0) * k) * pieces);
  return round2((d.length || 0) * k * pieces);
}

export const AREA_UNIT: Record<AreaPricing, string> = { sqft: 'sq ft', rft: 'rft', sqm: 'sq m', rmt: 'rmt' };

/** "4 ft × 6 ft × 2 = 48 sq ft" (pieces left out when 1). */
export function dimsLabel(d: Dims, pricing: AreaPricing): string {
  const u = d.in;
  const size = isAreaOf(pricing) ? `${d.length} ${u} × ${d.width ?? 0} ${u}` : `${d.length} ${u}`;
  return `${size}${d.pieces !== 1 ? ` × ${d.pieces}` : ''} = ${areaQty(d, pricing)} ${AREA_UNIT[pricing]}`;
}

/** The size unit to start with: feet for feet pricing, millimetres for metre pricing. */
export const defaultSizeUnit = (p: AreaPricing): SizeUnit => (metric(p) ? 'mm' : 'ft');
