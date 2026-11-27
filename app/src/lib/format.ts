import { dimsLabel, formatDateIN, formatPaise, isAreaPricing, type AreaPricing, type Dims } from '@invoice/shared';

export const rupees = (paise: number) => formatPaise(paise, { symbol: true });
export const rupeesShort = (paise: number) => (paise % 100 === 0 ? formatPaise(paise, { symbol: true, decimals: false }) : formatPaise(paise, { symbol: true }));
export const dateIN = formatDateIN;

export function addressLines(a: { line1?: string; line2?: string; city?: string; state?: string; pin?: string } | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, a.state].filter(Boolean).join(', ') + (a.pin ? ` - ${a.pin}` : '');
  return [a.line1, a.line2, cityLine.trim()].filter((s): s is string => !!s && s.trim() !== '' && s.trim() !== '-');
}

/** Reads an image file, scales it down to fit maxPx and returns a compact data URL. */
/** `photo` = JPEG (bills, pictures: much smaller); else PNG (logos, signatures keep transparency). */
export async function fileToResizedDataUrl(file: File, maxPx = 512, photo = false): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = url;
    });
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency (logos, signatures); they are small after resizing.
    return photo ? canvas.toDataURL('image/jpeg', 0.72) : canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

type SizedLine = { pricing?: 'unit' | AreaPricing; dims?: Dims | null };

/** True when the line's quantity comes from a size (sq ft / running ft). */
export const isAreaLine = (l: SizedLine) => isAreaPricing(l.pricing) && !!l.dims;

/** Size of an area line, "4 ft × 6 ft × 2 = 48 sq ft"; '' for other lines. */
export const lineSize = (l: SizedLine) => (isAreaLine(l) ? dimsLabel(l.dims!, l.pricing as AreaPricing) : '');

/** One-tap cash amounts: exact, then the next round notes a customer is likely to hand over (paise). */
export function cashSteps(amount: number): number[] {
  const out = [amount];
  for (const step of [10000, 50000, 200000]) {
    const v = Math.ceil(amount / step) * step;
    if (v > amount && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 4);
}

/**
 * Opens a stored picture in a new tab only if it really is image data or an https link (never a
 * "javascript:" link someone could have saved in its place).
 */
export function openPicture(src: string | null | undefined): void {
  if (!src) return;
  if (/^https:\/\//i.test(src)) {
    window.open(src, '_blank', 'noopener');
    return;
  }
  const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(src);
  if (!m) return;
  const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
