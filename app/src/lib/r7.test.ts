import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { gstr3b } from './gstReturns';
import { match2b, parsePortalJson } from './gstr2b';
import { balanceSheet, ledgerOf, ownerMoney, saveJournal, trialBalance } from './books';
import { cashDay, closeDay } from './cashbook';
import { db } from './db';
import { addLoanEntry, saveIncome, saveLoan, saveMoneyMove } from './money';
import { newPurchaseDraft, recordSupplierPayment, saveExpense, savePurchase } from './purchases';
import { ensureBusinessRecords, newCreditNoteDraft, newInvoiceDraft, putRecord, recordPayments, saveCreditNote, saveInvoice, type Actor } from './repo';

export const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
export const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const line = (id: string, name: string, qty: number, rate: number, extra = {}) => ({ id, name, qty, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0, ...extra });
const D = '2026-04-10';
const blank = { businessId: 'b1', createdAt: '', updatedAt: '', updatedBy: '' };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Mehta', billingAddress: {}, openingBalance: 100000 } as never);
  await putRecord('suppliers', owner, { id: 's1', name: 'Bajaj', address: {}, openingBalance: 50000 } as never);
  await putRecord('bankAccounts', owner, { id: 'acc', holderName: 'T', bankName: 'HDFC', accountNumber: '1234', ifsc: 'HDFC0001234', accountType: 'current', isDefault: true, openingBalance: 1000000, openingDate: '2026-04-01' } as never);
  await putRecord('items', owner, { id: 'i1', name: 'Fan', unit: 'pcs', rate: 200000, purchasePrice: 150000, taxPct: 18 } as never);
});

describe('R7.1 books', () => {
  it('a busy store: the trial balance and the balance sheet tally', async () => {
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, date: D, billTo: { customerId: 'c1', name: 'Mehta', address: {} }, lines: [line('a', 'Fan', 2, 200000, { itemId: 'i1', taxPct: 18 })] }, { finalize: true });
    await recordPayments(owner, inv.id, [{ mode: 'cash', amount: 300000 }, { mode: 'upi', amount: 100000 }], { date: D });
    const n = await newCreditNoteDraft(owner, inv.id);
    await saveCreditNote(owner, { ...n, date: D, reason: 'return', lines: n.lines.map((l) => ({ ...l, qty: 1 })) }, { finalize: true });
    const pd = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...pd, date: D, taxMode: 'gst', supplier: { supplierId: 's1', name: 'Bajaj' }, lines: [line('p', 'Fan', 5, 150000, { itemId: 'i1', taxPct: 18 })] } as never, { finalize: true });
    await recordSupplierPayment(owner, { supplierId: 's1', amount: 200000, mode: 'bank', date: D });
    await saveExpense(owner, { ...blank, id: 'e1', category: 'rent', amount: 50000, mode: 'cash', date: D } as never);
    await saveIncome(owner, { id: 'in1', category: 'interest', amount: 2000, mode: 'bank', date: D } as never);
    const loan = await saveLoan(owner, { id: 'l1', kind: 'taken', name: 'SBI', openingBalance: 0, startDate: D } as never);
    await addLoanEntry(owner, { loanId: loan.id, kind: 'received', amount: 500000, mode: 'bank', date: D } as never);
    await addLoanEntry(owner, { loanId: loan.id, kind: 'interest', amount: 4000, mode: 'bank', date: D } as never);
    await saveMoneyMove(owner, { kind: 'deposit', from: 'cash', to: 'acc', amount: 100000, date: D } as never);
    const day = await cashDay('b1', D);
    await closeDay(owner, day, day.expected - 1000); // ₹10 short
    await ownerMoney(owner, 'capital', 1000000, 'cash', D);
    await ownerMoney(owner, 'drawings', 30000, 'bank:acc', D);

    const tb = await trialBalance('b1', '2026-04-30');
    expect(tb.reduce((a, b) => a + b.balance, 0)).toBe(0);
    const bs = await balanceSheet('b1', '2026-04-30');
    expect(bs.totalA).toBe(bs.totalL);
    const cash = await ledgerOf('b1', 'cash', '2026-04-01', '2026-04-30');
    expect(cash.closing).toBe(day.expected - 1000 + 1000000);
    const bank = tb.find((b) => b.info.key === 'bank:acc')!.balance;
    expect(bank).toBe(1000000 + 100000 - 200000 + 2000 + 500000 - 4000 + 100000 - 30000);
    // Input GST: 18% of 5 × ₹1,500 (this test store has no GSTIN, so its bills carry no output tax).
    expect(tb.filter((b) => b.info.key.startsWith('gst:in')).reduce((a, b) => a + b.balance, 0)).toBe(135000);
    expect(tb.find((b) => b.info.key === 'closing_stock')!.balance).toBe((5 - 2 + 1) * 150000);
  });

  it('journals: owner only, balanced', async () => {
    const j = (lines: { account: string; debit: number; credit: number }[]) => ({ ...blank, id: 'j', date: D, lines });
    await expect(saveJournal(staff, j([]))).rejects.toThrow();
    await expect(saveJournal(owner, j([{ account: 'cash', debit: 100, credit: 0 }, { account: 'capital', debit: 0, credit: 90 }]))).rejects.toThrow();
    await saveJournal(owner, j([{ account: 'cash', debit: 100, credit: 0 }, { account: 'capital', debit: 0, credit: 100 }]));
    expect((await trialBalance('b1', D)).reduce((a, b) => a + b.balance, 0)).toBe(0);
  });
});

describe('R7.2 GSTR-3B', () => {
  it('outward taxable less returns, nil and non-GST, input credit and tax to pay', async () => {
    await db.profiles.update('b1', { gstType: 'regular', taxIdValue: '27AAPFU0939F1ZV', address: { state: 'Maharashtra' } });
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, date: D, taxMode: 'gst', lines: [line('a', 'Fan', 2, 100000, { taxPct: 18 }), line('b', 'Rice', 1, 50000, { taxPct: 0 })] }, { finalize: true });
    const n = await newCreditNoteDraft(owner, inv.id);
    await saveCreditNote(owner, { ...n, date: D, reason: 'return', lines: n.lines.filter((l) => l.name === 'Fan').map((l) => ({ ...l, qty: 1 })) }, { finalize: true });
    const b = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...b, date: D, taxMode: 'none', lines: [line('c', 'Service', 1, 30000)] }, { finalize: true });
    const pd = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...pd, date: D, taxMode: 'gst', interState: false, lines: [line('p', 'Fan', 1, 50000, { taxPct: 18 })] } as never, { finalize: true });
    const r = await gstr3b('b1', { from: '2026-04-01', to: '2026-04-30' });
    expect(r.outTaxable).toEqual({ taxable: 100000, igst: 0, cgst: 9000, sgst: 9000 });
    expect(r.outNil).toBe(50000);
    expect(r.outNonGst).toBe(30000);
    expect(r.itc).toEqual({ taxable: 50000, igst: 0, cgst: 4500, sgst: 4500 });
    expect(r.payable).toEqual({ taxable: 0, igst: 0, cgst: 4500, sgst: 4500 });
  });
});

describe('R7.3 GSTR-2B match', () => {
  it('matched, tax differs, not entered, not in 2B', async () => {
    await putRecord('suppliers', owner, { id: 's2', name: 'Havells', address: {}, openingBalance: 0, taxId: '07AAACH1234F1Z5' } as never);
    const bill = async (no: string, rate: number) => {
      const pd = await newPurchaseDraft(owner);
      return savePurchase(owner, { ...pd, date: '2026-04-05', taxMode: 'gst', supplierBillNo: no, supplier: { supplierId: 's2', name: 'Havells', taxId: '07AAACH1234F1Z5' }, interState: true, lines: [line('p', 'Fan', 1, rate, { taxPct: 18 })] } as never, { finalize: true });
    };
    await bill('HV/0012', 100000); // matches INV 12
    await bill('HV-13', 100000); // tax differs
    await bill('HV-99', 100000); // not in 2B
    const json = JSON.stringify({
      data: {
        rtnprd: '042026',
        docdata: {
          b2b: [
            {
              ctin: '07AAACH1234F1Z5',
              trdnm: 'HAVELLS',
              inv: [
                { inum: 'HV12', dt: '05-04-2026', val: 1180, items: [{ txval: 1000, igst: 180, cgst: 0, sgst: 0 }] },
                { inum: 'HV-13', dt: '05-04-2026', val: 1200, items: [{ txval: 1000, igst: 200, cgst: 0, sgst: 0 }] },
                { inum: 'HV-14', dt: '06-04-2026', val: 590, items: [{ txval: 500, igst: 90 }] },
              ],
            },
          ],
        },
      },
    });
    const { invoices, period } = parsePortalJson(json);
    expect(invoices).toHaveLength(3);
    const rows = await match2b('b1', invoices, period);
    expect(rows.map((r) => [r.state, r.number])).toEqual([
      ['differs', 'HV-13'],
      ['notEntered', 'HV-14'],
      ['notIn2b', 'HV-99'],
      ['matched', 'HV12'],
    ]);
  });
});
