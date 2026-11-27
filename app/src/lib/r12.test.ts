import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { cashDay, openDay } from './cashbook';
import { db } from './db';
import { dayOpened, dayToClose, openingDue } from './dayEnd';
import { ensureBusinessRecords, newInvoiceDraft, putRecord, recordPayments, saveInvoice, type Actor } from './repo';
import { payWithVoucher, sellVoucher, usableVoucher, voucherLeft } from './retailExtras';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const D = '2026-11-20';
const line = (id: string, qty: number, rate: number) => ({ id, name: 'Tomato', qty, unit: 'kg', rate, rateIncludesTax: true, taxPct: 0 });

async function bill(amount: number) {
  const d = await newInvoiceDraft(owner);
  return saveInvoice(owner, { ...d, date: D, billTo: { customerId: 'c1', name: 'Raj', address: {} }, lines: [line('a', 1, amount)] }, { finalize: true });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Raj', billingAddress: {}, openingBalance: 0 } as never);
});

describe('Cash handed over', () => {
  it('keeps what the customer gave and the change, while the bill gets only its amount', async () => {
    const inv = await bill(54280);
    const [p] = await recordPayments(owner, inv.id, [{ mode: 'cash', amount: 54280, cashGot: 55000 }], { date: D });
    expect(p).toMatchObject({ amount: 54280, cashGot: 55000 });
    // UPI never keeps a cash-handed-over figure.
    const inv2 = await bill(1000);
    const [q] = await recordPayments(owner, inv2.id, [{ mode: 'upi', amount: 1000, cashGot: 2000 }], { date: D });
    expect(q!.cashGot).toBeUndefined();
  });
});

describe('Gift vouchers', () => {
  it('never pays more than the voucher; many-use runs down across bills', async () => {
    const v = await sellVoucher(owner, { amount: 50000, mode: 'cash' });
    await payWithVoucher(owner, await bill(30000), v.code, 30000, D);
    expect((await voucherLeft('b1', v.code))!.left).toBe(20000);
    await payWithVoucher(owner, await bill(30000), v.code, 30000, D);
    expect((await voucherLeft('b1', v.code))!.left).toBe(0);
    await expect(usableVoucher('b1', v.code, D)).rejects.toThrow();
  });

  it('a one-use voucher is finished after its first bill, even with money left', async () => {
    const v = await sellVoucher(owner, { amount: 50000, mode: 'cash', singleUse: true });
    await payWithVoucher(owner, await bill(20000), v.code, 20000, D);
    expect((await voucherLeft('b1', v.code))!.left).toBe(0);
    await expect(payWithVoucher(owner, await bill(10000), v.code, 10000, D)).rejects.toThrow(/one use/);
  });

  it('an expired voucher is refused', async () => {
    const v = await sellVoucher(owner, { amount: 10000, mode: 'cash', validTill: '2026-11-01' });
    await expect(usableVoucher('b1', v.code, D)).rejects.toThrow(/expired/);
  });
});

describe('Day start', () => {
  it('asks after opening time, records the count and the gap, and leaves the cash book and day-end alone', async () => {
    const s = (await db.settings.get('b1'))!;
    const morning = new Date(2026, 10, 20, 8, 0);
    const opened = new Date(2026, 10, 20, 10, 0);
    expect(await openingDue('b1', { ...s, openingTime: '09:00' }, morning)).toBe(false);
    expect(await openingDue('b1', { ...s, openingTime: '09:00' }, opened)).toBe(true);
    const before = await cashDay('b1', D);
    await openDay(owner, D, before.opening, before.opening - 5000);
    expect(await dayOpened('b1', D)).toMatchObject({ counted: before.opening - 5000, expected: before.opening });
    expect((await dayOpened('b1', D))!.note).toContain('50.00');
    expect(await openingDue('b1', { ...s, openingTime: '09:00' }, opened)).toBe(false);
    // The opening count is a record only: the day is not "closed" and the cash book is unchanged.
    expect((await cashDay('b1', D)).opening).toBe(before.opening);
    expect(await dayToClose('b1', s, new Date(2026, 10, 21, 10, 0))).toBeNull();
  });
});
