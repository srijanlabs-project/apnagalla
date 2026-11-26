import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
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
