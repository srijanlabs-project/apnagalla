import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { splitGst } from '@invoice/shared';
import { gstViewOf } from './gstView';
import {
  cancelCreditNote,
  cancelInvoice,
  newCreditNoteDraft,
  pendingAmount,
  saveCreditNote,
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
  // A regular GST store in Maharashtra.
  await db.profiles.update('b1', { gstType: 'regular', taxIdLabel: 'GSTIN', taxIdValue: '27AAPFU0939F1ZV', address: { state: 'Maharashtra' } });
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

describe('GST billing', () => {
  const gujaratBuyer = { customerId: null, name: 'Patel Traders', address: { state: 'Gujarat' }, taxId: '24AAPFU0939F1ZX' };

  it('a tax invoice records the place of supply and splits GST by state', async () => {
    const local = await savedInvoice();
    expect(local.taxMode).toBe('gst');
    expect(local.placeOfSupply).toBe('27'); // walk-in: the store's own state
    expect(local.totals.taxTotal).toBe(5000);
    const p = (await db.profiles.get('b1'))!;
    expect(gstViewOf('invoice', local, p, local.totals)).toMatchObject({ title: 'Tax Invoice', interState: false, split: { cgst: 2500, sgst: 2500, igst: 0 } });

    const d = await newInvoiceDraft(owner);
    const other = await saveInvoice(owner, { ...d, lines: [line], billTo: gujaratBuyer, shipTo: { state: 'Goa' } }, { finalize: true });
    expect(other.placeOfSupply).toBe('30'); // goods go to Goa
    expect(gstViewOf('invoice', other, p, other.totals)).toMatchObject({ interState: true, split: { igst: 5000 } });
    expect(splitGst(other.totals, true).igst).toBe(other.totals.taxTotal);
  });

  it('bills without GST charge no tax and are numbered in their own series', async () => {
    const tax = await savedInvoice();
    const d = await newInvoiceDraft(owner);
    const bill = await saveInvoice(owner, { ...d, taxMode: 'none', lines: [{ ...line, rateIncludesTax: true }], billTo: party }, { finalize: true });
    expect(bill.totals.taxTotal).toBe(0);
    expect(bill.totals.grandTotal).toBe(100000); // the price as entered
    expect(bill.number).toMatch(/^BOS\/\d{2}-\d{2}\/0001$/);
    expect(bill.numberSeries).toMatch(/^bill:/);
    expect(tax.number).toMatch(/^INV\//);
    const p = (await db.profiles.get('b1'))!;
    expect(gstViewOf('invoice', bill, p, bill.totals).title).toBe('Bill of Supply');
  });

  it('a store that is not registered never charges GST, even on a draft that asked for it', async () => {
    await db.profiles.update('b1', { gstType: 'unregistered' });
    const d = await newInvoiceDraft(owner);
    expect(d.taxMode).toBe('none');
    const inv = await saveInvoice(owner, { ...d, taxMode: 'gst', lines: [line], billTo: party }, { finalize: true });
    expect(inv.taxMode).toBe('none');
    expect(inv.totals.taxTotal).toBe(0);
    expect(inv.number).toMatch(/^INV\//);
  });

  it('uses the number pattern and digits from settings', async () => {
    const s = (await db.settings.get('b1'))!;
    await db.settings.put({ ...s, numberPattern: '{PREFIX}-{FY4}-{SEQ}', numberDigits: 3 });
    expect((await savedInvoice(owner, '2026-11-24')).number).toBe('INV-2026-27-001');
  });
});

describe('credit notes', () => {
  it('reduce what the customer owes, can never exceed the invoice, and can be cancelled', async () => {
    const inv = await savedInvoice(); // 2 × ₹500 + 5% = ₹1,050
    await expect(newCreditNoteDraft(staff, inv.id)).rejects.toBeInstanceOf(PermissionError);

    const draft = await newCreditNoteDraft(owner, inv.id);
    expect(draft).toMatchObject({ invoiceNumber: inv.number, taxMode: 'gst', placeOfSupply: '27' });
    // One bag returned.
    const note = await saveCreditNote(owner, { ...draft, lines: [{ ...draft.lines[0]!, qty: 1 }] }, { finalize: true });
    expect(note.number).toMatch(/^CN\//);
    expect(note.totals.grandTotal).toBe(52500);
    let fresh = (await db.invoices.get(inv.id))!;
    expect(fresh.credited).toBe(52500);
    expect(pendingAmount(fresh)).toBe(52500);

    // Paying the rest marks it paid.
    fresh = await updatePayment(owner, inv.id, { status: 'partial', amountPaid: 52500 });
    expect(fresh.payment.status).toBe('paid');

    // A second note for the full invoice is too much.
    const again = await newCreditNoteDraft(owner, inv.id);
    await expect(saveCreditNote(owner, again, { finalize: true })).rejects.toThrow(/at most ₹525.00/);

    // The invoice can't be cancelled while it has credit notes; cancelling the note restores it.
    await expect(cancelInvoice(owner, inv.id)).rejects.toThrow(/credit notes/);
    await cancelCreditNote(owner, note.id);
    fresh = (await db.invoices.get(inv.id))!;
    expect(fresh.credited).toBe(0);
    expect(fresh.payment.status).toBe('partial');
  });
});

describe('series per person on a phone that already has bills', () => {
  it('continues after the highest number already on the phone', async () => {
    const d = await newInvoiceDraft(owner);
    // A bill from before the phone kept a counter (e.g. synced from another phone).
    await db.invoices.put({ ...d, id: 'old', status: 'saved', number: 'INV/26-27/0042', numberSeries: 'invoice:26-27', numberSeq: 42, date: '2026-11-24' });
    expect((await savedInvoice(owner, '2026-11-24')).number).toBe('INV/26-27/0043');
  });
});
