import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { billFromOrder, openOrders, orderProgress, pendingOrdersTable } from './orders';
import { batchStock, expiryTable, isExpired } from './batches';
import { convertEstimate, ensureBusinessRecords, newEstimateDraft, newInvoiceDraft, putRecord, saveEstimate, saveInvoice, type Actor } from './repo';
import { landedCosts, newPurchaseDraft, recordSupplierPayment, savePurchase, supplierDues } from './purchases';
import { moveBetweenGodowns, stockByPlace } from './godowns';
import { stockLevels } from './stock';
import { billConsignment, consignmentProgress, takeBackConsignment } from './consignment';
import { DEFAULT_SCALE, ean13Check, parseScaleBarcode, scaleQty } from './scale';
import { transfersOf } from './transfers';

export const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
export const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const line = (id: string, name: string, qty: number, rate: number, extra = {}) => ({ id, name, qty, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0, ...extra });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Hotel Raj', phone: '+919876543210', billingAddress: {}, openingBalance: 0 } as Customer);
});

describe('R8.1 sales orders and proforma', () => {
  const order = async () => {
    const d = await newEstimateDraft(owner);
    return saveEstimate(owner, { ...d, order: true, billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('a', 'Chair', 10, 100000), line('b', 'Table', 2, 500000)] }, { finalize: true });
  };

  it('an order has its own SO series and is billed in parts', async () => {
    const so = await order();
    expect(so.number).toMatch(/^SO/);
    // First delivery: 6 chairs only.
    const draft = await billFromOrder(owner, so.id);
    expect(draft.lines.map((l) => [l.name, l.qty])).toEqual([['Chair', 10], ['Table', 2]]);
    await saveInvoice(owner, { ...draft, lines: [{ ...draft.lines[0]!, qty: 6 }] }, { finalize: true });
    let p = await orderProgress((await db.estimates.get(so.id))!);
    expect(p.state).toBe('part');
    expect(p.lines.map((l) => l.pending)).toEqual([4, 2]);
    expect(p.pendingValue).toBe(4 * 100000 + 2 * 500000);
    expect((await pendingOrdersTable('b1')).rows).toHaveLength(2);
    // The rest, through "Make bill" (convertEstimate sends orders here too).
    const rest = await convertEstimate(owner, so.id);
    expect(rest.lines.map((l) => [l.name, l.qty])).toEqual([['Chair', 4], ['Table', 2]]);
    await saveInvoice(owner, rest, { finalize: true });
    p = await orderProgress((await db.estimates.get(so.id))!);
    expect(p.state).toBe('done');
    expect(await openOrders('b1')).toHaveLength(0);
    await expect(billFromOrder(owner, so.id)).rejects.toThrow();
  });

  it('a proforma invoice has its own PI series and converts like an estimate', async () => {
    const d = await newEstimateDraft(owner);
    const pi = await saveEstimate(owner, { ...d, proforma: true, lines: [line('a', 'Sofa', 1, 2500000)] }, { finalize: true });
    expect(pi.number).toMatch(/^PI/);
    const inv = await convertEstimate(owner, pi.id);
    expect(inv.fromEstimateId).toBe(pi.id);
    expect((await db.estimates.get(pi.id))!.status).toBe('converted');
  });
});

describe('R8.2 batch and expiry', () => {
  it('purchases add batches; a sale takes the one expiring first; the expiry report lists them', async () => {
    await putRecord('items', owner, { id: 'm1', name: 'Crocin 500', unit: 'strip', rate: 3000, purchasePrice: 2000, taxPct: 12, rateIncludesTax: true, trackBatch: true } as never);
    const d = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...d, lines: [line('p1', 'Crocin 500', 10, 2000, { itemId: 'm1', batch: 'B2', expiry: '2099-12' }), line('p2', 'Crocin 500', 5, 2000, { itemId: 'm1', batch: 'B1', expiry: '2099-03' })] } as never, { finalize: true });
    expect((await batchStock('b1', 'm1')).map((b) => [b.batch, b.qty])).toEqual([['B1', 5], ['B2', 10]]);
    const inv = await newInvoiceDraft(owner);
    const sale = await saveInvoice(owner, { ...inv, lines: [line('s1', 'Crocin 500', 2, 3000, { itemId: 'm1' })] }, { finalize: true });
    expect(sale.lines[0]).toMatchObject({ batch: 'B1', expiry: '2099-03' });
    expect((await batchStock('b1', 'm1')).map((b) => [b.batch, b.qty])).toEqual([['B1', 3], ['B2', 10]]);
    expect(isExpired('2020-01')).toBe(true);
    expect((await expiryTable('b1', 3)).rows).toHaveLength(0);
    expect((await expiryTable('b1', 2000)).rows).toHaveLength(2);
  });
});

describe('R8.3 godowns', () => {
  it('goods arrive at a godown, move to the shop, leave from the shop; the store total is unchanged by moves', async () => {
    await putRecord('items', owner, { id: 'i1', name: 'Cement bag', unit: 'bag', rate: 40000, taxPct: 28, rateIncludesTax: true } as never);
    const d = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...d, godownId: 'g1', lines: [line('p1', 'Cement bag', 100, 35000, { itemId: 'i1' })] } as never, { finalize: true });
    await moveBetweenGodowns(staff, 'g1', '', [{ item: { id: 'i1', name: 'Cement bag' }, qty: 30 }]);
    const inv = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...inv, lines: [line('s1', 'Cement bag', 10, 40000, { itemId: 'i1' })] }, { finalize: true });
    const at = (await stockByPlace('b1')).get('i1')!;
    expect([at.get('g1'), at.get('')]).toEqual([70, 20]);
    expect((await stockLevels('b1')).get('i1')).toBe(90);
    expect(await transfersOf('b1')).toHaveLength(0); // not a transfer between stores
    await expect(moveBetweenGodowns(owner, 'g1', 'g1', [{ item: { id: 'i1', name: 'Cement bag' }, qty: 1 }])).rejects.toThrow();
  });
});

describe('R8.4 freight into cost, bills to pay', () => {
  it('charges are shared into item cost by value; dues settle oldest first', async () => {
    await putRecord('items', owner, { id: 'a', name: 'Fan', unit: 'pcs', rate: 300000, purchasePrice: 0, taxPct: 0 } as never);
    await putRecord('items', owner, { id: 'b', name: 'Bulb', unit: 'pcs', rate: 20000, purchasePrice: 0, taxPct: 0 } as never);
    await putRecord('suppliers', owner, { id: 's1', name: 'Bajaj Dist', address: {}, openingBalance: 0, creditDays: 15 } as never);
    const d = await newPurchaseDraft(owner);
    const bill = { ...d, supplier: { supplierId: 's1', name: 'Bajaj Dist' }, date: '2026-01-01', dueDate: '2026-01-16', lines: [line('l1', 'Fan', 10, 200000, { itemId: 'a' }), line('l2', 'Bulb', 100, 10000, { itemId: 'b' })], charges: [{ label: 'Freight', amount: 30000, taxPct: 0 }] } as never;
    // Fans 20,00,000 and bulbs 10,00,000 of 30,00,000: freight 300 splits 200 / 100.
    expect(landedCosts(bill)).toEqual([202000, 10100]);
    expect(landedCosts({ ...(bill as object), spreadCharges: false } as never)).toEqual([200000, 10000]);
    await savePurchase(owner, bill, { finalize: true });
    expect((await db.items.get('a'))!.purchasePrice).toBe(202000);
    const d2 = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...d2, supplier: { supplierId: 's1', name: 'Bajaj Dist' }, date: '2026-01-10', dueDate: '2026-01-25', lines: [line('l3', 'Bulb', 10, 10000, { itemId: 'b' })] } as never, { finalize: true });
    await recordSupplierPayment(owner, { supplierId: 's1', amount: 1000000, mode: 'bank', date: '2026-01-05' } as never);
    const dues = await supplierDues('b1', '2026-01-20');
    expect(dues.map((x) => [x.dueDate, x.unpaid, x.daysLate])).toEqual([
      ['2026-01-16', 3030000 - 1000000, 4],
      ['2026-01-25', 100000, -5],
    ]);
  });
});

describe('R8.5 weighing-scale barcodes', () => {
  it('reads PLU and weight or price from a scale label', () => {
    const on = { ...DEFAULT_SCALE, enabled: true };
    const d12 = '2001234' + '01250';
    const code = d12 + ean13Check(d12);
    expect(parseScaleBarcode(code, on)).toEqual({ plu: '1234', grams: 1250 });
    expect(parseScaleBarcode(code, DEFAULT_SCALE)).toBeNull(); // switched off
    expect(parseScaleBarcode(d12 + ((ean13Check(d12) + 1) % 10), on)).toBeNull(); // bad check digit
    expect(scaleQty({ unit: 'kg', rate: 4000 }, { grams: 1250 })).toBe(1.25);
    expect(scaleQty({ unit: 'g', rate: 40 }, { grams: 250 })).toBe(250);
    expect(scaleQty({ unit: 'kg', rate: 40000 }, { paise: 50000 })).toBe(1.25);
  });
});

describe('R8.6 sale or return', () => {
  it('goods leave on the challan, sold ones are billed without moving stock again, the rest come back', async () => {
    await putRecord('items', owner, { id: 'k', name: 'Kurti', unit: 'pcs', rate: 80000, taxPct: 5 } as never);
    const d = await newEstimateDraft(owner);
    const dc = await saveEstimate(owner, { ...d, challan: true, consignment: true, billTo: { customerId: 'c1', name: 'Hotel Raj', address: {} }, lines: [line('a', 'Kurti', 20, 80000, { itemId: 'k' })] }, { finalize: true });
    expect(dc.number).toMatch(/^DC/);
    expect((await stockLevels('b1')).get('k')).toBe(-20);
    const bill = await billConsignment(owner, dc.id);
    await saveInvoice(owner, { ...bill, lines: [{ ...bill.lines[0]!, qty: 12 }] }, { finalize: true });
    expect((await stockLevels('b1')).get('k')).toBe(-20);
    await takeBackConsignment(staff, dc.id, { a: 5 });
    let p = await consignmentProgress((await db.estimates.get(dc.id))!);
    expect(p.lines[0]).toMatchObject({ sent: 20, sold: 12, returned: 5, out: 3 });
    expect((await stockLevels('b1')).get('k')).toBe(-15);
    await takeBackConsignment(staff, dc.id, { a: 99 }); // never more than is out
    p = await consignmentProgress((await db.estimates.get(dc.id))!);
    expect(p.settled).toBe(true);
    expect((await stockLevels('b1')).get('k')).toBe(-12);
  });
});
