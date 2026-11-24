/**
 * ESC/POS bytes for a receipt printed as a picture. Text in any script, logos and QR codes all
 * print the same way on cheap 2" / 3" printers that have no Indian-language fonts.
 *
 * 58 mm paper = 384 dots wide, 80 mm = 576 dots (at 203 dpi).
 */

export const PAPER_DOTS = { 58: 384, 80: 576 } as const;
export type PaperWidth = keyof typeof PAPER_DOTS;

const ESC = 0x1b;
const GS = 0x1d;

/** Rows per raster block: small blocks keep low-memory printers happy. */
const BAND = 96;

/**
 * Packs a 1-bit picture into ESC/POS raster commands (GS v 0), band by band.
 * `black(x, y)` says whether a dot is printed. Width is rounded up to whole bytes.
 */
export function rasterCommands(width: number, height: number, black: (x: number, y: number) => boolean): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const out: number[] = [];
  for (let top = 0; top < height; top += BAND) {
    const rows = Math.min(BAND, height - top);
    out.push(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    for (let y = top; y < top + rows; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = bx * 8 + bit;
          if (x < width && black(x, y)) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  return Uint8Array.from(out);
}

export interface PrintJobOptions {
  /** Blank lines fed after the receipt so it can be torn off. */
  feedLines?: number;
  /** Send a cut command (printers without a cutter ignore it). */
  cut?: boolean;
}

/** A whole print job: reset, the picture, feed and cut. */
export function printJob(raster: Uint8Array, opts: PrintJobOptions = {}): Uint8Array {
  const head = [ESC, 0x40]; // initialise
  const tail = [ESC, 0x64, Math.min(opts.feedLines ?? 4, 255)]; // print and feed n lines
  if (opts.cut ?? true) tail.push(GS, 0x56, 0x42, 0x00); // partial cut
  const job = new Uint8Array(head.length + raster.length + tail.length);
  job.set(head, 0);
  job.set(raster, head.length);
  job.set(tail, head.length + raster.length);
  return job;
}

/** Canvas → 1-bit picture → print job. Darker than `threshold` (0–255) prints. */
export function canvasToJob(canvas: HTMLCanvasElement, opts: PrintJobOptions & { threshold?: number } = {}): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const limit = opts.threshold ?? 160;
  const black = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3]! < 128) return false; // transparent = paper
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! < limit;
  };
  return printJob(rasterCommands(width, height, black), opts);
}

/** Base64 for passing bytes to the native printer plugin. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
