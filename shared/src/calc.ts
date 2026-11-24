/**
 * Invoice calculation engine (SPEC §6). Pure functions, shared by app and server.
 *
 * Money is always INTEGER PAISE (₹1 = 100). Quantities may be decimal.
 * Rounding points are fixed so every device produces identical numbers:
 *   - line gross, line discount, overall-discount share, line tax: rounded to 1 paisa
 *   - grand total: optionally rounded to ₹1; the difference is "round off"
 */

export type DiscountInput = { type: 'pct'; value: number } | { type: 'amount'; value: number };

export interface LineInput {
  qty: number;
  /** paise; when rateIncludesTax the rate is the final price incl. tax */
  rate: number;
  rateIncludesTax?: boolean;
  taxPct: number;
  discount?: DiscountInput | null;
}

export interface ChargeInput {
  label: string;
  /** paise, before tax */
  amount: number;
  taxPct: number;
}

export interface InvoiceCalcInput {
  lines: LineInput[];
  /** Applied after item discounts, always before tax. */
  overallDiscount?: DiscountInput | null;
  charges?: ChargeInput[];
  /** Round grand total to nearest ₹1. */
  roundOff: boolean;
  /**
   * "Set final amount" (SPEC §6.3a): target grand total incl. tax, in paise.
   * When set, the overall discount is derived from it and overallDiscount is ignored.
   */
  targetTotal?: number | null;
}

export interface LineResult {
  /** rate actually used, before tax (paise, may be fractional for incl-tax rates) */
  baseRate: number;
  gross: number;
  lineDiscount: number;
  net: number;
  overallShare: number;
  taxable: number;
  tax: number;
  /** taxable + tax */
  amount: number;
}

export interface TaxBreakdownRow {
  taxPct: number;
  taxable: number;
  tax: number;
}

export interface InvoiceTotals {
  lines: LineResult[];
  /** Σ qty × rate (before any discount) */
  subtotal: number;
  itemDiscount: number;
  overallDiscount: number;
  taxableAmount: number;
  chargesTotal: number;
  taxTotal: number;
  taxBreakdown: TaxBreakdownRow[];
  roundOff: number;
  grandTotal: number;
}

export type TargetTotalError = 'target_above_total' | 'target_too_low' | 'no_lines';

/** Round to the nearest integer, halves up, immune to float noise like 1.005 → 1.00499999. */
export function roundHalfUp(x: number): number {
  const cleaned = Number(x.toFixed(6));
  return Math.sign(cleaned) * Math.round(Math.abs(cleaned));
}

function lineBase(line: LineInput) {
  const t = line.taxPct / 100;
  const baseRate = line.rateIncludesTax ? line.rate / (1 + t) : line.rate;
  const gross = roundHalfUp(line.qty * baseRate);
  let lineDiscount = 0;
  if (line.discount && line.discount.value > 0) {
    lineDiscount =
      line.discount.type === 'pct' ? roundHalfUp((gross * Math.min(line.discount.value, 100)) / 100) : Math.min(roundHalfUp(line.discount.value), gross);
  }
  return { baseRate, gross, lineDiscount, net: gross - lineDiscount };
}

/**
 * Splits `total` paise across `weights` proportionally so the parts add up exactly
 * (largest-remainder method). Ties go to the earlier line.
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.floor(Number(r.toFixed(6))));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(Number(r.toFixed(6))) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) parts[order[k]!.i]! += 1;
  return parts;
}

function chargeTax(c: ChargeInput) {
  return roundHalfUp((c.amount * c.taxPct) / 100);
}

/**
 * Overall discount (paise) needed so that the grand total equals `target`.
 * Formula from SPEC §6.3a: d = 1 − (Target − charges incl. tax) ÷ Σ(net × (1 + tax%)).
 */
export function discountForTarget(input: Omit<InvoiceCalcInput, 'targetTotal' | 'overallDiscount'>, target: number): { discount: number } | { error: TargetTotalError } {
  const bases = input.lines.map(lineBase);
  const sumNet = bases.reduce((a, b) => a + b.net, 0);
  if (input.lines.length === 0 || sumNet <= 0) return { error: 'no_lines' };
  const charges = (input.charges ?? []).reduce((a, c) => a + c.amount + chargeTax(c), 0);
  const grossWithTax = bases.reduce((a, b, i) => a + b.net * (1 + input.lines[i]!.taxPct / 100), 0);
  const available = target - charges;
  if (available <= 0) return { error: 'target_too_low' };
  // Allow up to 1 paisa above due to rounding of the current total.
  if (available > grossWithTax + 0.5) return { error: 'target_above_total' };
  const d = 1 - available / grossWithTax;
  return { discount: Math.max(0, Math.min(sumNet, roundHalfUp(d * sumNet))) };
}

export function calculateInvoice(input: InvoiceCalcInput): InvoiceTotals {
  const bases = input.lines.map(lineBase);
  const sumNet = bases.reduce((a, b) => a + b.net, 0);

  let overall = 0;
  let target: number | null = null;
  if (input.targetTotal != null) {
    const r = discountForTarget(input, input.targetTotal);
    if ('discount' in r) {
      overall = r.discount;
      target = input.targetTotal;
    }
  } else if (input.overallDiscount && input.overallDiscount.value > 0) {
    overall =
      input.overallDiscount.type === 'pct'
        ? roundHalfUp((sumNet * Math.min(input.overallDiscount.value, 100)) / 100)
        : Math.min(roundHalfUp(input.overallDiscount.value), sumNet);
  }

  const shares = allocateProportionally(
    overall,
    bases.map((b) => b.net),
  );

  const breakdown = new Map<number, TaxBreakdownRow>();
  const addTax = (taxPct: number, taxable: number, tax: number) => {
    const row = breakdown.get(taxPct) ?? { taxPct, taxable: 0, tax: 0 };
    row.taxable += taxable;
    row.tax += tax;
    breakdown.set(taxPct, row);
  };

  const lines: LineResult[] = bases.map((b, i) => {
    const line = input.lines[i]!;
    const overallShare = shares[i]!;
    const taxable = b.net - overallShare;
    const tax = roundHalfUp((taxable * line.taxPct) / 100);
    addTax(line.taxPct, taxable, tax);
    return { ...b, overallShare, taxable, tax, amount: taxable + tax };
  });

  let chargesTotal = 0;
  for (const c of input.charges ?? []) {
    const amount = roundHalfUp(c.amount);
    chargesTotal += amount;
    addTax(c.taxPct, amount, chargeTax(c));
  }

  const taxableAmount = lines.reduce((a, l) => a + l.taxable, 0);
  const taxTotal = [...breakdown.values()].reduce((a, r) => a + r.tax, 0);
  const preRound = taxableAmount + chargesTotal + taxTotal;

  let roundOff = 0;
  if (target != null) roundOff = target - preRound;
  else if (input.roundOff) roundOff = roundHalfUp(preRound / 100) * 100 - preRound;

  return {
    lines,
    subtotal: bases.reduce((a, b) => a + b.gross, 0),
    itemDiscount: bases.reduce((a, b) => a + b.lineDiscount, 0),
    overallDiscount: overall,
    taxableAmount,
    chargesTotal,
    taxTotal,
    taxBreakdown: [...breakdown.values()].filter((r) => r.taxable !== 0 || r.tax !== 0).sort((a, b) => a.taxPct - b.taxPct),
    roundOff,
    grandTotal: preRound + roundOff,
  };
}

/* ---------- formatting helpers ---------- */

/** 190000 → "1,900.00" (Indian digit grouping) */
export function formatPaise(paise: number, opts: { symbol?: boolean; decimals?: boolean } = {}): string {
  const { symbol = false, decimals = true } = opts;
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const grouped = rupees.toLocaleString('en-IN');
  const s = decimals ? `${grouped}.${String(p).padStart(2, '0')}` : grouped;
  return `${neg ? '−' : ''}${symbol ? '₹' : ''}${s}`;
}

/** "1,234.5" / "1234.50" / "₹ 99" → 123450 / 123450 / 9900; null when not a number */
export function parseRupees(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (cleaned === '' || !/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null;
  return roundHalfUp(Number(cleaned) * 100);
}

/** Paise → editable string without grouping: 123450 → "1234.50", 100000 → "1000" */
export function paiseToInput(paise: number): string {
  if (paise % 100 === 0) return String(paise / 100);
  return (paise / 100).toFixed(2);
}
