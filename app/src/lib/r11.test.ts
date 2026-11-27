import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { qtyForAmount, rateCardText, saveRates, saveWastage, wastageTable } from './fresh';
import { ensureBusinessRecords, newEstimateDraft, newInvoiceDraft, putRecord, saveEstimate, saveInvoice, type Actor } from './repo';
import { addMonthsISO, billChallans, crateBalances, instalmentSchedule, saveCrates, unbilledChallans } from './shopKinds';
import { setStoreManagesStock, stockLevels, tracksStock } from './stock';
import { transferStock } from './transfers';
import { stockByPlace } from './godowns';
import { indianMobile } from './phoneContacts';
import { bookedQty } from './orders';
import { trialBalance } from './books';
import { billMoney, recordPayments } from './repo';
import { sitesOf } from './shopKinds';
import { festivalTable, payWithVoucher, rentalDays, returnRental, schemeProgress, sellVoucher, startRental, unitsForArea, voucherLeft } from './retailExtras';
import { matchOrderLines } from './messageOrder';
import { jewelPrice, jewelText, oldMetalValue, produce, recipeCost, saveRecipe, scheduleRegister } from './modules';
import { newPurchaseDraft, savePurchase } from './purchases';
import { khataOf } from './khata';

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

describe('R11.2 furniture and contractors', () => {
  it('open orders book stock; an old item taken back pays part of the bill; bills by site', async () => {
    await putRecord('items', owner, { id: 'sofa', name: 'Sofa', unit: 'pcs', rate: 3000000, purchasePrice: 2000000, taxPct: 0, rateIncludesTax: true } as never);
    const e = await newEstimateDraft(owner);
    await saveEstimate(owner, { ...e, order: true, billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('o', 'Sofa', 2, 3000000, { itemId: 'sofa', unit: 'pcs' })] }, { finalize: true });
    expect((await bookedQty('b1')).get('sofa')).toBe(2);
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, date: D, site: 'Sharma house', billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('a', 'Sofa', 1, 3000000, { itemId: 'sofa', unit: 'pcs' })] }, { finalize: true });
    await recordPayments(owner, inv.id, [{ mode: 'buyback', amount: 500000, note: 'Old sofa' }], { date: D });
    expect((await billMoney(inv.id)).pending).toBe(2500000);
    const tb = await trialBalance('b1', D);
    expect(tb.find((b) => b.info.key === 'purchases')!.balance).toBe(500000);
    expect(tb.reduce((a, b) => a + b.balance, 0)).toBe(0);
    expect((await sitesOf('b1', 'c1')).map((x) => [x.site, x.pending])).toEqual([['Sharma house', 2500000]]);
  });
});

describe('R11.3 most shops', () => {
  it('scheme progress from purchases; vouchers sold and used; books still tally', async () => {
    await putRecord('suppliers', owner, { id: 's1', name: 'HUL', address: {}, openingBalance: 0 } as never);
    await putRecord('schemes', owner, { id: 'sc', supplierId: 's1', supplierName: 'HUL', name: 'Diwali', from: '2026-11-01', to: '2026-11-30', basis: 'value', target: 1000000, reward: '1 carton free' } as never);
    const pd = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...pd, date: D, supplier: { supplierId: 's1', name: 'HUL' }, lines: [line('p', 'Soap', 100, 6000, { unit: 'pcs' })] } as never, { finalize: true });
    const [p] = await schemeProgress('b1', D);
    expect([p!.done, p!.pct, p!.reached, p!.daysLeft]).toEqual([600000, 60, false, 10]);

    const v = await sellVoucher(staff, { amount: 100000, mode: 'cash' });
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, date: D, lines: [line('a', 'Tomato', 10, 3600, { itemId: 'tom' })] }, { finalize: true });
    await payWithVoucher(owner, inv, v.code.toLowerCase(), 36000, D);
    expect((await voucherLeft('b1', v.code))!.left).toBe(64000);
    await expect(payWithVoucher(owner, inv, 'GV000000', 1000, D)).rejects.toThrow();
    const tb = await trialBalance('b1', '2026-12-31');
    expect(tb.find((b) => b.info.key === 'vouchers')!.balance).toBe(-64000);
    expect(tb.reduce((a, b) => a + b.balance, 0)).toBe(0);
  });

  it('rentals: deposit on account, rent bill on return; festival reorder; area to boxes; message lines matched', async () => {
    const c = (await db.customers.get('c1'))!;
    const r = await startRental(staff, c, { lines: [{ name: 'Chair', qty: 50, ratePerDay: 1000 }], dueBack: '2026-11-22', deposit: 200000, depositMode: 'cash' }, '2026-11-20');
    expect((await khataOf('b1', c)).advance).toBe(200000);
    expect(rentalDays(r, '2026-11-23')).toBe(3);
    const bill = await returnRental(owner, r, { late: 20000 }, '2026-11-23');
    expect(bill.lines.map((l) => [l.qty, l.rate])).toEqual([[50, 3000], [1, 20000]]);
    expect((await db.rentals.get(r.id))!.status).toBe('returned');

    const last = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...last, date: '2025-11-25', lines: [line('a', 'Tomato', 40, 3600, { itemId: 'tom' })] }, { finalize: true });
    expect((await festivalTable('b1', '2026-11-20')).rows).toEqual([['Tomato', 40, -40, 80, 'kg']]);

    expect(unitsForArea(120, 15, 1, 5)).toBe(8.4);
    expect(unitsForArea(400, 120, 2)).toBe(6.67);

    const items = [(await db.items.get('tom'))!, { ...(await db.items.get('tom'))!, id: 'pot', name: 'Potato' }];
    const m = matchOrderLines([{ name: 'Tomato', qty: 2, unit: 'kg' }, { name: 'potatoes', qty: 1, unit: 'kg' }, { name: 'Maggi', qty: 4, unit: 'pcs' }], items);
    expect(m.map((x) => x.item?.id ?? null)).toEqual(['tom', 'pot', null]);
  });
});

describe('R11.4 trade modules', () => {
  const rates = { gold24: 700000, silver999: 9000 };
  it('jewellery: price from weight, purity, wastage, making and stones; old gold value', () => {
    const j = { metal: 'gold' as const, weight: 10, purity: 22, making: 12, makingType: 'pct' as const, wastagePct: 8, stones: 150000 };
    // Metal: 10.8 g × 22/24 × ₹7,000 = ₹69,300; making 12% = ₹8,316; stones ₹1,500.
    expect(jewelPrice(j, rates)).toEqual({ metal: 6930000, making: 831600, total: 7911600 });
    expect(jewelPrice({ ...j, makingType: 'perGram', making: 50000, wastagePct: 0, stones: 0 }, rates).making).toBe(500000);
    expect(jewelText({ jewel: j })).toBe('Gold 22K 10.000 g · wastage 8% · making 12% · stones ₹1500.00');
    // 10 g of 22K at ₹7,000 (24K) less 2% = ₹62,883.
    expect(oldMetalValue('gold', 10, 22, 2, rates)).toBe(6288333);
  });

  it('recipes: making adds the product and uses the raw material; cost per piece', async () => {
    await putRecord('items', owner, { id: 'maida', name: 'Maida', unit: 'kg', rate: 0, purchasePrice: 4000, taxPct: 0 } as never);
    await putRecord('items', owner, { id: 'ghee', name: 'Ghee', unit: 'kg', rate: 0, purchasePrice: 60000, taxPct: 0 } as never);
    await putRecord('items', owner, { id: 'nk', name: 'Nankhatai', unit: 'pcs', rate: 1000, taxPct: 5 } as never);
    await expect(saveRecipe(staff, { id: 'r', itemId: 'nk', itemName: 'Nankhatai', yieldQty: 100, inputs: [] })).rejects.toThrow();
    const r = await saveRecipe(owner, { id: 'r', itemId: 'nk', itemName: 'Nankhatai', yieldQty: 100, inputs: [{ itemId: 'maida', name: 'Maida', qty: 2 }, { itemId: 'ghee', name: 'Ghee', qty: 1 }] });
    expect(await recipeCost(r)).toBe(680);
    const { used } = await produce(staff, r, 50, D);
    expect(used).toEqual([{ name: 'Maida', qty: 1, short: true }, { name: 'Ghee', qty: 0.5, short: true }]);
    const lv = await stockLevels('b1');
    expect([lv.get('nk'), lv.get('maida'), lv.get('ghee')]).toEqual([50, -1, -0.5]);
  });

  it('pharmacy: scheduled drugs go in the register with the prescription', async () => {
    await putRecord('items', owner, { id: 'az', name: 'Azithromycin 500', unit: 'strip', rate: 12000, taxPct: 12, schedule: 'H1' } as never);
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, date: D, rx: { patient: 'R. Kumar', doctor: 'Dr Mehta', number: 'RX-9' }, lines: [line('a', 'Azithromycin 500', 1, 12000, { itemId: 'az', unit: 'strip', batch: 'B7' }), line('b', 'Tomato', 1, 3600, { itemId: 'tom' })] }, { finalize: true });
    expect((await scheduleRegister('b1', D, D)).rows.map((r) => [r[2], r[3], r[4], r[6], r[7]])).toEqual([['H1', 'Azithromycin 500', 'B7', 'R. Kumar', 'Dr Mehta']]);
  });
});

describe('27 Nov fixes', () => {
  it('stock moves from a godown of one store to a godown of another', async () => {
    const d = await newInvoiceDraft(owner);
    void d;
    await putRecord('stockMoves', owner, { id: 'o1', itemId: 'tom', itemName: 'Tomato', qty: 50, kind: 'opening', reason: 'opening', date: D, godownId: 'g1' } as never);
    await transferStock(owner, { businessId: 'b2', name: 'Branch', isOwner: true }, 'Test Co', [{ itemId: 'tom', qty: 20 }], { fromGodown: 'g1', toGodown: 'g9' });
    expect((await stockByPlace('b1')).get('tom')!.get('g1')).toBe(30);
    const there = (await db.items.where('businessId').equals('b2').toArray())[0]!;
    expect((await stockByPlace('b2')).get(there.id)!.get('g9')).toBe(20);
  });

  it('a store that does not manage stock tracks no item; phone numbers read in any form', () => {
    const item = { trackStock: true, pricing: 'unit' as const };
    expect(tracksStock(item)).toBe(true);
    setStoreManagesStock(false);
    expect(tracksStock(item)).toBe(false);
    setStoreManagesStock(true);
    expect([indianMobile('+91 98765-43210'), indianMobile('098765 43210'), indianMobile('022 2345 6789')]).toEqual(['+919876543210', '+919876543210', null]);
  });
});
