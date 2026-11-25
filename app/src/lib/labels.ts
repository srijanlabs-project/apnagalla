import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { db, type Item } from './db';
import { pdfmake } from './pdf';
import { newId, putRecord, type Actor } from './repo';

/**
 * Barcode labels and price stickers: Code 128 (set B) barcodes that every scanner reads, on an A4
 * sheet (3 × 8 labels) or on the receipt printer's paper.
 */

/** Bar / space widths of Code 128 values 0–106 (106 = stop). */
export const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Module widths (bar, space, bar…) for the text, with start, check and stop codes. */
export function code128(text: string): number[] {
  const values = [...text].map((ch) => {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`Barcode can't contain "${ch}"`);
    return v;
  });
  const check = (START_B + values.reduce((a, v, i) => a + v * (i + 1), 0)) % 103;
  return [START_B, ...values, check, STOP].flatMap((v) => [...CODE128[v]!].map(Number));
}

/** Gives items without a barcode a short shop code (AG + 8 digits), saved on the item. */
export async function ensureBarcodes(actor: Actor, items: Item[]): Promise<Item[]> {
  const used = new Set((await db.items.where('businessId').equals(actor.businessId).toArray()).map((i) => i.barcode).filter(Boolean));
  const out: Item[] = [];
  for (const it of items) {
    if (it.barcode) {
      out.push(it);
      continue;
    }
    let code = '';
    do code = `AG${String(parseInt(newId().replace(/-/g, '').slice(0, 10), 16) % 100_000_000).padStart(8, '0')}`;
    while (used.has(code));
    used.add(code);
    out.push(await putRecord('items', actor, { ...it, barcode: code }));
  }
  return out;
}

export interface LabelOptions {
  shop: string;
  showPrice: boolean;
  showMrp: boolean;
}

const money = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Bars as pdfmake rectangles, scaled to `width` points. */
function barsCanvas(code: string, width: number, height: number): Content {
  const modules = code128(code);
  const total = modules.reduce((a, m) => a + m, 0);
  const unit = width / total;
  let x = 0;
  const rects = modules.flatMap((m, i) => {
    const r = i % 2 === 0 ? [{ type: 'rect' as const, x, y: 0, w: m * unit, h: height, color: '#000' }] : [];
    x += m * unit;
    return r;
  });
  return { canvas: rects };
}

/** A4 sheet, 3 across × 8 down (common 24-label sheets); `copies` labels per item. */
export async function labelsPdf(list: { item: Item; copies: number }[], o: LabelOptions): Promise<Blob> {
  const pm = await pdfmake();
  const cells: Content[] = list.flatMap(({ item, copies }) =>
    Array.from({ length: copies }, () => ({
      stack: [
        { text: o.shop, fontSize: 6, color: '#555' },
        { text: item.name, fontSize: 8, bold: true, maxHeight: 20 },
        ...(o.showPrice || o.showMrp
          ? [{ text: [o.showPrice ? money(item.rate) : '', o.showPrice && o.showMrp && item.mrp ? '   ' : '', o.showMrp && item.mrp ? `MRP ${money(item.mrp)}` : ''].join(''), fontSize: 9, bold: true }]
          : []),
        { stack: [barsCanvas(item.barcode!, 150, 26)], margin: [0, 2, 0, 0] as [number, number, number, number] },
        { text: item.barcode!, fontSize: 7, alignment: 'center' as const },
      ],
      margin: [4, 4, 4, 4],
    })),
  );
  const rows: Content[][] = [];
  for (let i = 0; i < cells.length; i += 3) rows.push([cells[i]!, cells[i + 1] ?? '', cells[i + 2] ?? '']);
  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [20, 30, 20, 20],
    content: [{ table: { widths: ['*', '*', '*'], heights: 92, body: rows.length ? rows : [['', '', '']], dontBreakRows: true }, layout: 'noBorders' }],
  };
  const pdf = pm.createPdf(def);
  const base64 = await (pdf.getBase64 as unknown as () => Promise<string>)();
  return new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: 'application/pdf' });
}

/** Labels one under another on receipt paper, for the Bluetooth printer. */
export function labelsCanvas(list: { item: Item; copies: number }[], o: LabelOptions, widthDots: number): HTMLCanvasElement {
  const H = 210;
  const all = list.flatMap(({ item, copies }) => Array.from({ length: copies }, () => item));
  const c = document.createElement('canvas');
  c.width = widthDots;
  c.height = Math.max(1, all.length) * H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  all.forEach((item, n) => {
    const y = n * H;
    ctx.font = '20px sans-serif';
    ctx.fillText(o.shop, widthDots / 2, y + 22);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(item.name.slice(0, 32), widthDots / 2, y + 50);
    const price = [o.showPrice ? money(item.rate) : '', o.showMrp && item.mrp ? `MRP ${money(item.mrp)}` : ''].filter(Boolean).join('   ');
    if (price) {
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(price, widthDots / 2, y + 80);
    }
    const modules = code128(item.barcode!);
    const total = modules.reduce((a, m) => a + m, 0);
    const unit = Math.max(1, Math.floor((widthDots - 40) / total));
    let x = Math.round((widthDots - unit * total) / 2);
    modules.forEach((m, i) => {
      if (i % 2 === 0) ctx.fillRect(x, y + 92, m * unit, 70);
      x += m * unit;
    });
    ctx.font = '20px monospace';
    ctx.fillText(item.barcode!, widthDots / 2, y + 186);
    ctx.fillRect(10, y + H - 2, widthDots - 20, 1);
  });
  return c;
}
