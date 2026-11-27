import 'fake-indexeddb/auto';
import { catalogId, type CatalogItemDto } from '@invoice/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { addItemFromCatalog, catalogIndex, refreshCatalog, searchCatalog } from './catalog';
import { db } from './db';
import { ensureBusinessRecords, putRecord, settingsOf, type Actor } from './repo';
import { parseCatalogSheet } from '../screens/admin/AdminCatalog';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'B' };

const product = (item: string, brand: string | null, size: number | null, seq: number, extra: Partial<CatalogItemDto> = {}): CatalogItemDto => ({
  id: catalogId('kirana', { item, brand, size, sizeUnit: size ? 'kg' : null }),
  section: 'kirana',
  category: 'Atta & Flour',
  item,
  brand,
  size,
  sizeUnit: size ? 'kg' : null,
  sellUnit: 'pcs',
  hsn: '1101',
  gstPct: 5,
  otherNames: ['आटा'],
  seq,
  ...extra,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  vi.restoreAllMocks();
});

describe('R5 product list on the phone', () => {
  it('downloads only the chosen sections, in pages, and drops removed products', async () => {
    const a = product('Wheat Atta', 'Aashirvaad', 5, 1);
    const b = product('Wheat Atta', 'Aashirvaad', 10, 2);
    const items = vi.spyOn(api, 'catalogItems').mockImplementation(async (_s, since) =>
      since === 0 ? { rows: [a], cursor: 1, more: true } : since === 1 ? { rows: [b], cursor: 2, more: false } : { rows: [{ ...b, deleted: true, seq: 3 }], cursor: 3, more: false },
    );
    vi.spyOn(api, 'catalogAliases').mockResolvedValue({ rows: [{ word: 'ashirwad', means: 'Aashirvaad', seq: 1 }], cursor: 1, more: false });

    expect(await refreshCatalog(true)).toBe(0); // no section chosen: nothing downloaded
    expect(items).not.toHaveBeenCalled();

    await putRecord('settings', owner, { ...(await settingsOf('b1')), catalogSections: ['kirana'] });
    await refreshCatalog(true);
    expect(await db.catalogItems.count()).toBe(2);
    const index = await catalogIndex(['kirana']);
    expect(searchCatalog(index!, 'ashirwad 10').map((e) => e.name)).toEqual(['Aashirvaad Wheat Atta 10 kg']);

    await refreshCatalog(true);
    expect((await db.catalogItems.toArray()).map((r) => r.size)).toEqual([5]);

    // The store stops using the list: the phone frees the space.
    await putRecord('settings', owner, { ...(await settingsOf('b1')), catalogSections: [] });
    await refreshCatalog(true);
    expect(await db.catalogItems.count()).toBe(0);
  });

  it('a picked product becomes a normal item of the shop, in a category of the same name', async () => {
    const row = product('Wheat Atta', 'Aashirvaad', 5, 1, { gstPct: 0 });
    const item = await addItemFromCatalog(owner, row, { rate: 28500, rateIncludesTax: true, defaultTaxPct: 18, units: ['pcs', 'kg'] });
    expect(item).toMatchObject({ name: 'Aashirvaad Wheat Atta 5 kg', unit: 'pcs', hsn: '1101', taxPct: 0, rate: 28500, catalogId: row.id });
    const cat = await db.categories.get(item.categoryId!);
    expect(cat?.name).toBe('Atta & Flour');
    // The same category is reused; staff never create categories.
    const again = await addItemFromCatalog(owner, product('Wheat Atta', null, null, 2), { rate: 4000, rateIncludesTax: true, defaultTaxPct: 18, units: ['pcs'] });
    expect(again.categoryId).toBe(item.categoryId);
    await db.categories.clear();
    const byStaff = await addItemFromCatalog(staff, row, { rate: 1, rateIncludesTax: true, defaultTaxPct: 18, units: ['pcs'] });
    expect(byStaff.categoryId).toBeUndefined();
  });

  it('reads the upload sheet and reports bad rows', () => {
    const head = ['Category', 'Item', 'Brand', 'Size', 'Size unit', 'Sell unit', 'HSN', 'GST %', 'Other names', 'Notes'];
    const { rows, problems } = parseCatalogSheet([
      head,
      ['Atta & Flour', 'Wheat Atta', 'Aashirvaad', 5, 'kg', 'pcs', '1101', 5, 'आटा; ashirwad', ''],
      ['Atta & Flour', 'Wheat Atta', '', '', '', 'kg', '1101', '0', '', 'check GST'],
      ['Atta & Flour', 'Bad', '', '', '', 'kg', '12', 5, '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ brand: 'Aashirvaad', size: 5, sizeUnit: 'kg', otherNames: ['आटा', 'ashirwad'], gstPct: 5 });
    expect(rows[1]).toMatchObject({ brand: null, size: null, gstPct: 0, notes: 'check GST' });
    expect(problems).toEqual(['Row 4 (Bad): HSN must be 4–8 digits']);
    expect(parseCatalogSheet([['Item']]).problems[0]).toContain('Missing columns');
  });
});

describe('starter product lists', () => {
  it('every row loads through the upload code, and common searches find the right products', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { parseCsv } = await import('./importer');
    const { catalogRowBody, buildCatalogIndex, catalogId: idOf } = await import('@invoice/shared');
    const dir = path.resolve(__dirname, '../../../server/catalog/starter');
    const all: CatalogItemDto[] = [];
    for (const section of ['kirana', 'hardware', 'garments'] as const) {
      const { rows, problems } = parseCatalogSheet(parseCsv(fs.readFileSync(path.join(dir, `${section}.csv`), 'utf8')));
      expect(problems).toEqual([]);
      expect(rows.length).toBeGreaterThan(400);
      for (const r of rows) {
        const ok = catalogRowBody.parse(r);
        all.push({ ...ok, id: idOf(section, { item: ok.item, brand: ok.brand ?? null, size: ok.size ?? null, sizeUnit: ok.sizeUnit ?? null }), section, brand: ok.brand ?? null, size: ok.size ?? null, sizeUnit: ok.sizeUnit ?? null, hsn: ok.hsn ?? null, gstPct: ok.gstPct ?? null, seq: 1 });
      }
    }
    const aliases = parseCsv(fs.readFileSync(path.join(dir, 'aliases.csv'), 'utf8')).slice(1).map((r) => ({ word: String(r[0]), means: String(r[1]) }));
    const index = buildCatalogIndex(all, aliases);
    const top = (q: string) => searchCatalog(index, q, 5).map((e) => e.name);
    expect(top('polycab wire 1.5').length).toBeGreaterThan(0);
    expect(top('havells mcb')[0]).toMatch(/MCB/);
    console.log(JSON.stringify({ atta: top('ashirwad atta 5'), oil: top('fortune oil 1'), tel: top('सरसों तेल'), wire: top('polycab wire 1.5'), mcb: top('havells mcb'), shirt: top('mens shirt'), chawal: top('chawal') }, null, 1));
    expect(top('ashirwad atta 5')[0]).toMatch(/Aashirvaad.*Atta 5 kg/);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  });
});

describe('Product list: new shop types', () => {
  it('the starter sheets for fruits & vegetables, acrylic and bakery upload without problems', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseCsv } = await import('./importer');
    for (const name of ['fruits_veg', 'acrylic', 'bakery']) {
      const text = readFileSync(new URL(`../../../server/catalog/starter/${name}.csv`, import.meta.url), 'utf8');
      const { rows, problems } = parseCatalogSheet(parseCsv(text));
      expect(problems).toEqual([]);
      expect(rows.length).toBeGreaterThan(90);
    }
  });
});
