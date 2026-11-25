#!/usr/bin/env node
/**
 * Builds the review workbook for the starter product lists (one sheet per list + other spellings),
 * from server/catalog/starter/*.csv. Rows with a note are highlighted for the reviewer.
 *
 *   node server/scripts/catalog-review.mjs   → docs/product-list-review.xlsx
 *
 * After review, upload each sheet (saved as .xlsx or .csv) in the admin console → Product list.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import writeXlsxFile from 'write-excel-file/node';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'server', 'catalog', 'starter');

/** RFC 4180 CSV (quotes, commas and new lines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const NUMERIC = new Set(['Size', 'GST %']);
const sheet = (name, label) => {
  const [head, ...rows] = parseCsv(readFileSync(join(dir, `${name}.csv`), 'utf8'));
  const notes = head.indexOf('Notes');
  const data = [
    head.map((h) => ({ value: h, fontWeight: 'bold', backgroundColor: '#DDE7F0' })),
    ...rows.map((r) => {
      const flag = notes >= 0 && r[notes];
      return head.map((h, j) => {
        const v = r[j] ?? '';
        const value = NUMERIC.has(h) && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
        return { value, type: typeof value === 'number' ? Number : String, ...(flag ? { backgroundColor: '#FFF4CC' } : {}) };
      });
    }),
  ];
  const widths = { Category: 22, Item: 34, Brand: 18, Size: 8, 'Size unit': 9, 'Sell unit': 9, HSN: 10, 'GST %': 7, 'Other names': 40, Notes: 40, Word: 24, Means: 24 };
  return { data, sheet: label, columns: head.map((h) => ({ width: widths[h] ?? 14 })), rows: rows.length, flagged: notes >= 0 ? rows.filter((r) => r[notes]).length : 0 };
};

const read = (rows) =>
  [
    ['Starter product lists for review'],
    [''],
    ['Each sheet is one list. Yellow rows have a note: please check those first (GST rate or HSN code we were not sure of).'],
    ['Change any cell; add or delete rows. Keep the column headings as they are.'],
    ['Other names: Hindi / Gujarati / Punjabi words and common spellings, separated by ;'],
    ['GST %: one of 0, 5, 18, 40 (GST 2.0). Garments: 5% up to ₹2,500 a piece, 18% above (noted on the rows).'],
    ['No prices: each shop adds its own price when it adds an item.'],
    [''],
    ...rows.map((r) => [`${r.sheet}: ${r.rows} rows, ${r.flagged} with notes`]),
  ].map((r) => r.map((value) => ({ value })));

const sheets = [sheet('kirana', 'Kirana'), sheet('hardware', 'Hardware & electrical'), sheet('garments', 'Garments'), sheet('aliases', 'Other spellings')];
const buffer = await writeXlsxFile([{ data: read(sheets), sheet: 'Read me', columns: [{ width: 110 }] }, ...sheets.map(({ data, sheet: s, columns }) => ({ data, sheet: s, columns }))]).toBuffer();
const out = join(root, 'docs', 'product-list-review.xlsx');
writeFileSync(out, buffer);
console.log(`Wrote ${out}: ${sheets.map((s) => `${s.sheet} ${s.rows}`).join(', ')}`);
