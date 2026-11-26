import 'fake-indexeddb/auto';
import { addDaysISO, todayISO } from '@invoice/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { customerPrice, repriceLines } from './pricing';
import { billMoney, ensureBusinessRecords, newCreditNoteDraft, newInvoiceDraft, putRecord, saveCreditNote, saveInvoice, settingsOf, type Actor } from './repo';
import { DEFAULT_LOYALTY, pointsOf, redeemPoints } from './loyalty';
import { markReminded, remindersDue } from './reminders';
import { parseVcf, priceListTable } from './catalogShare';

export const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
export const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const line = (id: string, name: string, qty: number, rate: number, extra = {}) => ({ id, name, qty, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0, ...extra });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Hotel Raj', phone: '+919876543210', billingAddress: {}, openingBalance: 0, priceLevel: 'wholesale', itemPrices: { tea: 38000 } } as never);
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

describe('R9.2 loyalty points', () => {
  const sell = async (rate: number, date?: string) => {
    const d = await newInvoiceDraft(owner);
    return saveInvoice(owner, { ...d, ...(date ? { date } : {}), billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('x', 'Tea 1kg', 1, rate)] }, { finalize: true });
  };
  it('bills earn points by level, returns take them back, points pay a later bill', async () => {
    const st = await settingsOf('b1');
    await putRecord('settings', owner, { ...st, loyalty: { ...DEFAULT_LOYALTY, enabled: true } });
    const a = await sell(2600000, addDaysISO(todayISO(), -1)); // yesterday, ₹26,000: Silver (nothing before) → 260 points
    expect(a.pointsEarned).toBe(260);
    const b = await sell(100000); // now Gold (₹26,000 in the year) → ₹1,000 × 1.5 = 15
    expect(b.pointsEarned).toBe(15);
    const n = await newCreditNoteDraft(owner, b.id);
    await saveCreditNote(owner, { ...n, reason: 'return' }, { finalize: true });
    expect((await pointsOf('b1', 'c1')).balance).toBe(260 + 15 - 10);
    const c = await sell(50000);
    const used = await redeemPoints(owner, c, 9999, (await settingsOf('b1'))!);
    expect(c.pointsEarned).toBe(7); // Gold: ₹500 → 5 × 1.5
    expect(used).toMatchObject({ mode: 'points', points: 272, amount: 27200 });
    expect((await pointsOf('b1', 'c1')).balance).toBe(0);
    expect((await billMoney(c.id)).pending).toBe(50000 - used!.amount);
    // Walk-ins never earn.
    const w = await newInvoiceDraft(owner);
    expect((await saveInvoice(owner, { ...w, lines: [line('y', 'Tea', 1, 900000)] }, { finalize: true })).pointsEarned).toBeUndefined();
  });
  it('is off by default', async () => {
    expect((await sell(900000)).pointsEarned).toBeUndefined();
  });
});

describe('R9.3 payment reminders', () => {
  it('first reminder after the due date, then every few days, at most a few times', async () => {
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, date: '2026-01-01', dueDate: '2026-01-10', billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('x', 'Tea', 1, 500000)] }, { finalize: true });
    const st = (await settingsOf('b1'))!;
    expect(await remindersDue('b1', st, '2026-01-10')).toHaveLength(0); // not late yet
    let due = await remindersDue('b1', st, '2026-01-11');
    expect(due.map((x) => [x.customer.name, x.overdue, x.daysLate])).toEqual([['Hotel Raj', 500000, 1]]);
    await markReminded(staff, due[0]!.customer, due[0]!.times);
    await db.customers.update('c1', { remindedAt: '2026-01-11T10:00:00.000Z' });
    expect(await remindersDue('b1', st, '2026-01-15')).toHaveLength(0); // within 7 days
    due = await remindersDue('b1', st, '2026-01-18');
    expect(due[0]!.times).toBe(1);
    expect(await remindersDue('b1', { ...st, reminders: { enabled: false } }, '2026-01-18')).toHaveLength(0);
  });
});

describe('R9.5 price list and contacts', () => {
  it('reads Indian mobiles from a .vcf; a price list at the wholesale level', async () => {
    const vcf = `BEGIN:VCARD
VERSION:3.0
FN:Ramesh Kumar
TEL;TYPE=CELL:+91 98765-43210
END:VCARD
BEGIN:VCARD
FN:Office
TEL:022 2345 6789
END:VCARD
BEGIN:VCARD
N:Shah;Neha;;;
TEL:09812345678
EMAIL:neha@example.com
END:VCARD`;
    expect(parseVcf(vcf)).toEqual([
      { name: 'Ramesh Kumar', phone: '+919876543210' },
      { name: 'Neha Shah', phone: '+919812345678', email: 'neha@example.com' },
    ]);
    const tbl = await priceListTable('b1', { level: 'wholesale', storeName: 'Test Co' });
    expect(tbl.rows.map((r) => [r[1], r[3]])).toEqual([['Sugar 1kg', 4600], ['Tea 1kg', 42000]]);
  });
});
