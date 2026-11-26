import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { customerPrice, repriceLines } from './pricing';
import { ensureBusinessRecords, putRecord, type Actor } from './repo';

export const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
export const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const line = (id: string, name: string, qty: number, rate: number, extra = {}) => ({ id, name, qty, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0, ...extra });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Hotel Raj', phone: '+919876543210', billingAddress: {}, openingBalance: 0, priceLevel: 'wholesale', itemPrices: { tea: 38000 } } as Customer);
  await putRecord('items', owner, { id: 'tea', name: 'Tea 1kg', unit: 'pcs', rate: 45000, prices: { wholesale: 42000 }, taxPct: 5 } as never);
  await putRecord('items', owner, { id: 'sugar', name: 'Sugar 1kg', unit: 'pcs', rate: 5000, prices: { wholesale: 4600 }, taxPct: 5 } as never);
});

describe('R9.1 customer prices', () => {
  it("the customer's own price beats their type's price; other items keep the type's price", async () => {
    const c = (await db.customers.get('c1'))!;
    const tea = (await db.items.get('tea'))!;
    const sugar = (await db.items.get('sugar'))!;
    expect(customerPrice(tea, c.priceLevel, c.itemPrices)).toBe(38000);
    expect(customerPrice(sugar, c.priceLevel, c.itemPrices)).toBe(4600);
    const lines = await repriceLines([line('a', 'Tea 1kg', 2, 45000, { itemId: 'tea' }), line('b', 'Sugar 1kg', 1, 5000, { itemId: 'sugar' })], c.priceLevel!, c.itemPrices);
    expect(lines.map((l) => l.rate)).toEqual([38000, 4600]);
  });
});
