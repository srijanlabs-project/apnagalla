#!/usr/bin/env node
/**
 * Translation tooling for the app (English text is the key; see src/lib/i18n.ts).
 *
 *   node scripts/i18n.mjs check        list phrases in the code and which languages miss them
 *   node scripts/i18n.mjs export FILE  write the review sheet (CSV: English, Hindi, Gujarati, Punjabi)
 *   node scripts/i18n.mjs import FILE  read a reviewed sheet back into src/i18n/{hi,gu,pa}.json
 *
 * The sheet opens in Excel / Google Sheets (UTF-8). Reviewers change only the language columns.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const LANGS = ['hi', 'gu', 'pa'];
const NAMES = { hi: 'Hindi', gu: 'Gujarati', pa: 'Punjabi' };

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'i18n' ? [] : files(p);
    return /\.(tsx?|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

const unescape = (s) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

/** t('…'), L('…') (receipt labels) and translate(lang, '…'); single or double quotes. */
export function phrasesIn(src) {
  const out = [];
  const re = /\b(?:t|L)\(\s*(['"])((?:\\.|(?!\1).)*)\1|\btranslate\([^,()]+,\s*(['"])((?:\\.|(?!\3).)*)\3/g;
  for (const m of src.matchAll(re)) out.push(unescape(m[2] ?? m[4]));
  return out;
}

function collect() {
  const where = new Map();
  for (const f of files(root)) {
    for (const p of phrasesIn(readFileSync(f, 'utf8'))) {
      if (!where.has(p)) where.set(p, new Set());
      where.get(p).add(f.slice(root.length + 1).replace(/\\/g, '/'));
    }
  }
  return where;
}

const dict = (l) => JSON.parse(readFileSync(join(root, 'i18n', `${l}.json`), 'utf8'));
const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}

const [cmd, file] = process.argv.slice(2);
const phrases = collect();

if (cmd === 'check') {
  const dicts = Object.fromEntries(LANGS.map((l) => [l, dict(l)]));
  console.log(`${phrases.size} phrases in the code`);
  for (const l of LANGS) {
    const missing = [...phrases.keys()].filter((p) => !dicts[l][p]);
    const unused = Object.keys(dicts[l]).filter((k) => !phrases.has(k));
    console.log(`${NAMES[l]}: ${phrases.size - missing.length} translated, ${missing.length} missing, ${unused.length} no longer used`);
    if (process.argv.includes('--list')) missing.forEach((p) => console.log(`  - ${p}`));
  }
} else if (cmd === 'export' && file) {
  const dicts = Object.fromEntries(LANGS.map((l) => [l, dict(l)]));
  const lines = [['English', ...LANGS.map((l) => NAMES[l]), 'Where'].map(csvCell).join(',')];
  for (const [p, where] of [...phrases].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push([p, ...LANGS.map((l) => dicts[l][p] ?? ''), [...where].join(' ')].map(csvCell).join(','));
  }
  writeFileSync(file, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`Wrote ${phrases.size} phrases to ${file}`);
} else if (cmd === 'import' && file) {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(LANGS.map((l) => [l, head.indexOf(NAMES[l].toLowerCase())]));
  const en = head.indexOf('english');
  if (en < 0 || LANGS.some((l) => col[l] < 0)) throw new Error('The sheet needs English, Hindi, Gujarati and Punjabi columns');
  for (const l of LANGS) {
    const d = dict(l);
    let changed = 0;
    for (const r of rows) {
      const key = r[en];
      const val = (r[col[l]] ?? '').trim();
      if (!key || !val || !phrases.has(key)) continue;
      // Placeholders must survive translation.
      const need = (key.match(/\{\w+\}/g) ?? []).sort().join();
      const got = (val.match(/\{\w+\}/g) ?? []).sort().join();
      if (need !== got) {
        console.warn(`${NAMES[l]}: placeholders differ, skipped: "${key}"`);
        continue;
      }
      if (d[key] !== val) (d[key] = val), changed++;
    }
    const sorted = Object.fromEntries(Object.entries(d).sort((a, b) => a[0].localeCompare(b[0])));
    writeFileSync(join(root, 'i18n', `${l}.json`), JSON.stringify(sorted, null, 2) + '\n', 'utf8');
    console.log(`${NAMES[l]}: ${changed} phrases updated`);
  }
} else {
  console.log('Usage: node scripts/i18n.mjs check [--list] | export FILE.csv | import FILE.csv');
}
