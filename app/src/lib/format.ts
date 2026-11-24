import { formatDateIN, formatPaise } from '@invoice/shared';

export const rupees = (paise: number) => formatPaise(paise, { symbol: true });
export const rupeesShort = (paise: number) => (paise % 100 === 0 ? formatPaise(paise, { symbol: true, decimals: false }) : formatPaise(paise, { symbol: true }));
export const dateIN = formatDateIN;

export function addressLines(a: { line1?: string; line2?: string; city?: string; state?: string; pin?: string } | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, a.state].filter(Boolean).join(', ') + (a.pin ? ` - ${a.pin}` : '');
  return [a.line1, a.line2, cityLine.trim()].filter((s): s is string => !!s && s.trim() !== '' && s.trim() !== '-');
}

/** Reads an image file, scales it down to fit maxPx and returns a compact data URL. */
export async function fileToResizedDataUrl(file: File, maxPx = 512): Promise<string> {
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
    return canvas.toDataURL('image/png');
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
