import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { qtyForAmount, rateCardText, saveRates, saveWastage, wastageTable } from './fresh';
import { ensureBusinessRecords, newEstimateDraft, newInvoiceDraft, putRecord, saveEstimate, saveInvoice, type Actor } from './repo';
import { addMonthsISO, billChallans, crateBalances, instalmentSchedule, saveCrates, unbilledChallans } from './shopKinds';
import { stockLevels } from './stock';

export const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
export const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const line = (id: string, name: string, qty: number, rate: number, extra = {}) => ({ id, name, qty, unit: 'kg', rate, rateIncludesTax: true, taxPct: 0, ...extra });
const D = '2026-11-20';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Hotel Raj', billingAddress: {}, openingBalance: 0 } as never);
  await putRecord('items', owner, { id: 'tom', name: 'Tomato', unit: 'kg', rate: 4000, purchasePrice: 2500, taxPct: 0, rateIncludesTax: true } as never);
});

describe('R11.1 fruit and vegetable', () => {
  it('rates, rate card, sell by amount, wastage and margin after it', async () => {
    expect(await saveRates(staff, [{ item: (await db.items.get('tom'))!, rate: 3600 }])).toBe(1);
    const tom = (await db.items.get('tom'))!;
    expect(tom.rate).toBe(3600);
    expect(tom.priceHistory?.[0]).toMatchObject({ from: 4000, to: 3600 });
    expect(rateCardText('Fresh', [tom], D)).toContain('Tomato: ₹36/kg');
    expect(qtyForAmount(2000, 3600)).toBe(0.556);
    expect(qtyForAmount(1050, 1000, 5, false)).toBe(1);
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, date: D, lines: [line('a', 'Tomato', 9, 3600, { itemId: 'tom' })] }, { finalize: true });
    await saveWastage(staff, [{ item: tom, qty: 1 }], D);
    const w = await wastageTable('b1', D, D);
    // 9 sold, 1 wasted = 10%; waste cost ₹25; margin (9 × 36 − 9 × 25) − 25 = ₹74.
    expect(w.rows[0]).toEqual(['Tomato', 9, 1, 'kg', '10%', 2500, 7400]);
  });

  it('crates with a party; one bill for a week of challans without taking stock twice', async () => {
    await saveCrates(staff, { partyType: 'customer', partyId: 'c1', partyName: 'Hotel Raj', kind: 'Crate', date: D, out: 10, back: 3, deposit: 5000 });
    expect(await crateBalances('b1')).toEqual([{ partyId: 'c1', partyName: 'Hotel Raj', partyType: 'customer', kind: 'Crate', out: 7, deposit: 5000 }]);
    for (const day of ['2026-11-18', '2026-11-19']) {
      const e = await newEstimateDraft(owner);
      await saveEstimate(owner, { ...e, date: day, challan: true, billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('l', 'Tomato', 5, 3600, { itemId: 'tom' })] }, { finalize: true });
    }
    expect(await unbilledChallans('b1', 'c1')).toHaveLength(2);
    expect((await stockLevels('b1')).get('tom')).toBe(-10);
    const bill = await billChallans(owner, (await unbilledChallans('b1', 'c1')).map((c) => c.id));
    expect(bill.lines).toHaveLength(2);
    await saveInvoice(owner, bill, { finalize: true });
    expect((await stockLevels('b1')).get('tom')).toBe(-10);
    expect(await unbilledChallans('b1', 'c1')).toHaveLength(0);
  });
});

describe('R11.2 instalments', () => {
  it('splits the rest after the down payment; payments fill them in order', () => {
    const inv = { totals: { grandTotal: 3000000 } as never, instalments: { count: 3, every: 'month' as const, first: '2026-12-05', downPayment: 600000 } };
    const s = instalmentSchedule(inv, 600000 + 1000000, '2027-01-10');
    expect(s.map((i) => [i.due, i.amount, i.paid, i.state])).toEqual([
      ['2026-12-05', 800000, 800000, 'paid'],
      ['2027-01-05', 800000, 200000, 'part'],
      ['2027-02-05', 800000, 0, 'due'],
    ]);
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28');
  });
});
