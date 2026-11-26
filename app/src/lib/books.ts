import { db, type BusinessProfile, type Journal, type Ledger, type LedgerGroup } from './db';
import { newId, PermissionError, putRecord, type Actor } from './repo';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { bankAccountsOf, accountName, incomeLabel, isBankMode } from './money';
import { expenseLabel } from './purchases';
import { invoiceGst, purchaseGst } from './reports';
import { stockLevels } from './stock';

/**
 * R7 books: double-entry accounts worked out from what the store already records (bills, returns,
 * payments, purchases, expenses, other income, loans, bank moves, day-end counts) plus the owner's
 * journal entries and own ledgers. Nothing is posted twice and nothing is stored: like stock, the
 * books are added up from the records, so they always agree with the rest of the app.
 *
 * Stock uses the trading method: opening stock (entered quantities at the item's cost) is a direct
 * expense when entered; the stock on hand at its current cost is the closing stock (an asset, and
 * taken off the cost of goods in profit and loss). Every posting has an equal and opposite one, so
 * the trial balance and the balance sheet always tally.
 */

export interface Posting {
  date: string;
  account: string;
  /** Paise: + debit, − credit. */
  amount: number;
  label: string;
  href?: string;
}

export type Side = 'asset' | 'liability' | 'capital' | 'income' | 'expense';

export interface AccountInfo {
  key: string;
  name: string;
  group: LedgerGroup | 'sundry_debtors' | 'sundry_creditors' | 'cash_bank' | 'duties_taxes' | 'stock' | 'loans_advances';
  side: Side;
}

const GROUP_SIDE: Record<AccountInfo['group'], Side> = {
  capital: 'capital',
  drawings: 'capital',
  fixed_assets: 'asset',
  current_assets: 'asset',
  deposits: 'asset',
  investments: 'asset',
  loans_advances: 'asset',
  sundry_debtors: 'asset',
  cash_bank: 'asset',
  stock: 'asset',
  current_liabilities: 'liability',
  loans_liability: 'liability',
  sundry_creditors: 'liability',
  duties_taxes: 'liability',
  direct_expenses: 'expense',
  indirect_expenses: 'expense',
  direct_incomes: 'income',
  indirect_incomes: 'income',
};

export const GROUP_LABEL: Record<AccountInfo['group'], () => string> = {
  capital: () => t('Capital'),
  drawings: () => t('Drawings'),
  fixed_assets: () => t('Fixed assets'),
  current_assets: () => t('Current assets'),
  deposits: () => t('Deposits'),
  investments: () => t('Investments'),
  loans_advances: () => t('Loans and advances given'),
  sundry_debtors: () => t('Customers (debtors)'),
  cash_bank: () => t('Cash and bank'),
  stock: () => t('Stock'),
  current_liabilities: () => t('Current liabilities'),
  loans_liability: () => t('Loans taken'),
  sundry_creditors: () => t('Suppliers (creditors)'),
  duties_taxes: () => t('Duties and taxes'),
  direct_expenses: () => t('Direct expenses'),
  indirect_expenses: () => t('Indirect expenses'),
  direct_incomes: () => t('Sales and direct income'),
  indirect_incomes: () => t('Other income'),
};

/** Groups an owner can put an own ledger in. */
export const LEDGER_GROUPS: LedgerGroup[] = [
  'capital',
  'drawings',
  'fixed_assets',
  'current_assets',
  'deposits',
  'investments',
  'current_liabilities',
  'loans_liability',
  'direct_expenses',
  'indirect_expenses',
  'direct_incomes',
  'indirect_incomes',
];

interface Ctx {
  businessId: string;
  upTo?: string;
}

/** Every posting of the store (up to a date), oldest first. */
export async function postings({ businessId, upTo }: Ctx): Promise<Posting[]> {
  const live = <T extends { deleted?: boolean }>(r: T) => !r.deleted;
  const [profile, accounts, invoices, notes, pays, purchases, sPays, expenses, incomes, loans, loanEntries, moves, closes, customers, suppliers, ledgers, journals, openings, items] = await Promise.all([
    db.profiles.get(businessId),
    bankAccountsOf(businessId),
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && live(i)).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter((n) => n.status === 'saved' && live(n)).toArray(),
    db.payments.where('businessId').equals(businessId).filter((p) => live(p) && !p.voidedAt).toArray(),
    db.purchases.where('businessId').equals(businessId).filter((p) => p.status === 'saved' && live(p)).toArray(),
    db.supplierPayments.where('businessId').equals(businessId).filter((p) => live(p) && !p.voidedAt).toArray(),
    db.expenses.where('businessId').equals(businessId).filter(live).toArray(),
    db.incomes.where('businessId').equals(businessId).filter(live).toArray(),
    db.loans.where('businessId').equals(businessId).filter(live).toArray(),
    db.loanEntries.where('businessId').equals(businessId).filter(live).toArray(),
    db.moneyMoves.where('businessId').equals(businessId).filter(live).toArray(),
    db.dayCloses.where('businessId').equals(businessId).filter(live).toArray(),
    db.customers.where('businessId').equals(businessId).filter(live).toArray(),
    db.suppliers.where('businessId').equals(businessId).filter(live).toArray(),
    db.ledgers.where('businessId').equals(businessId).filter(live).toArray(),
    db.journals.where('businessId').equals(businessId).filter(live).toArray(),
    db.stockMoves.where('businessId').equals(businessId).filter((m) => live(m) && !m.voidedAt && m.kind === 'opening').toArray(),
    db.items.where('businessId').equals(businessId).toArray(),
  ]);
  const vouchersSold = await db.vouchers.where('businessId').equals(businessId).filter((v) => !v.deleted && !v.voidedAt).toArray();
  const def = accounts[0]?.id ?? null;
  const out: Posting[] = [];
  const pair = (date: string, dr: string, cr: string, amount: number, label: string, href?: string) => {
    if (!amount) return;
    out.push({ date, account: dr, amount, label, href }, { date, account: cr, amount: -amount, label, href });
  };
  const place = (mode: string, accountId?: string | null) => (mode === 'cash' ? 'cash' : isBankMode(mode) ? `bank:${accountId || def || 'none'}` : 'othermoney');
  const invoiceOf = new Map(invoices.map((i) => [i.id, i]));
  const cust = (id?: string | null) => `cust:${id || 'walkin'}`;
  const supp = (id?: string | null) => `supp:${id || 'none'}`;
  const prof = (profile ?? {}) as BusinessProfile;

  // Opening balances.
  for (const c of customers) if (c.openingBalance) pair(c.createdAt.slice(0, 10), cust(c.id), 'opening_balance', c.openingBalance, t('Opening balance'));
  for (const s of suppliers) if (s.openingBalance) pair(s.createdAt.slice(0, 10), 'opening_balance', supp(s.id), s.openingBalance, t('Opening balance'));
  for (const b of accounts) if (b.openingBalance) pair(b.openingDate ?? b.createdAt.slice(0, 10), `bank:${b.id}`, 'opening_balance', b.openingBalance, t('Opening balance'));
  for (const l of loans) if (l.openingBalance) (l.kind === 'taken' ? pair(l.startDate, 'opening_balance', `loan:${l.id}`, l.openingBalance, t('Opening balance')) : pair(l.startDate, `loan:${l.id}`, 'opening_balance', l.openingBalance, t('Opening balance')));
  for (const l of ledgers) if (l.opening) pair(l.createdAt.slice(0, 10), `led:${l.id}`, 'opening_balance', l.opening, t('Opening balance'));
  const cost = new Map(items.map((i) => [i.id, i.purchasePrice ?? 0]));
  for (const m of openings) pair(m.date, 'opening_stock', 'opening_balance', Math.round(m.qty * (cost.get(m.itemId) ?? 0)), t('Opening stock · {item}', { item: m.itemName }));

  // Sales and returns.
  for (const inv of invoices) {
    const g = invoiceGst(inv, prof);
    const tax = g.cgst + g.sgst + g.igst;
    const label = t('Bill {number}', { number: inv.number });
    const href = `/tabs/invoices/${inv.id}`;
    out.push({ date: inv.date, account: cust(inv.billTo?.customerId), amount: inv.totals.grandTotal, label, href });
    out.push({ date: inv.date, account: 'sales', amount: -(inv.totals.grandTotal - tax - inv.totals.roundOff), label, href });
    if (g.cgst) out.push({ date: inv.date, account: 'gst:out:cgst', amount: -g.cgst, label, href });
    if (g.sgst) out.push({ date: inv.date, account: 'gst:out:sgst', amount: -g.sgst, label, href });
    if (g.igst) out.push({ date: inv.date, account: 'gst:out:igst', amount: -g.igst, label, href });
    if (inv.totals.roundOff) out.push({ date: inv.date, account: 'roundoff', amount: -inv.totals.roundOff, label, href });
  }
  for (const n of notes) {
    const g = invoiceGst(n, prof);
    const tax = g.cgst + g.sgst + g.igst;
    const label = t('Return {number}', { number: n.number });
    const href = `/tabs/credit-notes/${n.id}`;
    out.push({ date: n.date, account: cust(n.billTo?.customerId), amount: -n.totals.grandTotal, label, href });
    out.push({ date: n.date, account: 'sales', amount: n.totals.grandTotal - tax - n.totals.roundOff, label, href });
    if (g.cgst) out.push({ date: n.date, account: 'gst:out:cgst', amount: g.cgst, label, href });
    if (g.sgst) out.push({ date: n.date, account: 'gst:out:sgst', amount: g.sgst, label, href });
    if (g.igst) out.push({ date: n.date, account: 'gst:out:igst', amount: g.igst, label, href });
    if (n.totals.roundOff) out.push({ date: n.date, account: 'roundoff', amount: n.totals.roundOff, label, href });
  }

  // Money received and refunds.
  for (const p of pays) {
    // Moving money inside a customer's account (advance used, credit note used) changes nothing.
    if (p.mode === 'advance' || p.mode === 'creditnote') continue;
    const party = cust(p.invoiceId ? invoiceOf.get(p.invoiceId)?.billTo?.customerId : p.customerId);
    const label = p.kind === 'refund' ? t('Refund') : p.mode === 'points' ? t('Loyalty points used') : t('Received');
    const href = p.invoiceId ? `/tabs/invoices/${p.invoiceId}` : undefined;
    if (p.mode === 'voucher') {
      p.kind === 'refund' ? pair(p.date, party, 'vouchers', p.amount, t('Gift voucher'), href) : pair(p.date, 'vouchers', party, p.amount, t('Gift voucher used'), href);
      continue;
    }
    if (p.mode === 'buyback') {
      p.kind === 'refund' ? pair(p.date, party, 'purchases', p.amount, t('Old item taken back'), href) : pair(p.date, 'purchases', party, p.amount, t('Old item taken back'), href);
      continue;
    }
    if (p.mode === 'points') {
      p.kind === 'refund' ? pair(p.date, party, 'exp:loyalty', p.amount, label, href) : pair(p.date, 'exp:loyalty', party, p.amount, label, href);
      continue;
    }
    const where = place(p.mode, p.accountId);
    if (p.mode === 'cheque' && p.kind === 'payment') {
      pair(p.date, 'cheques', party, p.amount, label, href);
      if (p.chequeStatus === 'cleared') pair((p.chequeClearedAt ?? p.date).slice(0, 10), where, 'cheques', p.amount, t('Cheque cleared'), href);
      continue;
    }
    p.kind === 'refund' ? pair(p.date, party, where, p.amount, label, href) : pair(p.date, where, party, p.amount, label, href);
  }

  // Purchases, returns to suppliers, supplier payments.
  for (const pu of purchases) {
    const g = purchaseGst(pu);
    const tax = g.cgst + g.sgst + g.igst;
    const sign = pu.kind === 'return' ? -1 : 1;
    const label = pu.kind === 'return' ? t('Purchase return {ref}', { ref: pu.supplierBillNo }) : t('Purchase {ref}', { ref: pu.supplierBillNo });
    const href = `/tabs/purchases/${pu.id}`;
    out.push({ date: pu.date, account: supp(pu.supplier?.supplierId), amount: -sign * pu.totals.grandTotal, label, href });
    out.push({ date: pu.date, account: 'purchases', amount: sign * (pu.totals.grandTotal - tax - pu.totals.roundOff), label, href });
    if (g.cgst) out.push({ date: pu.date, account: 'gst:in:cgst', amount: sign * g.cgst, label, href });
    if (g.sgst) out.push({ date: pu.date, account: 'gst:in:sgst', amount: sign * g.sgst, label, href });
    if (g.igst) out.push({ date: pu.date, account: 'gst:in:igst', amount: sign * g.igst, label, href });
    if (pu.totals.roundOff) out.push({ date: pu.date, account: 'roundoff', amount: sign * pu.totals.roundOff, label, href });
  }
  for (const p of sPays) {
    const label = p.kind === 'refund' ? t('Refund from supplier') : t('Paid to supplier');
    p.kind === 'refund' ? pair(p.date, place(p.mode, p.accountId), supp(p.supplierId), p.amount, label) : pair(p.date, supp(p.supplierId), place(p.mode, p.accountId), p.amount, label);
  }

  // Expenses and other income.
  for (const e of expenses) pair(e.date, `exp:${e.category}`, place(e.mode, e.accountId), e.amount, expenseLabel(e.category) + (e.paidTo ? ` · ${e.paidTo}` : ''), '/tabs/expenses');
  for (const i of incomes) pair(i.date, place(i.mode, i.accountId), `inc:${i.category}`, i.amount, incomeLabel(i.category) + (i.from ? ` · ${i.from}` : ''), '/tabs/income');

  // Loans.
  const loanOf = new Map(loans.map((l) => [l.id, l]));
  for (const e of loanEntries) {
    const loan = loanOf.get(e.loanId);
    if (!loan) continue;
    const L = `loan:${loan.id}`;
    const P = place(e.mode, e.accountId);
    const label = `${loan.name}`;
    const href = `/tabs/loans/${loan.id}`;
    if (e.kind === 'received') pair(e.date, P, L, e.amount, label, href);
    else if (e.kind === 'repaid' || e.kind === 'given') pair(e.date, L, P, e.amount, label, href);
    else if (e.kind === 'interest') loan.kind === 'given' ? pair(e.date, P, 'inc:interest', e.amount, label, href) : pair(e.date, 'exp:interest', P, e.amount, label, href);
    else pair(e.date, 'exp:bank_charges', P, e.amount, label, href);
  }

  for (const v of vouchersSold) pair(v.date, place(v.mode, null), 'vouchers', v.amount, t('Gift voucher sold {code}', { code: v.code }), '/tabs/vouchers');

  // Cash ↔ bank, corrections, day-end differences.
  const node = (x: string | null) => (x === 'cash' ? 'cash' : x ? `bank:${x}` : 'othermoney');
  for (const m of moves) {
    if (m.kind === 'adjust') {
      m.amount > 0 ? pair(m.date, node(m.to), 'suspense', m.amount, t('Balance correction'), '/tabs/bank') : pair(m.date, 'suspense', node(m.to), -m.amount, t('Balance correction'), '/tabs/bank');
      continue;
    }
    pair(m.date, node(m.to), node(m.from), m.amount, t('Money moved'), '/tabs/bank');
  }
  for (const c of closes) if (c.difference) c.difference > 0 ? pair(c.date, 'cash', 'cash_diff', c.difference, t('Cash excess at day end')) : pair(c.date, 'cash_diff', 'cash', -c.difference, t('Cash short at day end'));

  // Journal entries.
  for (const j of journals) for (const l of j.lines) out.push({ date: j.date, account: l.account, amount: (l.debit || 0) - (l.credit || 0), label: j.note || t('Journal'), href: `/tabs/books/journal/${j.id}` });

  return out.filter((p) => !upTo || p.date <= upTo).sort((a, b) => a.date.localeCompare(b.date));
}

/** Closing stock at cost on a date: an asset, and taken off the cost of goods in P&L. */
export async function closingStock(businessId: string, asOf: string): Promise<number> {
  const [levels, items] = await Promise.all([stockLevels(businessId, asOf), db.items.where('businessId').equals(businessId).toArray()]);
  return items.reduce((a, i) => a + Math.max(0, levels.get(i.id) ?? 0) * (i.purchasePrice ?? 0), 0);
}

/** Name, group and side of an account key. */
export async function accountBook(businessId: string): Promise<(key: string) => AccountInfo> {
  const [accounts, customers, suppliers, loans, ledgers] = await Promise.all([
    bankAccountsOf(businessId),
    db.customers.where('businessId').equals(businessId).toArray(),
    db.suppliers.where('businessId').equals(businessId).toArray(),
    db.loans.where('businessId').equals(businessId).toArray(),
    db.ledgers.where('businessId').equals(businessId).toArray(),
  ]);
  const cName = new Map(customers.map((c) => [c.id, c.name]));
  const sName = new Map(suppliers.map((s) => [s.id, s.name]));
  const loanOf = new Map(loans.map((l) => [l.id, l]));
  const ledOf = new Map<string, Ledger>(ledgers.map((l) => [l.id, l]));
  const bank = new Map(accounts.map((a) => [a.id, accountName(a)]));
  const mk = (key: string, name: string, group: AccountInfo['group']): AccountInfo => ({ key, name, group, side: GROUP_SIDE[group] });
  return (key: string) => {
    const [kind, id = ''] = key.split(/:(.*)/s) as [string, string?];
    switch (kind) {
      case 'cash':
        return mk(key, t('Cash in hand'), 'cash_bank');
      case 'bank':
        return mk(key, bank.get(id) ?? t('Bank'), 'cash_bank');
      case 'cheques':
        return mk(key, t('Cheques not yet cleared'), 'current_assets');
      case 'othermoney':
        return mk(key, t('Money in other modes'), 'current_assets');
      case 'cust':
        return mk(key, id === 'walkin' ? t('Walk-in customers') : (cName.get(id) ?? t('Customer')), 'sundry_debtors');
      case 'supp':
        return mk(key, id === 'none' ? t('Purchases without a supplier') : (sName.get(id) ?? t('Supplier')), 'sundry_creditors');
      case 'gst':
        return mk(key, `${id.startsWith('out') ? t('Output') : t('Input')} ${id.split(':')[1]?.toUpperCase() ?? ''}`, id.startsWith('out') ? 'duties_taxes' : 'current_assets');
      case 'loan': {
        const l = loanOf.get(id);
        return mk(key, l?.name ?? t('Loan'), l?.kind === 'given' ? 'loans_advances' : 'loans_liability');
      }
      case 'led': {
        const l = ledOf.get(id);
        return mk(key, l?.name ?? t('Ledger'), l?.group ?? 'current_assets');
      }
      case 'exp':
        return mk(key, id === 'loyalty' ? t('Loyalty points used') : id === 'interest' ? t('Interest paid') : id === 'bank_charges' ? t('Bank and loan charges') : expenseLabel(id), 'indirect_expenses');
      case 'inc':
        return mk(key, incomeLabel(id), 'indirect_incomes');
      case 'sales':
        return mk(key, t('Sales'), 'direct_incomes');
      case 'purchases':
        return mk(key, t('Purchases'), 'direct_expenses');
      case 'opening_stock':
        return mk(key, t('Opening stock'), 'direct_expenses');
      case 'closing_stock':
        return mk(key, t('Closing stock'), 'stock');
      case 'stock_change':
        return mk(key, t('Closing stock (taken off cost)'), 'direct_incomes');
      case 'roundoff':
        return mk(key, t('Round off'), 'indirect_expenses');
      case 'vouchers':
        return mk(key, t('Gift vouchers not yet used'), 'current_liabilities');
      case 'cash_diff':
        return mk(key, t('Cash short / excess'), 'indirect_expenses');
      case 'suspense':
        return mk(key, t('Balance corrections'), 'indirect_expenses');
      case 'opening_balance':
        return mk(key, t('Opening balances'), 'capital');
      case 'capital':
        return mk(key, t('Owner’s capital'), 'capital');
      case 'drawings':
        return mk(key, t('Owner’s drawings'), 'drawings');
      default:
        return mk(key, key, 'current_assets');
    }
  };
}

export interface Balance {
  info: AccountInfo;
  /** + debit, − credit. */
  balance: number;
}

/** Every account's balance on a date, with closing stock posted (so it tallies). */
export async function trialBalance(businessId: string, asOf: string): Promise<Balance[]> {
  const [ps, stock, infoOf] = await Promise.all([postings({ businessId, upTo: asOf }), closingStock(businessId, asOf), accountBook(businessId)]);
  const m = new Map<string, number>();
  for (const p of ps) m.set(p.account, (m.get(p.account) ?? 0) + p.amount);
  if (stock) {
    m.set('closing_stock', (m.get('closing_stock') ?? 0) + stock);
    m.set('stock_change', (m.get('stock_change') ?? 0) - stock);
  }
  return [...m.entries()]
    .filter(([, v]) => Math.round(v) !== 0)
    .map(([k, v]) => ({ info: infoOf(k), balance: Math.round(v) }))
    .sort((a, b) => a.info.side.localeCompare(b.info.side) || a.info.group.localeCompare(b.info.group) || a.info.name.localeCompare(b.info.name));
}

/** One account: balance brought forward, each posting in the period, balance at the end. */
export async function ledgerOf(businessId: string, account: string, from: string, to: string) {
  const ps = (await postings({ businessId, upTo: to })).filter((p) => p.account === account);
  const before = ps.filter((p) => p.date < from).reduce((a, p) => a + p.amount, 0);
  let run = before;
  const rows = ps.filter((p) => p.date >= from).map((p) => ({ ...p, balance: (run += p.amount) }));
  return { opening: before, rows, closing: run, info: (await accountBook(businessId))(account) };
}

/** Saves a journal entry (owner): at least two lines, debits equal credits, no line both. */
export async function saveJournal(actor: Actor, j: Journal): Promise<Journal> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can do this'));
  const lines = j.lines.filter((l) => l.account && (l.debit > 0 || l.credit > 0)).map((l) => ({ account: l.account, debit: Math.round(l.debit || 0), credit: Math.round(l.credit || 0) }));
  if (lines.length < 2) throw new Error(t('A journal needs at least two lines'));
  if (lines.some((l) => l.debit > 0 && l.credit > 0)) throw new Error(t('A line is either a debit or a credit'));
  const dr = lines.reduce((a, l) => a + l.debit, 0);
  const cr = lines.reduce((a, l) => a + l.credit, 0);
  if (dr !== cr) throw new Error(t('Debits and credits must be equal'));
  return putRecord('journals', actor, { ...j, lines });
}

/** Owner put money into the business (capital) or took some out (drawings). */
export async function ownerMoney(actor: Actor, kind: 'capital' | 'drawings', amount: number, place: string, date: string, note?: string): Promise<Journal> {
  const lines =
    kind === 'capital'
      ? [
          { account: place, debit: amount, credit: 0 },
          { account: 'capital', debit: 0, credit: amount },
        ]
      : [
          { account: 'drawings', debit: amount, credit: 0 },
          { account: place, debit: 0, credit: amount },
        ];
  return saveJournal(actor, { id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', date, lines, kind, note: note || (kind === 'capital' ? t('Owner put money in') : t('Owner took money out')) });
}

const drcr = (v: number) => (v >= 0 ? [v, null] : [null, -v]);

export async function trialBalanceTable(businessId: string, asOf: string): Promise<ExportTable> {
  const tb = await trialBalance(businessId, asOf);
  const rows = tb.map((b) => [GROUP_LABEL[b.info.group](), b.info.name, ...drcr(b.balance)]);
  const dr = tb.reduce((a, b) => a + Math.max(0, b.balance), 0);
  const cr = tb.reduce((a, b) => a + Math.max(0, -b.balance), 0);
  return {
    title: t('Trial balance'),
    subtitle: [t('As on {date}', { date: asOf.split('-').reverse().join('/') })],
    columns: [{ label: t('Group') }, { label: t('Account') }, { label: t('Debit'), kind: 'money' }, { label: t('Credit'), kind: 'money' }],
    rows,
    foot: [[t('Total'), '', dr, cr]],
    fileBase: `Trial-balance-${asOf}`,
  };
}

/** Balance sheet on a date; the year's profit is worked out from the same books. */
export async function balanceSheet(businessId: string, asOf: string) {
  const tb = await trialBalance(businessId, asOf);
  const profit = -tb.filter((b) => b.info.side === 'income' || b.info.side === 'expense').reduce((a, b) => a + b.balance, 0);
  const liabilities: { group: string; name: string; amount: number }[] = [];
  const assets: { group: string; name: string; amount: number }[] = [];
  for (const b of tb) {
    if (b.info.side === 'income' || b.info.side === 'expense') continue;
    // A customer who paid in advance is a liability; a supplier paid ahead is an asset.
    if (b.balance > 0) assets.push({ group: GROUP_LABEL[b.info.group](), name: b.info.name, amount: b.balance });
    else liabilities.push({ group: b.info.side === 'capital' ? GROUP_LABEL.capital() : b.info.group === 'sundry_debtors' ? t('Advances from customers') : GROUP_LABEL[b.info.group](), name: b.info.name, amount: -b.balance });
  }
  if (profit) liabilities.push({ group: GROUP_LABEL.capital(), name: profit >= 0 ? t('Profit so far') : t('Loss so far'), amount: profit });
  const totalL = liabilities.reduce((a, r) => a + r.amount, 0);
  const totalA = assets.reduce((a, r) => a + r.amount, 0);
  return { liabilities, assets, totalL, totalA, profit };
}

export async function balanceSheetTable(businessId: string, asOf: string): Promise<ExportTable> {
  const bs = await balanceSheet(businessId, asOf);
  const sortG = (x: { group: string; name: string }, y: { group: string; name: string }) => x.group.localeCompare(y.group) || x.name.localeCompare(y.name);
  const rows = [
    [t('LIABILITIES AND CAPITAL'), '', null],
    ...bs.liabilities.sort(sortG).map((r) => [r.group, r.name, r.amount]),
    [t('Total'), '', bs.totalL],
    ['', '', null],
    [t('ASSETS'), '', null],
    ...bs.assets.sort(sortG).map((r) => [r.group, r.name, r.amount]),
    [t('Total'), '', bs.totalA],
  ];
  return {
    title: t('Balance sheet'),
    subtitle: [t('As on {date}', { date: asOf.split('-').reverse().join('/') }), t('Stock at current cost. Check with your CA before filing.')],
    columns: [{ label: t('Group') }, { label: t('Account') }, { label: t('Amount'), kind: 'money' }],
    rows,
    fileBase: `Balance-sheet-${asOf}`,
  };
}

/** Accounts for a journal line picker: system ones in use plus own ledgers. */
export async function pickableAccounts(businessId: string, asOf: string): Promise<AccountInfo[]> {
  const infoOf = await accountBook(businessId);
  const [ps, ledgers, banks] = await Promise.all([postings({ businessId, upTo: asOf }), db.ledgers.where('businessId').equals(businessId).filter((l) => !l.deleted).toArray(), bankAccountsOf(businessId)]);
  const keys = new Set<string>(['cash', 'capital', 'drawings', 'suspense', ...banks.map((b) => `bank:${b.id}`), ...ledgers.map((l) => `led:${l.id}`), ...ps.map((p) => p.account)]);
  keys.delete('closing_stock');
  keys.delete('stock_change');
  return [...keys].map(infoOf).sort((a, b) => a.name.localeCompare(b.name));
}
