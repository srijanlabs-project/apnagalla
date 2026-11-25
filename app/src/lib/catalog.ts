import {
  CATALOG_SECTIONS,
  buildCatalogIndex,
  catalogName,
  searchCatalog,
  type CatalogIndex,
  type CatalogIndexEntry,
  type CatalogItemDto,
  type CatalogSection,
} from '@invoice/shared';
import { api } from './api';
import { db, type Item } from './db';
import { t } from './i18n';
import { newId, putRecord, type Actor } from './repo';

/**
 * The shared product list on this phone (R5). Each store picks its sections (Kirana, Hardware,
 * Garments); the phone keeps the sections of all its stores, downloads them once and then only
 * changes, and searches them offline. It is a suggestion list: picking a product makes a normal
 * item of the shop (the shop adds its own price).
 */

export const SECTION_LABEL: Record<CatalogSection, () => string> = {
  kirana: () => t('Kirana / grocery'),
  hardware: () => t('Hardware and electrical'),
  garments: () => t('Garments'),
};

const metaKey = (section: string) => `catalog.cursor.${section}`;
const ALIAS_KEY = 'catalog.cursor.aliases';
const CHECKED_KEY = 'catalog.checkedAt';
/** Bumped after each download, so search indexes rebuild. */
export const VERSION_KEY = 'catalog.version';
const RECHECK_MS = 6 * 3600_000;

async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });

/** Sections wanted by any store on this phone. */
export async function wantedSections(): Promise<CatalogSection[]> {
  const all = await db.settings.toArray();
  const set = new Set<CatalogSection>();
  for (const s of all) for (const x of s.catalogSections ?? []) if ((CATALOG_SECTIONS as readonly string[]).includes(x)) set.add(x);
  return [...set];
}

let running: Promise<number> | null = null;

/**
 * Downloads what changed in the wanted sections (and drops sections no store wants any more).
 * At most every few hours unless `force`. Returns the number of rows that changed; never throws.
 */
export function refreshCatalog(force = false): Promise<number> {
  running ??= doRefresh(force).finally(() => (running = null));
  return running;
}

async function doRefresh(force: boolean): Promise<number> {
  try {
    const wanted = await wantedSections();
    let changed = 0;
    // Sections nobody wants any more: free the space.
    for (const s of CATALOG_SECTIONS) {
      if (wanted.includes(s) || (await getMeta(metaKey(s))) === undefined) continue;
      changed += await db.catalogItems.where('section').equals(s).delete();
      await db.meta.delete(metaKey(s));
    }
    const fresh = (await Promise.all(wanted.map((s) => getMeta(metaKey(s))))).some((c) => c === undefined);
    const last = (await getMeta<number>(CHECKED_KEY)) ?? 0;
    if (!wanted.length || (!force && !fresh && Date.now() - last < RECHECK_MS)) {
      if (changed) await setMeta(VERSION_KEY, Date.now());
      return changed;
    }
    for (const section of wanted) {
      let since = (await getMeta<number>(metaKey(section))) ?? 0;
      for (;;) {
        const page = await api.catalogItems(section, since);
        const live = page.rows.filter((r) => !r.deleted);
        const gone = page.rows.filter((r) => r.deleted).map((r) => r.id);
        await db.transaction('rw', [db.catalogItems, db.meta], async () => {
          if (live.length) await db.catalogItems.bulkPut(live);
          if (gone.length) await db.catalogItems.bulkDelete(gone);
          await setMeta(metaKey(section), page.cursor);
        });
        changed += page.rows.length;
        since = page.cursor;
        if (!page.more) break;
      }
    }
    let since = (await getMeta<number>(ALIAS_KEY)) ?? 0;
    for (;;) {
      const page = await api.catalogAliases(since);
      const live = page.rows.filter((r) => !r.deleted);
      const gone = page.rows.filter((r) => r.deleted).map((r) => r.word);
      await db.transaction('rw', [db.catalogAliases, db.meta], async () => {
        if (live.length) await db.catalogAliases.bulkPut(live);
        if (gone.length) await db.catalogAliases.bulkDelete(gone);
        await setMeta(ALIAS_KEY, page.cursor);
      });
      changed += page.rows.length;
      since = page.cursor;
      if (!page.more) break;
    }
    await setMeta(CHECKED_KEY, Date.now());
    if (changed) await setMeta(VERSION_KEY, Date.now());
    return changed;
  } catch {
    return 0; // offline or server busy: try again next time
  }
}

/* ---------- search index (built once per set of sections and download) ---------- */

let cached: { key: string; index: CatalogIndex } | null = null;

export async function catalogIndex(sections: CatalogSection[]): Promise<CatalogIndex | null> {
  if (!sections.length) return null;
  const version = (await getMeta<number>(VERSION_KEY)) ?? 0;
  const key = `${[...sections].sort().join(',')}@${version}`;
  if (cached?.key === key) return cached.index;
  const [rows, aliases] = await Promise.all([db.catalogItems.where('section').anyOf(sections).toArray(), db.catalogAliases.toArray()]);
  cached = { key, index: buildCatalogIndex(rows, aliases) };
  return cached.index;
}

export async function catalogCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of CATALOG_SECTIONS) out[s] = await db.catalogItems.where('section').equals(s).count();
  return out;
}

export { searchCatalog, catalogName, type CatalogIndexEntry };

/* ---------- picking a product ---------- */

/** The store's category with this name; the owner gets it made if it isn't there. */
export async function categoryFor(actor: Actor, name: string): Promise<string | null> {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const found = await db.categories.where('businessId').equals(actor.businessId).filter((c) => !c.deleted && c.name.trim().toLowerCase() === want).first();
  if (found) return found.id;
  if (actor.role !== 'owner') return null;
  const made = await putRecord('categories', actor, { id: newId(), name: name.trim(), parentId: null });
  return made.id;
}

/** Item fields that come from a product (the shop adds price, cost, MRP and stock). */
export function itemFieldsFrom(row: CatalogItemDto, defaultTaxPct: number, units: string[]): Partial<Item> {
  const unit = units.find((u) => u.toLowerCase() === row.sellUnit.toLowerCase()) ?? row.sellUnit;
  return {
    name: catalogName(row),
    unit,
    hsn: row.hsn ?? undefined,
    taxPct: row.gstPct ?? defaultTaxPct,
    catalogId: row.id,
  };
}

/** Makes a shop item from a product with the price the shop typed. */
export async function addItemFromCatalog(
  actor: Actor,
  row: CatalogItemDto,
  input: { rate: number; purchasePrice?: number | null; rateIncludesTax: boolean; defaultTaxPct: number; units: string[] },
): Promise<Item> {
  const categoryId = await categoryFor(actor, row.category);
  return putRecord('items', actor, {
    id: newId(),
    ...itemFieldsFrom(row, input.defaultTaxPct, input.units),
    rate: input.rate,
    rateIncludesTax: input.rateIncludesTax,
    ...(input.purchasePrice ? { purchasePrice: input.purchasePrice } : {}),
    ...(categoryId ? { categoryId } : {}),
  } as Item);
}
