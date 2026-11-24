import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { splitGst } from '@invoice/shared';
import { gstViewOf } from './gstView';
import {
  cancelCreditNote,
  cancelInvoice,
  newCreditNoteDraft,
  billMoney,
  convertLegacyPayments,
  recordPayments,
  voidPayment,
  saveCreditNote,
  convertEstimate,
  ensureBusinessRecords,
  isNumberTaken,
  newEstimateDraft,
  newInvoiceDraft,
  PermissionError,
  saveEstimate,
  saveInvoice,
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
    await saveInvoice(owner, { ...inv, notes: 'one' }, { finalize: false });
    await saveInvoice(owner, { ...(await db.invoices.get(inv.id))!, notes: 'two' }, { finalize: false });
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

describe('payments as dated entries', () => {
  it('works out paid / pending from entries, splits across modes, never more than pending', async () => {
    const inv = await savedInvoice(); // 2 × ₹500 + 5% = ₹1,050
    expect(inv.totals.grandTotal).toBe(105000);
    await recordPayments(staff, inv.id, [
      { amount: 30000, mode: 'cash' },
      { amount: 10000, mode: 'upi', reference: 'UTR123' },
    ]);
    let m = await billMoney(inv.id);
    expect(m).toMatchObject({ paid: 40000, pending: 65000, status: 'partial' });
    expect(m.entries.map((e) => [e.mode, e.amount, e.receivedByName])).toEqual([
      ['cash', 30000, 'Staff'],
      ['upi', 10000, 'Staff'],
    ]);
    await expect(recordPayments(owner, inv.id, [{ amount: 70000, mode: 'cash' }])).rejects.toThrow(/Only ₹650.00 is pending/);
    await recordPayments(owner, inv.id, [{ amount: 65000, mode: 'card' }]);
    expect((await billMoney(inv.id)).status).toBe('paid');

    // A mistake is voided by the owner (staff can't); it stays listed but no longer counts.
    const cash = m.entries[0]!;
    await expect(voidPayment(staff, cash.id, 'typo')).rejects.toBeInstanceOf(PermissionError);
    await voidPayment(owner, cash.id, 'typo');
    m = await billMoney(inv.id);
    expect(m).toMatchObject({ paid: 75000, pending: 30000, status: 'partial' });
    expect(m.entries.find((e) => e.id === cash.id)?.voidReason).toBe('typo');
  });

  it('a bill with payments is not cancelled until they are voided', async () => {
    const inv = await savedInvoice();
    const [p] = await recordPayments(owner, inv.id, [{ amount: 1000, mode: 'cash' }]);
    await expect(cancelInvoice(owner, inv.id)).rejects.toThrow(/payments/);
    await voidPayment(owner, p!.id, 'wrong bill');
    await cancelInvoice(owner, inv.id);
  });

  it('turns an old paid amount into one entry, the same on every phone', async () => {
    const inv = await savedInvoice();
    await db.invoices.update(inv.id, { payment: { status: 'partial', amountPaid: 20000, date: '2026-11-01', mode: 'upi' } });
    expect(await convertLegacyPayments(owner)).toBe(1);
    expect(await convertLegacyPayments(owner)).toBe(0);
    const m = await billMoney(inv.id);
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]).toMatchObject({ id: `legacy-${inv.id}`, amount: 20000, mode: 'upi', date: '2026-11-01' });
    expect(m.pending).toBe(85000);
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

describe('credit notes and returns', () => {
  it('reduce what the customer owes, can never exceed the invoice, and can be cancelled', async () => {
    const inv = await savedInvoice(); // 2 × ₹500 + 5% = ₹1,050
    const draft = await newCreditNoteDraft(owner, inv.id);
    expect(draft).toMatchObject({ invoiceNumber: inv.number, taxMode: 'gst', placeOfSupply: '27', reason: 'return' });
    // One bag returned.
    const note = await saveCreditNote(owner, { ...draft, lines: [{ ...draft.lines[0]!, qty: 1 }] }, { finalize: true });
    expect(note.number).toMatch(/^CN\//);
    expect(note.totals.grandTotal).toBe(52500);
    expect(await billMoney(inv.id)).toMatchObject({ credited: 52500, due: 52500, pending: 52500 });

    // Paying the rest marks it paid.
    await recordPayments(owner, inv.id, [{ amount: 52500, mode: 'cash' }]);
    expect((await billMoney(inv.id)).status).toBe('paid');

    // A second note for the full invoice is too much.
    const again = await newCreditNoteDraft(owner, inv.id);
    await expect(saveCreditNote(owner, again, { finalize: true })).rejects.toThrow(/at most ₹525.00/);

    // The invoice can't be cancelled while it has credit notes; cancelling the note restores it.
    await expect(cancelInvoice(owner, inv.id)).rejects.toThrow(/credit notes/);
    await cancelCreditNote(owner, note.id);
    expect(await billMoney(inv.id)).toMatchObject({ credited: 0, pending: 52500, status: 'partial' });
  });

  it('staff take returns on any bill and refund what was overpaid; price cuts stay with the owner', async () => {
    const inv = await savedInvoice(owner);
    await recordPayments(owner, inv.id, [{ amount: 105000, mode: 'upi' }]);
    const draft = await newCreditNoteDraft(staff, inv.id);
    await expect(saveCreditNote(staff, { ...draft, reason: 'price' }, { finalize: true })).rejects.toBeInstanceOf(PermissionError);
    const note = await saveCreditNote(staff, { ...draft, lines: [{ ...draft.lines[0]!, qty: 1 }] }, { finalize: true });
    await expect(saveCreditNote(staff, { ...note, notes: 'edit' }, { finalize: false })).rejects.toBeInstanceOf(PermissionError);
    await expect(cancelCreditNote(staff, note.id)).rejects.toBeInstanceOf(PermissionError);

    // ₹525 was paid for goods that came back: refund it, and no more.
    expect((await billMoney(inv.id)).refundDue).toBe(52500);
    await expect(recordPayments(staff, inv.id, [{ amount: 60000, mode: 'cash' }], { kind: 'refund' })).rejects.toThrow(/refunded/);
    await recordPayments(staff, inv.id, [{ amount: 52500, mode: 'cash' }], { kind: 'refund', creditNoteId: note.id });
    expect(await billMoney(inv.id)).toMatchObject({ paid: 52500, refundDue: 0, pending: 0, status: 'paid' });
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
