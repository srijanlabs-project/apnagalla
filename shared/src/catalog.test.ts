import { describe, expect, it } from 'vitest';
import { buildCatalogIndex, catalogId, catalogName, searchCatalog, type CatalogItemDto } from './catalog';

const row = (item: string, brand: string | null, size: number | null, sizeUnit: string | null, extra: Partial<CatalogItemDto> = {}): CatalogItemDto => ({
  id: catalogId('kirana', { item, brand, size, sizeUnit }),
  section: 'kirana',
  category: 'Staples',
  item,
  brand,
  size,
  sizeUnit,
  sellUnit: 'pcs',
  hsn: '1101',
  gstPct: 5,
  otherNames: [],
  seq: 1,
  ...extra,
});

const rows = [
  row('Wheat Atta', 'Aashirvaad', 5, 'kg', { otherNames: ['आटा', 'gehun atta', 'ashirwad'] }),
  row('Wheat Atta', 'Aashirvaad', 10, 'kg', { otherNames: ['आटा'] }),
  row('Wheat Atta', null, null, null, { sellUnit: 'kg', otherNames: ['आटा'] }),
  row('Soyabean Oil', 'Fortune', 1, 'L', { category: 'Edible Oil', otherNames: ['तेल'] }),
  row('Sunflower Oil', 'Fortune', 1, 'L', { category: 'Edible Oil' }),
  row('Sunflower Oil', 'Fortune', 5, 'L', { category: 'Edible Oil' }),
  row('Mustard Oil', 'Fortune', 500, 'ml', { category: 'Edible Oil' }),
];
const index = buildCatalogIndex(rows, [{ word: 'tel', means: 'Oil' }, { word: 'chawal', means: 'Rice' }]);
const names = (q: string) => searchCatalog(index, q).map((e) => e.name);

describe('product list search', () => {
  it('names and ids', () => {
    expect(catalogName(rows[0]!)).toBe('Aashirvaad Wheat Atta 5 kg');
    expect(catalogName(rows[2]!)).toBe('Wheat Atta');
    expect(catalogId('kirana', { item: 'Wheat  Atta', brand: 'AASHIRVAAD', size: 5, sizeUnit: 'kg' })).toBe(rows[0]!.id);
  });

  it('brand + item + size', () => {
    expect(names('fortune oil 1')).toEqual(expect.arrayContaining(['Fortune Soyabean Oil 1 L', 'Fortune Sunflower Oil 1 L']));
    expect(names('fortune oil 1')).not.toContain('Fortune Sunflower Oil 5 L');
    expect(names('fortune sunflower 5l')).toEqual(['Fortune Sunflower Oil 5 L']);
    expect(names('mustard 500ml')).toEqual(['Fortune Mustard Oil 500 ml']);
  });

  it('spelling mistakes, other names and aliases', () => {
    expect(names('ashirwad atta 5')[0]).toBe('Aashirvaad Wheat Atta 5 kg');
    expect(names('aashirvad atta')).toHaveLength(2);
    expect(names('आटा')).toHaveLength(3);
    expect(names('fortune tel')).toHaveLength(4);
    expect(names('sunflowr')).toHaveLength(2);
    expect(names('xyz')).toEqual([]);
  });
});
