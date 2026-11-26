import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { billFromOrder, openOrders, orderProgress, pendingOrdersTable } from './orders';
import { convertEstimate, ensureBusinessRecords, newEstimateDraft, putRecord, saveEstimate, saveInvoice, type Actor } from './repo';

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
