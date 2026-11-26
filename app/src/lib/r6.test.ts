import 'fake-indexeddb/auto';
import { todayISO } from '@invoice/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { cashDay } from './cashbook';
import { cheques, markCleared } from './cheques';
import { db, type BankAccount, type Customer } from './db';
import { bankBalances, bankBook, correctBalance, saveMoneyMove } from './money';
import { recordSupplierPayment, saveExpense } from './purchases';
import { PermissionError, ensureBusinessRecords, newId, newInvoiceDraft, putRecord, recordPayments, saveInvoice, type Actor } from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
const TODAY = todayISO();

const account = (id: string, extra: Partial<BankAccount> = {}) =>
  putRecord('bankAccounts', owner, { id, holderName: 'Test Co', bankName: id.toUpperCase(), accountNumber: `00012345${id.length}`, ifsc: 'HDFC0001234', accountType: 'current', isDefault: false, ...extra } as BankAccount);

async function bill(amount: number) {
  const d = await newInvoiceDraft(owner);
  return saveInvoice(owner, { ...d, billTo: { customerId: 'c1', name: 'Mehta' }, lines: [{ id: 'l', name: 'Wire', qty: 1, unit: 'pcs', rate: amount, rateIncludesTax: false, taxPct: 0 }] } as never, { finalize: true });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Mehta', phone: '+919876543210', billingAddress: {}, openingBalance: 0 } as Customer);
});

describe('R6.1 bank accounts', () => {
  it('UPI and card money goes to the default account unless another is picked; cash stays in the drawer', async () => {
    await account('hdfc', { isDefault: true, openingBalance: 1_000_00, openingDate: '2026-01-01' });
    await account('sbi');
    const inv = await bill(5_000_00);
    await recordPayments(owner, inv.id, [
      { mode: 'upi', amount: 2_000_00 },
      { mode: 'card', amount: 1_000_00, accountId: 'sbi' },
      { mode: 'cash', amount: 500_00 },
    ]);
    const b = new Map((await bankBalances('b1')).map((x) => [x.account.id, x.balance]));
    expect(b.get('hdfc')).toBe(3_000_00); // opening 1,000 + UPI 2,000
    expect(b.get('sbi')).toBe(1_000_00);
    expect((await cashDay('b1', TODAY)).expected).toBe(500_00);
  });

  it('a cheque reaches the bank when it clears, on the clearing date', async () => {
    await account('hdfc', { isDefault: true });
    const inv = await bill(3_000_00);
    await recordPayments(owner, inv.id, [{ mode: 'cheque', amount: 3_000_00, reference: '000123' }]);
    expect((await bankBalances('b1'))[0]!.balance).toBe(0);
    await markCleared(owner, (await cheques('b1'))[0]!);
    expect((await bankBalances('b1'))[0]!.balance).toBe(3_000_00);
  });

  it('supplier payments and expenses by bank come out of the account', async () => {
    await account('hdfc', { isDefault: true, openingBalance: 10_000_00 });
    await putRecord('suppliers', owner, { id: 's1', name: 'Polycab Dist' } as never);
    await recordSupplierPayment(owner, { supplierId: 's1', amount: 4_000_00, mode: 'bank', date: TODAY });
    await saveExpense(owner, { id: newId(), category: 'rent', amount: 2_500_00, mode: 'upi', date: TODAY } as never);
    const book = await bankBook('b1', 'hdfc', TODAY, TODAY);
    expect(book!.opening).toBe(10_000_00);
    expect(book!.lines.map((l) => l.amount)).toEqual([-4_000_00, -2_500_00]);
    expect(book!.closing).toBe(3_500_00);
  });

  it('deposit, withdrawal and transfer move money between the drawer and the accounts', async () => {
    await account('hdfc', { isDefault: true });
    await account('sbi');
    const inv = await bill(10_000_00);
    await recordPayments(owner, inv.id, [{ mode: 'cash', amount: 10_000_00 }]);
    await saveMoneyMove(owner, { kind: 'deposit', from: 'cash', to: 'hdfc', amount: 8_000_00, date: TODAY });
    await saveMoneyMove(owner, { kind: 'withdraw', from: 'hdfc', to: 'cash', amount: 1_000_00, date: TODAY });
    await saveMoneyMove(owner, { kind: 'transfer', from: 'hdfc', to: 'sbi', amount: 2_000_00, date: TODAY });
    const b = new Map((await bankBalances('b1')).map((x) => [x.account.id, x.balance]));
    expect(b.get('hdfc')).toBe(5_000_00);
    expect(b.get('sbi')).toBe(2_000_00);
    const day = await cashDay('b1', TODAY);
    expect(day.expected).toBe(3_000_00); // 10,000 − 8,000 + 1,000
    expect(day.cashOut.some((l) => l.label.includes('deposited'))).toBe(true);
    await expect(saveMoneyMove(staff, { kind: 'deposit', from: 'cash', to: 'hdfc', amount: 1, date: TODAY })).rejects.toBeInstanceOf(PermissionError);
  });

  it('the owner corrects a balance to what the bank shows', async () => {
    await account('hdfc', { isDefault: true, openingBalance: 5_000_00 });
    await correctBalance(owner, 'hdfc', 4_750_00); // ₹250 bank charges not entered
    expect((await bankBalances('b1'))[0]!.balance).toBe(4_750_00);
    expect(await correctBalance(owner, 'hdfc', 4_750_00)).toBeNull();
  });

  it('money from before the opening date is already inside the opening balance', async () => {
    await account('hdfc', { isDefault: true, openingBalance: 7_000_00, openingDate: TODAY });
    await saveMoneyMove(owner, { kind: 'adjust', from: null, to: 'hdfc', amount: 100_00, date: '2020-01-01' });
    expect((await bankBalances('b1'))[0]!.balance).toBe(7_000_00);
  });
});
