import { describe, expect, it } from 'vitest';
import { CODE128, code128 } from './labels';

describe('Code 128', () => {
  it('every symbol is 11 modules wide (stop 13)', () => {
    expect(CODE128).toHaveLength(107);
    CODE128.forEach((p, i) => expect([...p].reduce((a, d) => a + Number(d), 0), `value ${i}`).toBe(i === 106 ? 13 : 11));
    expect(new Set(CODE128).size).toBe(107);
  });

  it('encodes with start B, the check symbol and stop', () => {
    // "AB": values 33, 34; check = (104 + 33×1 + 34×2) % 103 = 102.
    const m = code128('AB');
    const total = m.reduce((a, x) => a + x, 0);
    expect(total).toBe(11 * 4 + 13);
    expect(m.slice(0, 6).join('')).toBe(CODE128[104]);
    expect(m.slice(18, 24).join('')).toBe(CODE128[102]);
    expect(() => code128('é')).toThrow();
  });
});
