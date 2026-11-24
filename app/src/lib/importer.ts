import { checkGstin, checkHsn, normalizeIndianMobile, parseRupees, stateName } from '@invoice/shared';
import { INDIAN_STATES } from './format';
import { ensureCategoryPath } from './categories';
import { db, type Category, type Customer, type Item } from './db';
import { newId, putRecord, type Actor } from './repo';

/*
 * Import items or customers from an Excel (.xlsx) or CSV file. Columns are found by their
 * heading (several spellings allowed, any order). Every row is checked and matched with existing
 * records first; the owner sees the preview and chooses to update or skip matching records.
 */

export type ImportKind = 'items' | 'customers';
export type Cell = string | number | boolean | Date | null;

interface Column {
  key: string;
  label: string;
  /** Headings that mean this column (lower-case, spaces/punctuation ignored). */
  names: string[];
  required?: boolean;
  example: string;
}

export const COLUMNS: Record<ImportKind, Column[]> = {
  items: [
    { key: 'name', label: 'Name', names: ['name', 'itemname', 'item', 'product', 'productname'], required: true, example: 'Asian Paints Apex 20L' },
    { key: 'price', label: 'Price', names: ['price', 'rate', 'sellingprice', 'saleprice', 'salesprice'], required: true, example: '4500' },
    { key: 'unit', label: 'Unit', names: ['unit', 'uom'], example: 'pcs' },
    { key: 'tax', label: 'GST %', names: ['gst', 'gst%', 'tax', 'tax%', 'gstrate', 'taxrate'], example: '18' },
    { key: 'incl', label: 'Price includes tax', names: ['priceincludestax', 'inclusive', 'incltax', 'taxinclusive'], example: 'no' },
    { key: 'hsn', label: 'HSN', names: ['hsn', 'hsncode', 'sac', 'hsnsac'], example: '3209' },
    { key: 'category', label: 'Category', names: ['category', 'group', 'categorypath'], example: 'Paints > Exterior' },
    { key: 'code', label: 'Item code', names: ['code', 'itemcode', 'sku'], example: 'AP-APX-20' },
    { key: 'barcode', label: 'Barcode', names: ['barcode', 'ean', 'upc'], example: '8901234567890' },
    { key: 'mrp', label: 'MRP', names: ['mrp'], example: '5600' },
    { key: 'cost', label: 'Purchase price', names: ['purchaseprice', 'cost', 'costprice', 'buyprice'], example: '3900' },
    { key: 'priced', label: 'Priced per', names: ['pricedper', 'priced', 'pricing'], example: 'unit' },
    { key: 'description', label: 'Description', names: ['description', 'details'], example: '' },
  ],
  customers: [
    { key: 'name', label: 'Name', names: ['name', 'customer', 'customername', 'party', 'partyname'], required: true, example: 'Patel Traders' },
    { key: 'mobile', label: 'Mobile', names: ['mobile', 'phone', 'mobileno', 'phoneno', 'contact', 'mobilenumber'], example: '9876543210' },
    { key: 'gstin', label: 'GSTIN', names: ['gstin', 'gst', 'gstno', 'gstnumber'], example: '24AABCP1234K1ZP' },
    { key: 'email', label: 'Email', names: ['email', 'emailid'], example: '' },
    { key: 'line1', label: 'Address line 1', names: ['addressline1', 'address', 'address1'], example: '12 Station Road' },
    { key: 'line2', label: 'Address line 2', names: ['addressline2', 'address2', 'area'], example: '' },
    { key: 'city', label: 'City', names: ['city', 'town'], example: 'Ahmedabad' },
    { key: 'state', label: 'State', names: ['state'], example: 'Gujarat' },
    { key: 'pin', label: 'PIN', names: ['pin', 'pincode', 'zip', 'postalcode'], example: '380001' },
    { key: 'opening', label: 'Opening balance', names: ['openingbalance', 'opening', 'balance', 'due', 'outstanding'], example: '0' },
  ],
};

export const MAX_IMPORT_ROWS = 5000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]/g, '');

/** Template file (CSV, opens in Excel): headings plus one example row. */
export function templateCsv(kind: ImportKind): string {
  const cols = COLUMNS[kind];
  return [cols.map((c) => c.label), cols.map((c) => c.example)].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Minimal CSV reader: commas or semicolons, quoted fields, "" inside quotes. */
export function parseCsv(text: string): Cell[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
}

/** Reads the first sheet of an .xlsx, or a .csv file. */
export async function readRows(file: File): Promise<Cell[][]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an Excel (.xlsx) or CSV file. Older .xls files: open in Excel and "Save as" .xlsx.');
  const { readSheet } = await import('read-excel-file/browser');
  return (await readSheet(file)) as Cell[][];
}

const text = (v: Cell | undefined): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const money = (v: Cell | undefined): number | null | 'bad' => {
  const s = text(v);
  if (!s) return null;
  if (typeof v === 'number') return Math.round(v * 100);
  return parseRupees(s) ?? 'bad';
};
const yes = (v: Cell | undefined) => /^(y|yes|true|1|incl|inclusive)$/i.test(text(v));

export interface PreviewRow<T> {
  /** Line number in the file (1 = headings). */
  line: number;
  name: string;
  errors: string[];
  /** The record as it would be saved (fields from the file only). */
  values: Partial<T>;
  categoryPath?: string;
  /** Existing record this row matches, if any. */
  match?: T;
}

export interface Preview<T> {
  kind: ImportKind;
  rows: PreviewRow<T>[];
  /** Headings that were recognised, and ones that were not. */
  used: string[];
  ignored: string[];
  missing: string[];
}

/** Finds the columns, checks every row and matches it with existing records. */
export function buildPreview(kind: 'items', rows: Cell[][], existing: Item[]): Preview<Item>;
export function buildPreview(kind: 'customers', rows: Cell[][], existing: Customer[]): Preview<Customer>;
export function buildPreview(kind: ImportKind, rows: Cell[][], existing: (Item | Customer)[]): Preview<Item | Customer> {
  const cols = COLUMNS[kind];
  const headings = (rows[0] ?? []).map((h) => text(h));
  const index = new Map<string, number>();
  const ignored: string[] = [];
  headings.forEach((h, i) => {
    const col = cols.find((c) => c.names.includes(norm(h)) || norm(c.label) === norm(h));
    if (col && !index.has(col.key)) index.set(col.key, i);
    else if (h) ignored.push(h);
  });
  const missing = cols.filter((c) => c.required && !index.has(c.key)).map((c) => c.label);
  const get = (r: Cell[], key: string) => (index.has(key) ? r[index.get(key)!] : undefined);
  const body = rows.slice(1, MAX_IMPORT_ROWS + 1);
  const out: PreviewRow<Item | Customer>[] = [];
  const seen = new Set<string>();

  body.forEach((r, i) => {
    const line = i + 2;
    const errors: string[] = [];
    const name = text(get(r, 'name'));
    if (!name) errors.push('Name is missing');

    if (kind === 'items') {
      const values: Partial<Item> = { name };
      const price = money(get(r, 'price'));
      if (price === 'bad' || price == null) errors.push('Price is missing or not a number');
      else values.rate = price;
      const tax = text(get(r, 'tax')).replace('%', '');
      if (tax) {
        const n = Number(tax);
        if (!Number.isFinite(n) || n < 0 || n > 100) errors.push(`GST % "${tax}" is not a number`);
        else values.taxPct = n;
      }
      if (index.has('incl')) values.rateIncludesTax = yes(get(r, 'incl'));
      const unit = text(get(r, 'unit'));
      if (unit) values.unit = unit.slice(0, 10);
      const hsn = text(get(r, 'hsn')).replace(/\D/g, '');
      if (hsn) {
        if (checkHsn(hsn)) values.hsn = hsn;
        else errors.push(`HSN "${hsn}" should be 4, 6 or 8 digits`);
      }
      const code = text(get(r, 'code'));
      if (code) values.code = code.slice(0, 30);
      const barcode = text(get(r, 'barcode'));
      if (barcode) values.barcode = barcode;
      for (const [key, field, label] of [
        ['mrp', 'mrp', 'MRP'],
        ['cost', 'purchasePrice', 'Purchase price'],
      ] as const) {
        const m = money(get(r, key));
        if (m === 'bad') errors.push(`${label} is not a number`);
        else if (m != null) values[field] = m;
      }
      const priced = norm(text(get(r, 'priced')));
      if (priced) {
        const p = priced.includes('sq') ? 'sqft' : priced.includes('r') && priced.includes('ft') ? 'rft' : priced.includes('running') ? 'rft' : 'unit';
        values.pricing = p;
        if (p === 'sqft') values.unit = 'sq ft';
        if (p === 'rft') values.unit = 'rft';
      }
      const description = text(get(r, 'description'));
      if (description) values.description = description;

      const items = existing as Item[];
      const match =
        (values.barcode && items.find((x) => x.barcode === values.barcode)) ||
        (values.code && items.find((x) => x.code?.toLowerCase() === values.code!.toLowerCase())) ||
        items.find((x) => x.name.toLowerCase() === name.toLowerCase()) ||
        undefined;
      const key = (values.barcode || values.code || name).toLowerCase();
      if (name && seen.has(key)) errors.push('Same item appears earlier in the file');
      seen.add(key);
      out.push({ line, name, errors, values, categoryPath: text(get(r, 'category')) || undefined, match });
    } else {
      const values: Partial<Customer> = { name };
      const mobile = text(get(r, 'mobile'));
      if (mobile) {
        const m = normalizeIndianMobile(mobile);
        if (m) values.phone = m;
        else errors.push(`Mobile "${mobile}" is not a 10-digit Indian number`);
      }
      const gstin = text(get(r, 'gstin')).toUpperCase();
      let gstState: string | undefined;
      if (gstin) {
        const g = checkGstin(gstin);
        if (g.ok) {
          values.taxId = g.gstin;
          gstState = stateName(g.stateCode);
        } else errors.push(`GSTIN: ${g.message}`);
      }
      const email = text(get(r, 'email'));
      if (email) {
        if (/^\S+@\S+\.\S+$/.test(email)) values.email = email;
        else errors.push(`Email "${email}" looks wrong`);
      }
      const stateRaw = text(get(r, 'state'));
      const state = INDIAN_STATES.find((s) => s.toLowerCase() === stateRaw.toLowerCase()) ?? (stateRaw ? undefined : gstState);
      if (stateRaw && !state) errors.push(`State "${stateRaw}" is not an Indian state name`);
      const address = { line1: text(get(r, 'line1')) || undefined, line2: text(get(r, 'line2')) || undefined, city: text(get(r, 'city')) || undefined, state, pin: text(get(r, 'pin')) || undefined };
      if (Object.values(address).some(Boolean)) values.billingAddress = address;
      const opening = money(get(r, 'opening'));
      if (opening === 'bad') errors.push('Opening balance is not a number');
      else if (opening != null) values.openingBalance = opening;

      const customers = existing as Customer[];
      const match =
        (values.phone && customers.find((x) => x.phone === values.phone)) ||
        (values.taxId && customers.find((x) => x.taxId === values.taxId)) ||
        customers.find((x) => x.name.toLowerCase() === name.toLowerCase()) ||
        undefined;
      const key = (values.phone || values.taxId || name).toLowerCase();
      if (name && seen.has(key)) errors.push('Same customer appears earlier in the file');
      seen.add(key);
      out.push({ line, name, errors, values, match });
    }
  });

  return { kind, rows: out, used: headings.filter((h) => h && !ignored.includes(h)), ignored, missing };
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}

/**
 * Saves the rows without errors. Matching records are updated (only the fields the file has) or
 * skipped, as the owner chose. Categories are created from paths like "Paints > Exterior".
 */
export async function applyImport(
  actor: Actor,
  preview: Preview<Item> | Preview<Customer>,
  onMatch: 'update' | 'skip',
  defaults: { unit: string; taxPct: number },
  progress?: (done: number) => void,
): Promise<ImportResult> {
  if (actor.role !== 'owner') throw new Error('Only the owner can import');
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, failed: 0 };
  const cats: Category[] = await db.categories.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).toArray();
  let n = 0;
  for (const row of preview.rows as PreviewRow<Item | Customer>[]) {
    progress?.(++n);
    if (row.errors.length) {
      result.failed++;
      continue;
    }
    if (row.match && onMatch === 'skip') {
      result.skipped++;
      continue;
    }
    if (preview.kind === 'items') {
      const values = { ...(row.values as Partial<Item>) };
      if (row.categoryPath) values.categoryId = await ensureCategoryPath(actor, cats, row.categoryPath);
      const base: Item = (row.match as Item | undefined) ?? {
        id: newId(),
        businessId: actor.businessId,
        createdAt: '',
        updatedAt: '',
        updatedBy: '',
        name: '',
        unit: defaults.unit,
        rate: 0,
        rateIncludesTax: false,
        taxPct: defaults.taxPct,
      };
      await putRecord('items', actor, { ...base, ...values });
    } else {
      const values = row.values as Partial<Customer>;
      const base: Customer = (row.match as Customer | undefined) ?? {
        id: newId(),
        businessId: actor.businessId,
        createdAt: '',
        updatedAt: '',
        updatedBy: '',
        name: '',
        billingAddress: {},
        shippingAddress: null,
        openingBalance: 0,
      };
      const billingAddress = values.billingAddress ? { ...base.billingAddress, ...Object.fromEntries(Object.entries(values.billingAddress).filter(([, v]) => v)) } : base.billingAddress;
      await putRecord('customers', actor, { ...base, ...values, billingAddress });
    }
    row.match ? result.updated++ : result.added++;
  }
  return result;
}
