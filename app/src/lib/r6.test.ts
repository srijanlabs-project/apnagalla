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

describe('R6.2 income and expenses', () => {
  it('a repeating expense is listed when due, paid once, and late payment still counts for its month', async () => {
    const { dueDates, dueExpenses, payRecurring, saveRecurring } = await import('./recurring');
    expect(dueDates({ every: 'month', day: 5, startDate: '2026-09-05' }, '2026-11-26')).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
    expect(dueDates({ every: 'month', day: 31, startDate: '2026-09-01' }, '2026-10-30')).toEqual(['2026-09-28', '2026-10-28']);
    expect(dueDates({ every: 'week', day: 1, startDate: '2026-11-10' }, '2026-11-26')).toEqual(['2026-11-16', '2026-11-23']); // Mondays
    const r = await saveRecurring(owner, { id: 'rent', category: 'rent', amount: 15_000_00, mode: 'bank', paidTo: 'Landlord', every: 'month', day: 1, startDate: '2026-10-01' });
    let due = (await dueExpenses('b1', '2026-11-26'))[0]!;
    expect(due.due).toEqual(['2026-10-01', '2026-11-01']);
    expect(due.next).toBe('2026-12-01');
    await payRecurring(owner, r, '2026-10-01', { amount: 15_000_00, mode: 'bank', date: '2026-10-07' });
    due = (await dueExpenses('b1', '2026-11-26'))[0]!;
    expect(due.due).toEqual(['2026-11-01']);
    const e = (await db.expenses.toArray()).find((x) => x.recurringId === 'rent')!;
    expect(e).toMatchObject({ category: 'rent', paidTo: 'Landlord', recurringFor: '2026-10-01', date: '2026-10-07' });
    await expect(saveRecurring(staff, { ...r })).rejects.toBeInstanceOf(PermissionError);
  });

  it('other income goes into cash or the bank; only the owner adds it', async () => {
    const { saveIncome } = await import('./money');
    await account('hdfc', { isDefault: true });
    await saveIncome(owner, { id: 'i1', category: 'interest', amount: 320_00, mode: 'bank', date: TODAY });
    await saveIncome(owner, { id: 'i2', category: 'Scrap', amount: 150_00, mode: 'cash', date: TODAY, from: 'Kabadiwala' });
    expect((await bankBalances('b1'))[0]!.balance).toBe(320_00);
    expect((await cashDay('b1', TODAY)).cashIn.map((l) => l.label)).toEqual(['Scrap · Kabadiwala']);
    await expect(saveIncome(staff, { id: 'i3', category: 'interest', amount: 1, mode: 'cash', date: TODAY })).rejects.toBeInstanceOf(PermissionError);
  });

  it('own expense categories and paid-to show in the cash book', async () => {
    await saveExpense(staff, { id: newId(), category: 'Packing material', amount: 90_00, mode: 'cash', date: TODAY, paidTo: 'Sharma Packers' } as never);
    expect((await cashDay('b1', TODAY)).cashOut[0]!.label).toBe('Packing material · Sharma Packers');
  });
});

describe('R6.3 loans', () => {
  it('a bank loan: money in, EMIs split into principal and interest, what is left', async () => {
    const { addLoanEntry, loanStatement, saveLoan } = await import('./money');
    await account('hdfc', { isDefault: true });
    await saveLoan(owner, { id: 'L1', kind: 'taken', name: 'HDFC Business Loan', openingBalance: 0, startDate: '2026-01-01', interestPct: 12, emi: 10_000_00 });
    await addLoanEntry(owner, { loanId: 'L1', kind: 'received', amount: 2_00_000_00, mode: 'bank', date: TODAY });
    await addLoanEntry(owner, { loanId: 'L1', kind: 'repaid', amount: 8_000_00, mode: 'bank', date: TODAY });
    await addLoanEntry(owner, { loanId: 'L1', kind: 'interest', amount: 2_000_00, mode: 'bank', date: TODAY });
    const st = (await loanStatement('L1'))!;
    expect(st.balance).toBe(1_92_000_00);
    expect(st.interestPaid).toBe(2_000_00);
    expect((await bankBalances('b1'))[0]!.balance).toBe(1_90_000_00); // 2,00,000 in − 10,000 EMI
  });

  it('a loan given: lent from cash, part returned with interest', async () => {
    const { addLoanEntry, loanStatement, saveLoan } = await import('./money');
    await saveLoan(owner, { id: 'L2', kind: 'given', name: 'Ramesh ji', openingBalance: 0, startDate: TODAY });
    await addLoanEntry(owner, { loanId: 'L2', kind: 'given', amount: 50_000_00, mode: 'cash', date: TODAY });
    await addLoanEntry(owner, { loanId: 'L2', kind: 'received', amount: 20_000_00, mode: 'cash', date: TODAY });
    await addLoanEntry(owner, { loanId: 'L2', kind: 'interest', amount: 1_000_00, mode: 'cash', date: TODAY });
    expect((await loanStatement('L2'))!.balance).toBe(30_000_00);
    expect((await cashDay('b1', TODAY)).expected).toBe(-29_000_00);
  });
});

describe('R6.4 receipts', () => {
  it('a split payment on a bill is one receipt; a khata payment over two bills is one receipt with the balance left', async () => {
    const { receiptFor, voucherFor, buildReceiptDefinition } = await import('./pdf/receipt');
    const { receiveKhataPayment } = await import('./khata');
    const a = await bill(3_000_00);
    const [p1] = await recordPayments(owner, a.id, [
      { mode: 'cash', amount: 1_000_00 },
      { mode: 'upi', amount: 500_00, reference: 'UPI123' },
    ]);
    const r = (await receiptFor(p1!.id))!;
    expect(r.total).toBe(1_500_00);
    expect(r.lines.map((l) => l.mode).sort()).toEqual(['Cash', 'UPI']);
    expect(r.party).toBe('Mehta');
    expect(r.number).toMatch(/^RC-\d{6}-[A-Z0-9]{4}$/);

    const b = await bill(2_000_00);
    const entries = await receiveKhataPayment(owner, (await db.customers.get('c1'))!, { amount: 2_500_00, mode: 'cash', date: TODAY });
    const k = (await receiptFor(entries[0]!.id))!;
    expect(k.total).toBe(2_500_00);
    expect(k.against.map((x) => x.label)).toEqual([`Bill ${a.number}`, `Bill ${b.number}`]);
    expect(k.balanceAfter).toBe(1_000_00); // 5,000 billed − 1,500 − 2,500
    const def = JSON.stringify(buildReceiptDefinition(k));
    expect(def).toContain('Payment receipt');
    expect(def).toContain('Balance still due');

    await putRecord('suppliers', owner, { id: 's1', name: 'Polycab Dist' } as never);
    const sp = await recordSupplierPayment(owner, { supplierId: 's1', amount: 4_000_00, mode: 'bank', date: TODAY, reference: 'NEFT9' });
    const v = (await voucherFor(sp.id))!;
    expect(v).toMatchObject({ kind: 'voucher', party: 'Polycab Dist', total: 4_000_00 });
    expect(v.number.startsWith('PV-')).toBe(true);
  });
});
