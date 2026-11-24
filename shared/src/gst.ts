/**
 * GST rules shared by app and server: state codes, GSTIN checks, place of supply and the
 * CGST + SGST / IGST split. Money is integer paise (see calc.ts).
 */
import { roundHalfUp, type InvoiceTotals } from './calc';

/** How the store is registered under GST. */
export const GST_TYPES = ['regular', 'composition', 'unregistered'] as const;
export type GstType = (typeof GST_TYPES)[number];

/** gst = tax invoice with GST; none = bill without GST (bill of supply). */
export type TaxMode = 'gst' | 'none';

/** GST state / UT codes (first two digits of a GSTIN). */
export const GST_STATES: readonly { code: string; name: string }[] = [
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '10', name: 'Bihar' },
  { code: '04', name: 'Chandigarh' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '07', name: 'Delhi' },
  { code: '30', name: 'Goa' },
  { code: '24', name: 'Gujarat' },
  { code: '06', name: 'Haryana' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '20', name: 'Jharkhand' },
  { code: '29', name: 'Karnataka' },
  { code: '32', name: 'Kerala' },
  { code: '38', name: 'Ladakh' },
  { code: '31', name: 'Lakshadweep' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '27', name: 'Maharashtra' },
  { code: '14', name: 'Manipur' },
  { code: '17', name: 'Meghalaya' },
  { code: '15', name: 'Mizoram' },
  { code: '13', name: 'Nagaland' },
  { code: '21', name: 'Odisha' },
  { code: '34', name: 'Puducherry' },
  { code: '03', name: 'Punjab' },
  { code: '08', name: 'Rajasthan' },
  { code: '11', name: 'Sikkim' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '16', name: 'Tripura' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '19', name: 'West Bengal' },
];

/** "Gujarat" → "24"; undefined when not a known state. Case and spacing don't matter. */
export function stateCode(name: string | null | undefined): string | undefined {
  const n = name?.trim().toLowerCase();
  if (!n) return undefined;
  return GST_STATES.find((s) => s.name.toLowerCase() === n)?.code;
}

/** "24" → "Gujarat" */
export function stateName(code: string | null | undefined): string | undefined {
  return GST_STATES.find((s) => s.code === code)?.name;
}

/** "24" → "Gujarat (24)" */
export function stateLabel(code: string | null | undefined): string {
  const name = stateName(code);
  return name ? `${name} (${code})` : '';
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Check character of the first 14 GSTIN characters (GSTN's mod-36 scheme). */
function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = 'format' | 'state' | 'checksum';

/**
 * Offline check of a GSTIN's shape, state code and check digit. It does not prove the number is
 * registered or active — that needs the GST API (R1.5).
 */
export function checkGstin(raw: string): { ok: true; gstin: string; stateCode: string } | { ok: false; problem: GstinProblem; message: string } {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_SHAPE.test(gstin)) return { ok: false, problem: 'format', message: 'A GSTIN has 15 characters, like 24ABCDE1234F1Z5' };
  const code = gstin.slice(0, 2);
  if (!stateName(code)) return { ok: false, problem: 'state', message: `${code} is not a GST state code` };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { ok: false, problem: 'checksum', message: 'This GSTIN has a typo (the last character does not match)' };
  return { ok: true, gstin, stateCode: code };
}

/** State code from a GSTIN that passes the check, else undefined. */
export function gstinState(gstin: string | null | undefined): string | undefined {
  if (!gstin) return undefined;
  const r = checkGstin(gstin);
  return r.ok ? r.stateCode : undefined;
}

/**
 * Place of supply for goods: where they are delivered. First the shipping address, then the
 * billing address, then the buyer's GSTIN, and for a walk-in customer the store's own state.
 */
export function resolvePlaceOfSupply(p: {
  shipToState?: string | null;
  billToState?: string | null;
  buyerGstin?: string | null;
  storeState?: string | null;
}): string | undefined {
  return stateCode(p.shipToState) ?? stateCode(p.billToState) ?? gstinState(p.buyerGstin) ?? stateCode(p.storeState);
}

export interface GstRow {
  taxPct: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface GstSplit {
  interState: boolean;
  rows: GstRow[];
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * Splits the tax of each rate into CGST + SGST (same state) or IGST (another state).
 * Halves of an odd paisa: CGST takes the extra paisa, so CGST + SGST always equals the tax.
 */
export function splitGst(totals: Pick<InvoiceTotals, 'taxBreakdown'>, interState: boolean): GstSplit {
  const rows = totals.taxBreakdown.map((r) => {
    if (interState) return { taxPct: r.taxPct, taxable: r.taxable, cgst: 0, sgst: 0, igst: r.tax };
    const cgst = roundHalfUp(r.tax / 2);
    return { taxPct: r.taxPct, taxable: r.taxable, cgst, sgst: r.tax - cgst, igst: 0 };
  });
  return {
    interState,
    rows,
    cgst: rows.reduce((a, r) => a + r.cgst, 0),
    sgst: rows.reduce((a, r) => a + r.sgst, 0),
    igst: rows.reduce((a, r) => a + r.igst, 0),
  };
}

/** "9.5" style half rate for labels: 18 → "9", 5 → "2.5". */
export const halfRate = (pct: number) => String(Number((pct / 2).toFixed(3)));

/** HSN (goods) / SAC (services) codes are 4, 6 or 8 digits. */
export function checkHsn(raw: string): boolean {
  return /^(\d{4}|\d{6}|\d{8})$/.test(raw.trim());
}

/* ---------- document numbering ---------- */

/** Number series of a store. Tax invoices and non-GST bills are numbered separately. */
export const NUMBER_SERIES = ['invoice', 'bill', 'estimate', 'credit'] as const;
export type NumberSeries = (typeof NUMBER_SERIES)[number];

/** Owner: INV/26-27/0001; staff member B: INV-B/26-27/0001. */
export const DEFAULT_NUMBER_PATTERN = '{PREFIX}-{CODE}/{FY}/{SEQ}';

/**
 * How a store numbers its tax invoices, bills and credit notes:
 * perPerson = each person has their own series (the owner's has no letter), numbered on the phone;
 * shared = one series for everyone, phones hold a block of numbers from the server.
 * Estimates always use one shared series.
 */
export const NUMBERING_MODES = ['perPerson', 'shared'] as const;
export type NumberingMode = (typeof NUMBERING_MODES)[number];

/** A person's series letter(s): "B", "C" … "Z", then "AA", "AB" … */
export const SERIES_CODE = /^[A-Z]{1,2}$/;

/** The first letter code not in `used`. "A" is skipped so it is never mistaken for the owner. */
export function nextSeriesCode(used: Iterable<string>): string {
  const taken = new Set(used);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const c of letters.slice(1)) if (!taken.has(c)) return c;
  for (const a of letters) for (const b of letters) if (!taken.has(a + b)) return a + b;
  throw new Error('No series codes left');
}

/** "invoice:26-27" (owner / shared) or "invoice-B:26-27" (staff member B). */
export function seriesKey(series: NumberSeries, code: string, period: string): string {
  return `${series}${code ? `-${code}` : ''}:${period}`;
}

const SERIES_KEY_RE = /^([a-z]+)(?:-([A-Z]{1,2}))?:(\d{2}-\d{2}|all)$/;

export function parseSeriesKey(key: string): { series: NumberSeries; code: string; period: string } | null {
  const m = SERIES_KEY_RE.exec(key);
  if (!m || !NUMBER_SERIES.includes(m[1] as NumberSeries)) return null;
  return { series: m[1] as NumberSeries, code: m[2] ?? '', period: m[3]! };
}

/**
 * Tokens: {PREFIX}; {CODE} = the person's series letter (dropped, with the "-" or "/" before it,
 * when there is none); {FY} = 26-27; {FY4} = 2026-27; {YYYY} = calendar year; {SEQ} = the running
 * number padded to `digits`. Anything else is copied as typed.
 */
export function formatNumber(pattern: string, prefix: string, fyLabel: string, date: string, seq: number, digits: number, code = ''): string {
  const start = Number(fyLabel.slice(0, 2));
  return (code ? pattern.replaceAll('{CODE}', code) : pattern.replace(/[-/]?\{CODE\}/g, ''))
    .replaceAll('{PREFIX}', prefix)
    .replaceAll('{FY4}', `20${String(start).padStart(2, '0')}-${fyLabel.slice(3)}`)
    .replaceAll('{FY}', fyLabel)
    .replaceAll('{YYYY}', date.slice(0, 4))
    .replaceAll('{SEQ}', String(seq).padStart(digits, '0'));
}

/**
 * Problems with a number pattern, or null when it is fine. GST rules: at most 16 characters,
 * only letters, digits, "-" and "/"; unique within a financial year.
 */
export function checkNumberPattern(pattern: string, prefixes: string[], digits: number, resetEachFY: boolean, mode: NumberingMode = 'shared'): string | null {
  if (!pattern.includes('{SEQ}')) return 'The pattern must contain {SEQ}';
  if (mode === 'perPerson' && !pattern.includes('{CODE}')) return 'Each person has their own series, so the pattern needs {CODE} (their letter)';
  if (resetEachFY && !pattern.includes('{FY}') && !pattern.includes('{FY4}')) {
    return 'Numbering restarts every year, so the pattern needs {FY} or {FY4} to keep numbers unique';
  }
  for (const prefix of prefixes) {
    // Staff numbers carry a letter, so check the longer form.
    const sample = formatNumber(pattern, prefix, '26-27', '2026-11-24', 10 ** digits - 1, digits, 'B');
    if (/[{}]/.test(sample)) return 'Unknown {TOKEN} in the pattern';
    if (!/^[A-Za-z0-9/-]+$/.test(sample)) return 'Only letters, digits, "-" and "/" are allowed in GST invoice numbers';
    if (sample.length > 16) return `Numbers like ${sample} are longer than the 16 characters GST allows`;
  }
  return null;
}
