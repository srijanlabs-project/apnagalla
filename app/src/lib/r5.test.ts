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
