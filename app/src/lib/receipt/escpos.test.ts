import { describe, expect, it } from 'vitest';
import { printJob, rasterCommands, toBase64 } from './escpos';

describe('ESC/POS raster', () => {
  it('packs dots left to right, high bit first, with the GS v 0 header', () => {
    // 10 dots wide, 2 rows: row 0 has dots 0 and 9, row 1 is blank.
    const bytes = rasterCommands(10, 2, (x, y) => y === 0 && (x === 0 || x === 9));
    expect([...bytes]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0b10000000, 0b01000000, 0, 0]);
  });
  it('splits tall pictures into bands', () => {
    const bytes = rasterCommands(8, 200, () => false);
    // 3 bands (96 + 96 + 8 rows), each with an 8-byte header and 1 byte per row.
    expect(bytes.length).toBe(3 * 8 + 200);
    expect([bytes[6], bytes[7]]).toEqual([96, 0]);
  });
  it('wraps the picture with reset, feed and cut', () => {
    const job = printJob(Uint8Array.from([1, 2]), { feedLines: 3 });
    expect([...job]).toEqual([0x1b, 0x40, 1, 2, 0x1b, 0x64, 3, 0x1d, 0x56, 0x42, 0x00]);
    expect([...printJob(Uint8Array.from([]), { cut: false })]).toEqual([0x1b, 0x40, 0x1b, 0x64, 4]);
    expect(toBase64(Uint8Array.from([0x1b, 0x40]))).toBe('G0A=');
  });
});
