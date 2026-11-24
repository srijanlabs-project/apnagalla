import { describe, expect, it } from 'vitest';
import { allocateProportionally, calculateInvoice, discountForTarget, formatPaise, parseRupees, roundHalfUp, type InvoiceCalcInput } from './calc';
import { financialYearLabel } from './dates';
import { amountInWords, numberToIndianWords } from './words';

/** SPEC §6.4 lines: A = 2 × ₹500, 10% off, 18% tax; B = 1 × ₹1,000, 5% tax. */
const specLines: InvoiceCalcInput['lines'] = [
  { qty: 2, rate: 50000, taxPct: 18, discount: { type: 'pct', value: 10 } },
  { qty: 1, rate: 100000, taxPct: 5 },
];

describe('calculateInvoice — SPEC §6.4 worked example', () => {
  const r = calculateInvoice({ lines: specLines, overallDiscount: { type: 'pct', value: 10 }, roundOff: true });

  it('line figures', () => {
    expect(r.lines.map((l) => [l.gross, l.lineDiscount, l.net, l.overallShare, l.taxable, l.tax])).toEqual([
      [100000, 10000, 90000, 9000, 81000, 14580],
      [100000, 0, 100000, 10000, 90000, 4500],
    ]);
  });

  it('summary', () => {
    expect(r.subtotal).toBe(200000);
    expect(r.itemDiscount).toBe(10000);
    expect(r.overallDiscount).toBe(19000);
    expect(r.taxableAmount).toBe(171000);
    expect(r.taxBreakdown).toEqual([
      { taxPct: 5, taxable: 90000, tax: 4500 },
      { taxPct: 18, taxable: 81000, tax: 14580 },
    ]);
    expect(r.taxTotal).toBe(19080);
    // ₹1,900.80 rounds to the nearest rupee: ₹1,901.00 (+0.20).
    expect(r.roundOff).toBe(20);
    expect(r.grandTotal).toBe(190100);
  });

  it('without round-off keeps paise', () => {
    const r2 = calculateInvoice({ lines: specLines, overallDiscount: { type: 'pct', value: 10 }, roundOff: false });
    expect(r2.roundOff).toBe(0);
    expect(r2.grandTotal).toBe(190080);
  });
});

describe('Set final amount — SPEC §6.3a worked example (target ₹1,800)', () => {
  it('derives ₹280.68 discount and lands exactly on ₹1,800', () => {
    const r = calculateInvoice({ lines: specLines, roundOff: true, targetTotal: 180000 });
    expect(r.overallDiscount).toBe(28068);
    expect(r.lines.map((l) => [l.overallShare, l.taxable, l.tax])).toEqual([
      [13295, 76705, 13807],
      [14773, 85227, 4261],
    ]);
    expect(r.taxableAmount + r.taxTotal).toBe(180000);
    expect(r.roundOff).toBe(0);
    expect(r.grandTotal).toBe(180000);
  });

  it('ignores a manual overall discount when a target is set', () => {
    const r = calculateInvoice({ lines: specLines, roundOff: true, targetTotal: 180000, overallDiscount: { type: 'pct', value: 50 } });
    expect(r.grandTotal).toBe(180000);
  });

  it('lands exactly on odd targets, absorbing paise into round off', () => {
    for (const target of [123456, 150001, 199999, 100]) {
      const r = calculateInvoice({ lines: specLines, roundOff: false, targetTotal: target });
      expect(r.grandTotal).toBe(target);
      expect(Math.abs(r.roundOff)).toBeLessThanOrEqual(5);
    }
  });

  it('rejects a target above the current total or at/below zero', () => {
    expect(discountForTarget({ lines: specLines, roundOff: true }, 300000)).toEqual({ error: 'target_above_total' });
    expect(discountForTarget({ lines: specLines, roundOff: true }, 0)).toEqual({ error: 'target_too_low' });
    expect(discountForTarget({ lines: [], roundOff: true }, 1000)).toEqual({ error: 'no_lines' });
  });

  it('accounts for additional charges, which are never discounted', () => {
    const charges = [{ label: 'Delivery', amount: 10000, taxPct: 18 }];
    const r = calculateInvoice({ lines: specLines, charges, roundOff: true, targetTotal: 180000 });
    expect(r.grandTotal).toBe(180000);
    expect(r.chargesTotal).toBe(10000);
  });
});

describe('rate includes tax (SPEC §6.3)', () => {
  it('₹118 incl. 18% → base ₹100 + tax ₹18', () => {
    const r = calculateInvoice({ lines: [{ qty: 1, rate: 11800, rateIncludesTax: true, taxPct: 18 }], roundOff: false });
    expect(r.lines[0]!.taxable).toBe(10000);
    expect(r.lines[0]!.tax).toBe(1800);
    expect(r.grandTotal).toBe(11800);
  });

  it('awkward incl-tax prices stay within a paisa and round-off brings them back', () => {
    const r = calculateInvoice({ lines: [{ qty: 3, rate: 9900, rateIncludesTax: true, taxPct: 12 }], roundOff: true });
    expect(Math.abs(r.taxableAmount + r.taxTotal - 29700)).toBeLessThanOrEqual(1);
    expect(r.grandTotal).toBe(29700);
  });
});

describe('edge cases', () => {
  it('flat discounts are capped at the amount they apply to', () => {
    const r = calculateInvoice({
      lines: [{ qty: 1, rate: 1000, taxPct: 0, discount: { type: 'amount', value: 5000 } }],
      overallDiscount: { type: 'amount', value: 99999 },
      roundOff: false,
    });
    expect(r.lines[0]!.lineDiscount).toBe(1000);
    expect(r.overallDiscount).toBe(0);
    expect(r.grandTotal).toBe(0);
  });

  it('decimal quantities', () => {
    const r = calculateInvoice({ lines: [{ qty: 2.5, rate: 4999, taxPct: 0 }], roundOff: false });
    expect(r.lines[0]!.gross).toBe(12498); // 12497.5 rounds half up
  });

  it('empty invoice', () => {
    const r = calculateInvoice({ lines: [], roundOff: true });
    expect(r.grandTotal).toBe(0);
    expect(r.taxBreakdown).toEqual([]);
  });

  it('allocation always sums exactly', () => {
    const parts = allocateProportionally(1000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocateProportionally(7, [0, 0])).toEqual([0, 0]);
  });

  it('roundHalfUp ignores float noise', () => {
    expect(roundHalfUp(100.4999)).toBe(100);
    expect(roundHalfUp(100.49999999999)).toBe(101); // float noise around .5 counts as .5
    expect(roundHalfUp(1.005 * 100)).toBe(101);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
});

describe('formatting', () => {
  it('formats paise with Indian grouping', () => {
    expect(formatPaise(12345678)).toBe('1,23,456.78');
    expect(formatPaise(190000, { symbol: true })).toBe('₹1,900.00');
    expect(formatPaise(-80)).toBe('−0.80');
  });

  it('parses rupee input', () => {
    expect(parseRupees('1,234.5')).toBe(123450);
    expect(parseRupees('₹ 99')).toBe(9900);
    expect(parseRupees('0.07')).toBe(7);
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('1.234')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
});

describe('amount in words', () => {
  it.each([
    [190000, 'Rupees One Thousand Nine Hundred Only'],
    [180000, 'Rupees One Thousand Eight Hundred Only'],
    [1050, 'Rupees Ten and Fifty Paise Only'],
    [0, 'Rupees Zero Only'],
    [12345678900, 'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only'],
  ])('%d paise', (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });

  it('handles lakh boundaries', () => {
    expect(numberToIndianWords(100000)).toBe('One Lakh');
    expect(numberToIndianWords(101)).toBe('One Hundred One');
  });
});

describe('financial year', () => {
  it.each([
    ['2026-11-24', '26-27'],
    ['2027-03-31', '26-27'],
    ['2027-04-01', '27-28'],
    ['2099-12-01', '99-00'],
  ])('%s → %s', (d, fy) => expect(financialYearLabel(d)).toBe(fy));
});
