import 'fake-indexeddb/auto';
import { todayISO } from '@invoice/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { applyAdvance, khataOf } from './khata';
import { jobAdvance, releaseAdvance, settleJobAdvance, takeAdvance } from './jobs';
import { billMoney, convertEstimate, ensureBusinessRecords, newEstimateDraft, newInvoiceDraft, PermissionError, putRecord, saveEstimate, saveInvoice, type Actor } from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
const TODAY = todayISO();
const line = (rate: number) => ({ id: 'l', name: 'Sofa', qty: 1, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0 });
const mehta = async () => (await db.customers.get('c1'))!;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Mehta', phone: '+919876543210', billingAddress: {}, openingBalance: 5000 } as Customer);
});

describe('Q2 an estimate advance is for that estimate only', () => {
  const estimate = async () => {
    const d = await newEstimateDraft(owner);
    return saveEstimate(owner, { ...d, billTo: { customerId: 'c1', name: 'Mehta', address: {} }, lines: [line(50000)] }, { finalize: true });
  };

  it('is held, not a general advance, and pays only its own bill', async () => {
    const est = await estimate();
    await takeAdvance(owner, est, { amount: 20000, mode: 'cash', date: TODAY });
    const k = await khataOf('b1', await mehta());
    // It does not settle the opening balance and can't be used on another bill.
    expect(k).toMatchObject({ held: 20000, advance: 0, openingLeft: 5000, balance: -15000 });
    const d = await newInvoiceDraft(owner);
    const other = await saveInvoice(owner, { ...d, billTo: { customerId: 'c1', name: 'Mehta', address: {} }, lines: [line(10000)] }, { finalize: true });
    await applyAdvance(owner, await mehta(), other, 10000);
    expect((await billMoney(other.id)).pending).toBe(10000);
    await expect(applyAdvance(owner, await mehta(), other, 10000, est.id)).rejects.toThrow();
    // Its own bill takes it.
    const bill = await saveInvoice(owner, await convertEstimate(owner, est.id), { finalize: true });
    expect(await settleJobAdvance(owner, bill)).toBe(20000);
    expect((await billMoney(bill.id)).pending).toBe(30000);
    expect((await khataOf('b1', await mehta())).held).toBe(0);
  });

  it('the owner can move it to the customer’s general advance', async () => {
    const est = await estimate();
    await takeAdvance(owner, est, { amount: 20000, mode: 'cash', date: TODAY });
    await expect(releaseAdvance(staff, est)).rejects.toBeInstanceOf(PermissionError);
    expect(await releaseAdvance(owner, est)).toBe(20000);
    expect(await jobAdvance('b1', est.id)).toBe(0);
    const k = await khataOf('b1', await mehta());
    expect(k).toMatchObject({ held: 0, openingLeft: 0, advance: 15000, balance: -15000 });
  });
});
