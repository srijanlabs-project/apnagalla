import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
  cancelInvoice,
  convertEstimate,
  ensureBusinessRecords,
  isNumberTaken,
  newEstimateDraft,
  newInvoiceDraft,
  PermissionError,
  saveEstimate,
  saveInvoice,
  updatePayment,
  type Actor,
} from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff' };

const line = { id: 'l1', name: 'Rice', qty: 2, unit: 'bag', rate: 50000, rateIncludesTax: false, taxPct: 5 };
const party = { customerId: null, name: 'Walk-in', address: {} };

async function savedInvoice(actor = owner, date?: string) {
  const d = await newInvoiceDraft(actor);
  return saveInvoice(actor, { ...d, date: date ?? d.date, lines: [line], billTo: party }, { finalize: true });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
});

describe('invoice numbering', () => {
  it('numbers saved invoices sequentially per financial year, drafts get no number', async () => {
    const draft = await saveInvoice(owner, { ...(await newInvoiceDraft(owner)), lines: [line] }, { finalize: false });
    expect(draft.number).toBe('');
    expect(draft.status).toBe('draft');

    const a = await savedInvoice(owner, '2026-11-24');
    const b = await savedInvoice(owner, '2026-12-01');
    const c = await savedInvoice(owner, '2027-04-01'); // new financial year
    expect([a.number, b.number, c.number]).toEqual(['INV/26-27/0001', 'INV/26-27/0002', 'INV/27-28/0001']);
  });

  it('skips a number that was already typed manually', async () => {
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, date: '2026-11-24', number: 'INV/26-27/0001', lines: [line], billTo: party }, { finalize: true });
    const next = await savedInvoice(owner, '2026-11-24');
    expect(next.number).toBe('INV/26-27/0002');
    expect(await isNumberTaken('invoice', 'b1', 'INV/26-27/0001')).toBe(true);
  });

  it('freezes business details at save time', async () => {
    const inv = await savedInvoice();
    await db.profiles.update('b1', { name: 'Renamed Co' });
    expect((await db.invoices.get(inv.id))!.businessSnapshot!.name).toBe('Test Co');
  });

  it('queues every change for sync, one entry per record', async () => {
    const inv = await savedInvoice();
    await updatePayment(owner, inv.id, { status: 'partial', amountPaid: 100 });
    const entries = await db.outbox.where('[table+recordId]').equals(['invoices', inv.id]).toArray();
    expect(entries).toHaveLength(1);
  });
});

describe('permissions (SPEC §4.6)', () => {
  it('staff can create but not edit a saved invoice', async () => {
    const inv = await savedInvoice(staff);
    await expect(saveInvoice(staff, { ...inv, notes: 'changed' }, { finalize: false })).rejects.toBeInstanceOf(PermissionError);
    const edited = await saveInvoice(owner, { ...inv, notes: 'changed' }, { finalize: false });
    expect(edited.history.at(-1)!.action).toBe('edited');
  });

  it('only the owner can cancel; cancelled invoices are locked', async () => {
    const inv = await savedInvoice();
    await expect(cancelInvoice(staff, inv.id)).rejects.toBeInstanceOf(PermissionError);
    await cancelInvoice(owner, inv.id, 'duplicate');
    expect((await db.invoices.get(inv.id))!.status).toBe('cancelled');
    await expect(saveInvoice(owner, { ...inv, status: 'saved' }, { finalize: false })).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('payments (SPEC §3)', () => {
  it('derives status from amount and caps at the total', async () => {
    const inv = await savedInvoice(); // 2 × ₹500 + 5% = ₹1,050
    expect(inv.totals.grandTotal).toBe(105000);
    expect((await updatePayment(owner, inv.id, { status: 'partial', amountPaid: 40000 })).payment).toMatchObject({ status: 'partial', amountPaid: 40000 });
    expect((await updatePayment(owner, inv.id, { status: 'partial', amountPaid: 999999 })).payment).toMatchObject({ status: 'paid', amountPaid: 105000 });
    expect((await updatePayment(owner, inv.id, { status: 'unpaid', amountPaid: 0 })).payment.status).toBe('unpaid');
  });

  it('staff may increase but not reduce a payment', async () => {
    const inv = await savedInvoice();
    await updatePayment(staff, inv.id, { status: 'partial', amountPaid: 50000 });
    await expect(updatePayment(staff, inv.id, { status: 'partial', amountPaid: 10000 })).rejects.toBeInstanceOf(PermissionError);
  });

  it('re-clamps the payment when an edit lowers the total', async () => {
    const inv = await savedInvoice();
    await updatePayment(owner, inv.id, { status: 'paid', amountPaid: 105000 });
    const fresh = (await db.invoices.get(inv.id))!;
    const edited = await saveInvoice(owner, { ...fresh, lines: [{ ...line, qty: 1 }] }, { finalize: false });
    expect(edited.totals.grandTotal).toBe(52500);
    expect(edited.payment).toMatchObject({ status: 'paid', amountPaid: 52500 });
  });
});

describe('estimates', () => {
  it('convert to a draft invoice with everything copied', async () => {
    const e = await newEstimateDraft(owner);
    const est = await saveEstimate(owner, { ...e, lines: [line], billTo: party, notes: 'Valid 7 days' }, { finalize: true });
    expect(est.number).toMatch(/^EST\//);
    const inv = await convertEstimate(owner, est.id);
    expect(inv.status).toBe('draft');
    expect(inv.lines[0]!.name).toBe('Rice');
    expect(inv.lines[0]!.id).not.toBe('l1');
    expect(inv.notes).toBe('Valid 7 days');
    expect(inv.fromEstimateId).toBe(est.id);
    const after = (await db.estimates.get(est.id))!;
    expect(after.status).toBe('converted');
    expect(after.convertedInvoiceId).toBe(inv.id);
  });
});
