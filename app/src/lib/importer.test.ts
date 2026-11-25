import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { flattenCategories } from './categories';
import { db } from './db';
import { applyImport, buildPreview, parseCsv, signedMoney, templateCsv } from './importer';
import { stockLevels } from './stock';
import { ensureBusinessRecords, putRecord, type Actor } from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u1', userName: 'Owner', role: 'owner' };
const defaults = { unit: 'pcs', taxPct: 18 };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
});

describe('CSV', () => {
  it('reads quotes, commas inside quotes, semicolons and the template', () => {
    expect(parseCsv('Name,Price\r\n"Tin, 1L",450\n"Say ""hi""",10\n\n')).toEqual([
      ['Name', 'Price'],
      ['Tin, 1L', '450'],
      ['Say "hi"', '10'],
    ]);
    expect(parseCsv('Name;Price\nA;1')).toEqual([
      ['Name', 'Price'],
      ['A', '1'],
    ]);
    expect(parseCsv(templateCsv('items'))[0]![0]).toBe('Name');
  });
});

describe('items import', () => {
  it('finds columns by any common heading, checks rows, and matches by barcode, code or name', async () => {
    await putRecord('items', owner, { id: 'old', name: 'Primer 1L', unit: 'pcs', rate: 20000, rateIncludesTax: false, taxPct: 18, code: 'PR-1' });
    const rows = parseCsv(
      [
        'Item Name,Selling Price,GST %,HSN Code,Category,SKU,Barcode,MRP,Cost Price,Unknown',
        'Apex 20L,4500,18%,3209,Paints > Exterior,AP-20,890123,5600,3900,x',
        'Primer one litre,210,18,3209,Paints,PR-1,,,,',
        'Bad row,abc,,32,,,,,,',
        ',100,,,,,,,,',
      ].join('\n'),
    );
    const p = buildPreview('items', rows, await db.items.toArray());
    expect(p.ignored).toEqual(['Unknown']);
    expect(p.missing).toEqual([]);
    expect(p.rows[0]).toMatchObject({ name: 'Apex 20L', errors: [], categoryPath: 'Paints > Exterior', values: { rate: 450000, taxPct: 18, hsn: '3209', code: 'AP-20', barcode: '890123', mrp: 560000, purchasePrice: 390000 } });
    expect(p.rows[1]!.match?.id).toBe('old'); // same item code
    expect(p.rows[2]!.errors).toEqual(['Price is missing or not a number', 'HSN "32" should be 4, 6 or 8 digits']);
    expect(p.rows[3]!.errors).toContain('Name is missing');

    const r = await applyImport(owner, p, 'update', defaults);
    expect(r).toEqual({ added: 1, updated: 1, skipped: 0, failed: 2 });
    const items = await db.items.toArray();
    expect(items.find((i) => i.id === 'old')).toMatchObject({ name: 'Primer one litre', rate: 21000, code: 'PR-1' });
    const apex = items.find((i) => i.name === 'Apex 20L')!;
    const paths = flattenCategories(await db.categories.toArray()).map((n) => n.path);
    expect(paths).toEqual(['Paints', 'Paints › Exterior']);
    expect(apex.categoryId).toBe((await db.categories.toArray()).find((c) => c.name === 'Exterior')!.id);
  });

  it('skips matching items when asked, and says when a required column is missing', async () => {
    await putRecord('items', owner, { id: 'old', name: 'Primer 1L', unit: 'pcs', rate: 20000, rateIncludesTax: false, taxPct: 18 });
    const p = buildPreview('items', parseCsv('Name,Price\nprimer 1l,999\nNew one,10'), await db.items.toArray());
    expect(await applyImport(owner, p, 'skip', defaults)).toEqual({ added: 1, updated: 0, skipped: 1, failed: 0 });
    expect((await db.items.get('old'))!.rate).toBe(20000);
    expect(buildPreview('items', parseCsv('Name,Qty\nA,1'), []).missing).toEqual(['Price']);
  });
});

describe('customers import', () => {
  it('checks mobile and GSTIN, fills the state from the GSTIN, matches by mobile', async () => {
    await putRecord('customers', owner, { id: 'c1', name: 'Old name', phone: '+919876543210', billingAddress: { city: 'Surat' }, openingBalance: 0 });
    const p = buildPreview(
      'customers',
      parseCsv(['Party Name,Mobile No,GST No,City,Opening Balance', 'Patel Traders,98765 43210,24AABCP1234K1ZP,Ahmedabad,1500', 'Bad,123,24AABCP1234K1ZQ,,'].join('\n')),
      await db.customers.toArray(),
    );
    expect(p.rows[0]).toMatchObject({ errors: [], values: { phone: '+919876543210', taxId: '24AABCP1234K1ZP', openingBalance: 150000, billingAddress: { city: 'Ahmedabad', state: 'Gujarat' } } });
    expect(p.rows[0]!.match?.id).toBe('c1');
    expect(p.rows[1]!.errors.length).toBe(2);
    await applyImport(owner, p, 'update', defaults);
    expect(await db.customers.get('c1')).toMatchObject({ name: 'Patel Traders', billingAddress: { city: 'Ahmedabad', state: 'Gujarat' } });
  });
});

describe('switching from Vyapar / Khatabook', () => {
  it('reads balances written as Dr / Cr, brackets and minus signs', () => {
    expect(signedMoney('1,200.50 Dr')).toBe(120050);
    expect(signedMoney('₹ 800 Cr')).toBe(-80000);
    expect(signedMoney('(250)')).toBe(-25000);
    expect(signedMoney('-75')).toBe(-7500);
    expect(signedMoney(42)).toBe(4200);
    expect(signedMoney('')).toBeNull();
    expect(signedMoney('abc')).toBe('bad');
  });

  it('imports a Vyapar item export with opening stock', async () => {
    const rows = [
      ['Item Name', 'Item Code', 'HSN', 'Sale Price', 'Purchase Price', 'Tax Rate', 'Opening Stock Quantity', 'Minimum Stock Quantity', 'Item Category'],
      ['Fevicol 1kg', 'FV1', '3506', '450', '380', '18', '12', '3', 'Adhesives'],
    ];
    const preview = buildPreview('items', rows, []);
    expect(preview.missing).toEqual([]);
    await applyImport(owner, preview, 'skip', defaults);
    const item = (await db.items.toArray())[0]!;
    expect(item).toMatchObject({ name: 'Fevicol 1kg', code: 'FV1', rate: 45000, purchasePrice: 38000, taxPct: 18, lowStock: 3 });
    expect((await stockLevels('b1')).get(item.id)).toBe(12);
  });

  it('imports Khatabook customers (you will get / give) and suppliers', async () => {
    const customers = [
      ['Name', 'Phone Number', "You'll Get", "You'll Give"],
      ['Ramesh', '9876543210', '1,500', ''],
      ['Suresh', '9876543211', '', '200'],
    ];
    await applyImport(owner, buildPreview('customers', customers, []), 'skip', defaults);
    const list = (await db.customers.toArray()).sort((a, b) => a.name.localeCompare(b.name));
    expect(list.map((c) => [c.name, c.openingBalance])).toEqual([
      ['Ramesh', 150000],
      ['Suresh', -20000],
    ]);
    const suppliers = [
      ['Party Name', 'Contact No.', 'GSTIN', 'Payable Balance'],
      ['Shree Traders', '9876500000', '27AAPFU0939F1ZV', '12,000.00'],
    ];
    await applyImport(owner, buildPreview('suppliers', suppliers, []), 'skip', defaults);
    const s = (await db.suppliers.toArray())[0]!;
    expect(s).toMatchObject({ name: 'Shree Traders', taxId: '27AAPFU0939F1ZV', openingBalance: 1200000 });
  });
});

