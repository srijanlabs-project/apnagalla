import { describe, expect, it } from 'vitest';
import { calculateInvoice } from './calc';
import { checkGstin, checkNumberPattern, formatNumber, resolvePlaceOfSupply, splitGst, stateCode } from './gst';

describe('GSTIN check', () => {
  it('accepts a valid GSTIN and reads its state', () => {
    expect(checkGstin(' 27aapfu0939f1zv ')).toEqual({ ok: true, gstin: '27AAPFU0939F1ZV', stateCode: '27' });
  });
  it('explains what is wrong', () => {
    expect(checkGstin('27AAPFU0939F1Z')).toMatchObject({ ok: false, problem: 'format' });
    expect(checkGstin('99AAPFU0939F1ZV')).toMatchObject({ ok: false, problem: 'state' });
    expect(checkGstin('27AAPFU0939F1ZW')).toMatchObject({ ok: false, problem: 'checksum' });
  });
});

describe('place of supply', () => {
  it('prefers shipping, then billing, then the GSTIN, then the store', () => {
    expect(resolvePlaceOfSupply({ shipToState: 'Punjab', billToState: 'Gujarat', storeState: 'Gujarat' })).toBe('03');
    expect(resolvePlaceOfSupply({ billToState: 'gujarat ', storeState: 'Delhi' })).toBe('24');
    expect(resolvePlaceOfSupply({ buyerGstin: '27AAPFU0939F1ZV', storeState: 'Delhi' })).toBe('27');
    expect(resolvePlaceOfSupply({ storeState: 'Delhi' })).toBe('07');
    expect(resolvePlaceOfSupply({})).toBeUndefined();
    expect(stateCode('Nowhere')).toBeUndefined();
  });
});

describe('CGST / SGST / IGST split', () => {
  const totals = calculateInvoice({
    lines: [
      { qty: 1, rate: 10001, taxPct: 18 }, // tax 1800.18 → 1800 paise
      { qty: 1, rate: 10010, taxPct: 5 }, // tax 500.5 → 501 paise
    ],
    roundOff: false,
  });
  it('same state: halves add up to the tax exactly', () => {
    const s = splitGst(totals, false);
    expect(s.rows).toEqual([
      { taxPct: 5, taxable: 10010, cgst: 251, sgst: 250, igst: 0 },
      { taxPct: 18, taxable: 10001, cgst: 900, sgst: 900, igst: 0 },
    ]);
    expect(s.cgst + s.sgst).toBe(totals.taxTotal);
  });
  it('other state: all IGST', () => {
    const s = splitGst(totals, true);
    expect([s.cgst, s.sgst, s.igst]).toEqual([0, 0, totals.taxTotal]);
  });
});

describe('number pattern', () => {
  it('formats the tokens', () => {
    expect(formatNumber('{PREFIX}/{FY}/{SEQ}', 'INV', '26-27', '2026-11-24', 7, 4)).toBe('INV/26-27/0007');
    expect(formatNumber('{PREFIX}-{FY4}-{SEQ}', 'CN', '26-27', '2026-11-24', 12, 3)).toBe('CN-2026-27-012');
    expect(formatNumber('{PREFIX}{YYYY}{SEQ}', 'B', '26-27', '2027-02-01', 5, 5)).toBe('B202700005');
  });
  it('enforces GST limits and uniqueness across years', () => {
    expect(checkNumberPattern('{PREFIX}/{FY}/{SEQ}', ['INV', 'BILL'], 4, true)).toBeNull();
    expect(checkNumberPattern('{PREFIX}/{FY}', ['INV'], 4, true)).toMatch(/SEQ/);
    expect(checkNumberPattern('{PREFIX}-{SEQ}', ['INV'], 4, true)).toMatch(/FY/);
    expect(checkNumberPattern('{PREFIX}-{SEQ}', ['INV'], 4, false)).toBeNull();
    expect(checkNumberPattern('{PREFIX}/{FY4}/{SEQ}', ['INVOICE'], 6, true)).toMatch(/16 characters/);
    expect(checkNumberPattern('{PREFIX} {FY} {SEQ}', ['INV'], 4, true)).toMatch(/Only letters/);
    expect(checkNumberPattern('{PREFIX}/{FY}/{SEQ}/{X}', ['INV'], 4, true)).toMatch(/Unknown/);
  });
});
