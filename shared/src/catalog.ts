import { z } from 'zod';

/**
 * The shared product list (R5): products kept by ApnaGalla that shops pick from when they add an
 * item. No prices: picking one copies name, unit, category, HSN and GST into a new item of the
 * shop. Product = generic item + brand + pack ("Aashirvaad Wheat Atta 5 kg"); a row without a
 * brand is the loose / unbranded generic item.
 */

export const CATALOG_SECTIONS = ['kirana', 'hardware', 'garments', 'fruits_veg', 'acrylic', 'bakery'] as const;
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

export interface CatalogItemDto {
  id: string;
  section: CatalogSection;
  category: string;
  item: string;
  brand: string | null;
  size: number | null;
  sizeUnit: string | null;
  sellUnit: string;
  hsn: string | null;
  gstPct: number | null;
  /** Other names and spellings (Hindi, Gujarati, Punjabi, Hinglish, brand misspellings). */
  otherNames: string[];
  deleted?: boolean;
  seq: number;
}

export interface CatalogAliasDto {
  /** A word people type ("ashirwad", "तेल", "chawal"). */
  word: string;
  /** What it means in the list ("Aashirvaad", "Oil", "Rice"). */
  means: string;
  deleted?: boolean;
  seq: number;
}

export interface CatalogPage<T> {
  rows: T[];
  /** Ask again with since = cursor; `more` = there is more right away. */
  cursor: number;
  more: boolean;
}

export const CATALOG_PAGE = 2000;

const text = (max: number) => z.string().trim().max(max);

/** One row as typed in the Excel sheet (admin upload). */
export const catalogRowBody = z.object({
  category: text(80).min(1),
  item: text(120).min(1),
  brand: text(60).nullish(),
  size: z.number().positive().max(1_000_000).nullish(),
  sizeUnit: text(12).nullish(),
  sellUnit: text(12).min(1),
  hsn: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'HSN must be 4 to 8 digits')
    .nullish(),
  gstPct: z.number().min(0).max(40).nullish(),
  otherNames: z.array(text(60)).max(30).default([]),
  notes: text(300).nullish(),
});
export type CatalogRowInput = z.input<typeof catalogRowBody>;

export const catalogImportBody = z.object({
  section: z.enum(CATALOG_SECTIONS),
  rows: z.array(catalogRowBody).max(20_000),
  /** true = rows of the section not in this sheet are removed. */
  replace: z.boolean().default(false),
});

export const catalogAliasImportBody = z.object({
  rows: z.array(z.object({ word: text(60).min(1), means: text(60).min(1) })).max(5_000),
  replace: z.boolean().default(false),
});

export interface CatalogImportResult {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

export interface CatalogSectionStat {
  section: CatalogSection;
  items: number;
  updatedAt: string | null;
}

const trimNum = (n: number) => String(Math.round(n * 1000) / 1000);

/** "Aashirvaad Wheat Atta 5 kg" (brand and pack only when there are). */
export function catalogName(r: Pick<CatalogItemDto, 'brand' | 'item' | 'size' | 'sizeUnit'>): string {
  const pack = r.size ? `${trimNum(r.size)} ${r.sizeUnit ?? ''}`.trim() : '';
  return [r.brand, r.item, pack].filter(Boolean).join(' ');
}

/** The same product always gets the same id (section + item + brand + pack). */
export function catalogId(section: string, r: Pick<CatalogItemDto, 'brand' | 'item' | 'size' | 'sizeUnit'>): string {
  const key = [section, r.item, r.brand ?? '', r.size ? trimNum(r.size) : '', r.sizeUnit ?? ''].map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
  // Two 32-bit FNV-1a hashes (different seeds): plenty for tens of thousands of rows.
  const fnv = (seed: number) => {
    let h = seed;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36).padStart(7, '0');
  };
  return `${section.slice(0, 1)}${fnv(0x811c9dc5)}${fnv(0x2f1a6d3b)}`;
}

/* ---------------- search (runs on the phone, offline) ---------------- */

/** Lower case, no punctuation; keeps Indian scripts (with their vowel signs). */
export function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/['’`]/g, '') // "men's" → "mens"
    .replace(/(\d)([a-z]+)/g, '$1 $2') // "5kg" → "5 kg", "500ml" → "500 ml"
    .replace(/[^\p{L}\p{M}\p{N}.]+/gu, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** Unit spellings people type → the list's units. */
const UNIT_WORDS: Record<string, string> = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', किलो: 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', ग्राम: 'g',
  l: 'l', lt: 'l', ltr: 'l', litre: 'l', liter: 'l', litres: 'l', लीटर: 'l',
  ml: 'ml', mls: 'ml',
  m: 'm', mtr: 'm', meter: 'm', metre: 'm', mtrs: 'm',
  pc: 'pcs', pcs: 'pcs', piece: 'pcs', pieces: 'pcs',
};

/** Typo-tolerant compare for longer words: one letter different, missing or extra. */
function nearly(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export interface CatalogIndexEntry {
  row: CatalogItemDto;
  name: string;
  /** Words of the brand, item and other names. */
  words: string[];
  /** Words of the category (they count for less). */
  catWords: string[];
  /** Pack size and unit for "1 l", "500 g". */
  size: number | null;
  unit: string | null;
}

export interface CatalogIndex {
  entries: CatalogIndexEntry[];
  /** alias word → words it means. */
  aliases: Map<string, string[]>;
}

export function buildCatalogIndex(rows: CatalogItemDto[], aliases: Pick<CatalogAliasDto, 'word' | 'means'>[]): CatalogIndex {
  const entries = rows
    .filter((r) => !r.deleted)
    .map((row) => {
      const words = new Set([...normalizeWords(row.brand ?? ''), ...normalizeWords(row.item), ...row.otherNames.flatMap(normalizeWords)]);
      const catWords = normalizeWords(row.category).filter((w) => !words.has(w));
      const unit = row.sizeUnit ? (UNIT_WORDS[row.sizeUnit.toLowerCase()] ?? row.sizeUnit.toLowerCase()) : null;
      return { row, name: catalogName(row), words: [...words], catWords, size: row.size, unit };
    });
  const map = new Map<string, string[]>();
  for (const a of aliases) {
    const [w] = normalizeWords(a.word);
    if (!w) continue;
    map.set(w, [...(map.get(w) ?? []), ...normalizeWords(a.means)]);
  }
  return { entries, aliases: map };
}

/** Score of one typed word against a product's words (0 = no match). */
function wordScore(q: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === q) return 3;
    if (w.startsWith(q)) best = Math.max(best, q.length >= 3 ? 2.5 : 2);
    else if (q.length >= 4 && nearly(q, w.slice(0, Math.max(q.length, Math.min(w.length, q.length + 1))))) best = Math.max(best, 1.5);
    else if (q.length >= 5 && w.length >= 4 && nearly(q, w)) best = Math.max(best, 1.5);
  }
  return best;
}

/**
 * Products matching what was typed ("fortune oil 1", "ashirwad atta 5kg", "तेल"). Every word must
 * match (a brand, item, category or other name; a number matches the pack size; a unit the pack
 * unit). Best first: whole-word matches, then shorter names.
 */
export function searchCatalog(index: CatalogIndex, query: string, limit = 12): CatalogIndexEntry[] {
  const raw = normalizeWords(query);
  if (!raw.length || (raw.length === 1 && raw[0]!.length < 2 && !/\d/.test(raw[0]!))) return [];
  const nums: number[] = [];
  const units: string[] = [];
  const words: string[][] = []; // each typed word with what it may mean
  for (const w of raw) {
    if (/^\d+(\.\d+)?$/.test(w)) nums.push(Number(w));
    else if (UNIT_WORDS[w] && raw.length > 1) units.push(UNIT_WORDS[w]);
    else words.push([w, ...(index.aliases.get(w) ?? [])]);
  }
  const scored: { e: CatalogIndexEntry; score: number }[] = [];
  for (const e of index.entries) {
    let score = 0;
    let ok = true;
    for (const alts of words) {
      const s = Math.max(...alts.map((a) => Math.max(wordScore(a, e.words), wordScore(a, e.catWords) * 0.4)));
      if (!s) {
        ok = false;
        break;
      }
      score += s;
    }
    if (!ok) continue;
    for (const n of nums) {
      // A number is the pack size ("1" → 1 L, also the start of 100 g) or part of the name
      // ("1.5" → wire 1.5 sq mm, "40" → 40A).
      if (e.words.includes(String(n))) score += 2.5;
      else if (e.size === n) score += 2;
      else if (e.size != null && String(e.size).startsWith(String(n))) score += 0.5;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const u of units) {
      if (e.unit === u) score += 1;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!words.length && !nums.length) continue;
    scored.push({ e, score: score - e.name.length / 200 + (e.row.brand ? 0 : 0.1) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}
