import { todayISO } from '@invoice/shared';
import { db, type BankAccount, type Income, type IncomeCategory, type Loan, type LoanEntry, type MoneyMove } from './db';
import { t } from './i18n';
import { expenseLabel } from './purchases';
import { PermissionError, newId, putRecord, type Actor } from './repo';

/**
 * R6: where the store's money is. Cash is the drawer (see cashbook.ts); UPI, card, bank transfer,
 * cleared cheques and finance payouts land in a bank account: the one picked when the money was
 * recorded, else the store's default account. Balances are added up from the records, never stored.
 */

/** Payment modes whose money goes through a bank account. */
export const BANK_MODES = ['upi', 'card', 'bank', 'cheque', 'finance'] as const;
export const isBankMode = (mode: string) => (BANK_MODES as readonly string[]).includes(mode);

/** The store's bank accounts, the default first. */
export async function bankAccountsOf(businessId: string): Promise<BankAccount[]> {
  const all = await db.bankAccounts.where('businessId').equals(businessId).filter((a) => !a.deleted).toArray();
  return all.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt));
}

export const accountName = (a: Pick<BankAccount, 'bankName' | 'accountNumber'>) => `${a.bankName}${a.accountNumber ? ` ··${a.accountNumber.slice(-4)}` : ''}`;

/** 'cash', a bank account id, or null (money that isn't in the drawer or a known account: "other"). */
export function placeOf(mode: string, accountId: string | null | undefined, defaultId: string | null): string | null {
  if (mode === 'cash') return 'cash';
  if (isBankMode(mode)) return accountId || defaultId;
  return null;
}

export interface MoneyEvent {
  date: string;
  /** 'cash' or a bank account id. */
  place: string;
  /** Paise: + in, − out. */
  amount: number;
  label: string;
  /** For the cash-flow report. */
  kind: 'sales' | 'refund' | 'supplier' | 'expense' | 'income' | 'loanIn' | 'loanOut' | 'interest' | 'move';
  href?: string;
  at: string;
}

const LOAN_ENTRY_TEXT: Record<LoanEntry['kind'], () => string> = {
  received: () => t('Received'),
  repaid: () => t('Repaid'),
  given: () => t('Lent'),
  interest: () => t('Interest'),
  charge: () => t('Charges'),
};
export const loanEntryLabel = (k: LoanEntry['kind']) => LOAN_ENTRY_TEXT[k]();

/** + money comes to the store, − it goes out. */
export function loanEntrySign(loan: Pick<Loan, 'kind'>, kind: LoanEntry['kind']): 1 | -1 {
  if (kind === 'received') return 1;
  if (kind === 'interest') return loan.kind === 'given' ? 1 : -1;
  return -1; // repaid, given, charge
}

const INCOME_TEXT: Record<IncomeCategory, () => string> = {
  interest: () => t('Interest received'),
  rent: () => t('Rent received'),
  commission: () => t('Commission'),
  scrap: () => t('Scrap sale'),
  discount: () => t('Discount received'),
  other: () => t('Other income'),
};
export const incomeLabel = (c: Income['category']): string => INCOME_TEXT[c as IncomeCategory]?.() ?? c;

/** Every movement of money in the store (cash and bank), oldest first. */
export async function moneyEvents(businessId: string): Promise<MoneyEvent[]> {
  const live = <T extends { deleted?: boolean }>(r: T) => !r.deleted;
  const [accounts, pays, invoices, customers, sPays, suppliers, expenses, incomes, loans, loanEntries, moves] = await Promise.all([
    bankAccountsOf(businessId),
    db.payments.where('businessId').equals(businessId).filter((p) => live(p) && !p.voidedAt).toArray(),
    db.invoices.where('businessId').equals(businessId).toArray(),
    db.customers.where('businessId').equals(businessId).toArray(),
    db.supplierPayments.where('businessId').equals(businessId).filter((p) => live(p) && !p.voidedAt).toArray(),
    db.suppliers.where('businessId').equals(businessId).toArray(),
    db.expenses.where('businessId').equals(businessId).filter(live).toArray(),
    db.incomes.where('businessId').equals(businessId).filter(live).toArray(),
    db.loans.where('businessId').equals(businessId).toArray(),
    db.loanEntries.where('businessId').equals(businessId).filter(live).toArray(),
    db.moneyMoves.where('businessId').equals(businessId).filter(live).toArray(),
  ]);
  const def = accounts[0]?.id ?? null;
  const numberOf = new Map(invoices.map((i) => [i.id, i.number]));
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const loanOf = new Map(loans.map((l) => [l.id, l]));
  const out: MoneyEvent[] = [];
  const push = (place: string | null, e: Omit<MoneyEvent, 'place'>) => {
    if (place) out.push({ ...e, place });
  };

  for (const p of pays) {
    if (p.mode === 'advance' || p.mode === 'creditnote' || p.mode === 'points') continue;
    // A cheque is in the bank once it clears (a pending one is not money yet).
    if (p.mode === 'cheque' && p.kind === 'payment' && p.chequeStatus === 'pending') continue;
    const date = p.mode === 'cheque' && p.chequeClearedAt ? p.chequeClearedAt.slice(0, 10) : p.date;
    const who = p.invoiceId ? (numberOf.get(p.invoiceId) ?? '') : (customerName.get(p.customerId ?? '') ?? '');
    const refund = p.kind === 'refund';
    push(placeOf(p.mode, p.accountId, def), {
      date,
      amount: refund ? -p.amount : p.amount,
      kind: refund ? 'refund' : 'sales',
      label: refund ? t('Refund {ref}', { ref: who }) : p.invoiceId ? t('Received · {ref}', { ref: who }) : t('Khata payment · {name}', { name: who }),
      href: p.invoiceId ? `/tabs/invoices/${p.invoiceId}` : p.customerId ? `/tabs/customers/${p.customerId}` : undefined,
      at: p.createdAt,
    });
  }
  for (const p of sPays) {
    const name = supplierName.get(p.supplierId) ?? '';
    push(placeOf(p.mode, p.accountId, def), {
      date: p.date,
      amount: p.kind === 'refund' ? p.amount : -p.amount,
      kind: 'supplier',
      label: p.kind === 'refund' ? t('Refund from {name}', { name }) : t('Paid {name}', { name }),
      href: `/tabs/suppliers/${p.supplierId}`,
      at: p.createdAt,
    });
  }
  for (const e of expenses) {
    push(placeOf(e.mode, e.accountId, def), {
      date: e.date,
      amount: -e.amount,
      kind: 'expense',
      label: expenseLabel(e.category) + (e.paidTo ? ` · ${e.paidTo}` : '') + (e.note ? ` · ${e.note}` : ''),
      href: '/tabs/expenses',
      at: e.createdAt,
    });
  }
  for (const i of incomes) {
    push(placeOf(i.mode, i.accountId, def), {
      date: i.date,
      amount: i.amount,
      kind: 'income',
      label: incomeLabel(i.category) + (i.from ? ` · ${i.from}` : '') + (i.note ? ` · ${i.note}` : ''),
      href: '/tabs/income',
      at: i.createdAt,
    });
  }
  for (const e of loanEntries) {
    const loan = loanOf.get(e.loanId);
    if (!loan) continue;
    const sign = loanEntrySign(loan, e.kind);
    push(placeOf(e.mode, e.accountId, def), {
      date: e.date,
      amount: sign * e.amount,
      kind: e.kind === 'interest' || e.kind === 'charge' ? 'interest' : sign > 0 ? 'loanIn' : 'loanOut',
      label: `${loanEntryLabel(e.kind)} · ${loan.name}`,
      href: `/tabs/loans/${loan.id}`,
      at: e.createdAt,
    });
  }
  for (const m of moves) {
    const label = moveLabel(m, accounts);
    if (m.kind === 'adjust') {
      push(m.to, { date: m.date, amount: m.amount, kind: 'move', label, href: '/tabs/bank', at: m.createdAt });
      continue;
    }
    push(m.from, { date: m.date, amount: -m.amount, kind: 'move', label, href: '/tabs/bank', at: m.createdAt });
    push(m.to, { date: m.date, amount: m.amount, kind: 'move', label, href: '/tabs/bank', at: m.createdAt });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}

export function moveLabel(m: MoneyMove, accounts: BankAccount[]): string {
  const name = (p: string | null) => (p === 'cash' ? t('Cash') : accounts.find((a) => a.id === p) ? accountName(accounts.find((a) => a.id === p)!) : t('Bank'));
  const base =
    m.kind === 'deposit'
      ? t('Cash deposited in {bank}', { bank: name(m.to) })
      : m.kind === 'withdraw'
        ? t('Cash withdrawn from {bank}', { bank: name(m.from) })
        : m.kind === 'transfer'
          ? t('Transfer {from} → {to}', { from: name(m.from), to: name(m.to) })
          : t('Balance corrected');
  return base + (m.note ? ` · ${m.note}` : '');
}

/* ---------- bank book ---------- */

export interface BankLine {
  date: string;
  label: string;
  /** + in, − out. */
  amount: number;
  balance: number;
  href?: string;
}

export interface BankBook {
  account: BankAccount;
  /** Balance at the start of `from`. */
  opening: number;
  lines: BankLine[];
  closing: number;
}

/** Events of one account, from its opening date (earlier money is inside the opening balance). */
function accountEvents(account: BankAccount, events: MoneyEvent[]) {
  return events.filter((e) => e.place === account.id && (!account.openingDate || e.date >= account.openingDate));
}

export async function bankBook(businessId: string, accountId: string, from: string, to: string): Promise<BankBook | null> {
  const account = await db.bankAccounts.get(accountId);
  if (!account || account.businessId !== businessId) return null;
  const events = accountEvents(account, await moneyEvents(businessId));
  let balance = account.openingBalance ?? 0;
  for (const e of events) if (e.date < from) balance += e.amount;
  const opening = balance;
  const lines: BankLine[] = [];
  for (const e of events.filter((x) => x.date >= from && x.date <= to)) {
    balance += e.amount;
    lines.push({ date: e.date, label: e.label, amount: e.amount, balance, href: e.href });
  }
  return { account, opening, lines, closing: balance };
}

export interface Balances {
  cash: number;
  accounts: { account: BankAccount; balance: number }[];
  bank: number;
}

/** Money in each account now (bank) — cash comes from the cash book (it follows day-end counts). */
export async function bankBalances(businessId: string, asOf = todayISO()): Promise<Balances['accounts']> {
  const [accounts, events] = await Promise.all([bankAccountsOf(businessId), moneyEvents(businessId)]);
  return accounts.map((account) => ({
    account,
    balance: accountEvents(account, events)
      .filter((e) => e.date <= asOf)
      .reduce((a, e) => a + e.amount, account.openingBalance ?? 0),
  }));
}

/* ---------- moves, income, loans (owner) ---------- */

const ownerOnly = (actor: Actor) => {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can do this'));
};

export async function saveMoneyMove(actor: Actor, m: Omit<MoneyMove, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'> & { id?: string }): Promise<MoneyMove> {
  ownerOnly(actor);
  if (m.kind !== 'adjust' && !(m.amount > 0)) throw new Error(t('Amount must be more than zero'));
  if (m.kind === 'adjust' && !m.amount) throw new Error(t('Amount must be more than zero'));
  if (m.kind === 'transfer' && m.from === m.to) throw new Error(t('Pick two different accounts'));
  return putRecord('moneyMoves', actor, { ...m, id: m.id ?? newId(), note: m.note?.trim() || undefined, byName: actor.userName } as MoneyMove);
}

/** Corrects an account to the balance the bank shows (adds the difference as an adjustment). */
export async function correctBalance(actor: Actor, accountId: string, actual: number, date = todayISO()): Promise<MoneyMove | null> {
  const now = (await bankBalances(actor.businessId, date)).find((b) => b.account.id === accountId)?.balance ?? 0;
  const diff = actual - now;
  if (!diff) return null;
  return saveMoneyMove(actor, { kind: 'adjust', from: null, to: accountId, amount: diff, date, note: t('Bank shows {amount}', { amount: `₹${(actual / 100).toFixed(2)}` }) });
}

export async function saveIncome(actor: Actor, i: Omit<Income, 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>): Promise<Income> {
  ownerOnly(actor);
  if (!(i.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return putRecord('incomes', actor, { ...i, from: i.from?.trim() || undefined, note: i.note?.trim() || undefined, byName: actor.userName } as Income);
}

export async function saveLoan(actor: Actor, l: Omit<Loan, 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>): Promise<Loan> {
  ownerOnly(actor);
  if (!l.name.trim()) throw new Error(t('Enter a name'));
  return putRecord('loans', actor, { ...l, name: l.name.trim() } as Loan);
}

export async function addLoanEntry(actor: Actor, e: Omit<LoanEntry, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>): Promise<LoanEntry> {
  ownerOnly(actor);
  if (!(e.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return putRecord('loanEntries', actor, { ...e, id: newId(), reference: e.reference?.trim() || undefined, note: e.note?.trim() || undefined, byName: actor.userName } as LoanEntry);
}

export interface LoanStatement {
  loan: Loan;
  rows: { entry: LoanEntry | null; date: string; label: string; amount: number; balance: number }[];
  /** Still owed (taken) or still to get back (given). */
  balance: number;
  interestPaid: number;
}

/** Principal only: interest and charges are money paid on the loan, not part of what is owed. */
export async function loanStatement(loanId: string): Promise<LoanStatement | null> {
  const loan = await db.loans.get(loanId);
  if (!loan) return null;
  const entries = (await db.loanEntries.where('loanId').equals(loanId).filter((e) => !e.deleted).toArray()).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let balance = loan.openingBalance;
  let interestPaid = 0;
  const rows: LoanStatement['rows'] = [{ entry: null, date: loan.startDate, label: t('Opening balance'), amount: loan.openingBalance, balance }];
  for (const e of entries) {
    let change = 0;
    if (e.kind === 'interest' || e.kind === 'charge') interestPaid += e.amount;
    else if (loan.kind === 'taken') change = e.kind === 'received' ? e.amount : e.kind === 'repaid' ? -e.amount : 0;
    else change = e.kind === 'given' ? e.amount : e.kind === 'received' ? -e.amount : 0;
    balance += change;
    rows.push({ entry: e, date: e.date, label: loanEntryLabel(e.kind) + (e.note ? ` · ${e.note}` : ''), amount: e.kind === 'interest' || e.kind === 'charge' ? e.amount : change, balance });
  }
  return { loan, rows, balance, interestPaid };
}

/** Kinds of entry that make sense on a loan. */
export const loanEntryKinds = (loan: Pick<Loan, 'kind'>): LoanEntry['kind'][] => (loan.kind === 'taken' ? ['repaid', 'interest', 'received', 'charge'] : ['received', 'interest', 'given']);

