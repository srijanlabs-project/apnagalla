import { addDaysISO, todayISO } from '@invoice/shared';
import { db, type Expense, type RecurringExpense } from './db';
import { t } from './i18n';
import { saveExpense } from './purchases';
import { PermissionError, newId, putRecord, type Actor } from './repo';

/**
 * R6: repeating expenses (rent each month, a weekly helper). They are never paid by themselves:
 * the Expenses screen lists what is due and one tap records it, so two phones can't pay twice
 * by accident. A due date is paid once an expense carries it in `recurringFor`.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Due dates from the start up to `until`, oldest first. */
export function dueDates(r: Pick<RecurringExpense, 'every' | 'day' | 'startDate'>, until: string): string[] {
  const out: string[] = [];
  if (r.every === 'month') {
    let [y, m] = r.startDate.split('-').map(Number) as [number, number];
    for (let i = 0; i < 240; i++) {
      const d = `${y}-${pad(m)}-${pad(Math.min(Math.max(r.day, 1), 28))}`;
      if (d > until) break;
      if (d >= r.startDate) out.push(d);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  } else {
    let d = r.startDate;
    for (let i = 0; i < 7 && new Date(`${d}T00:00:00`).getDay() !== r.day; i++) d = addDaysISO(d, 1);
    for (let i = 0; i < 520 && d <= until; i++, d = addDaysISO(d, 7)) out.push(d);
  }
  return out;
}

export interface DueExpense {
  recurring: RecurringExpense;
  /** Unpaid due dates up to today (oldest first). */
  due: string[];
  /** The next date after today. */
  next: string;
}

export async function dueExpenses(businessId: string, today = todayISO()): Promise<DueExpense[]> {
  const [list, expenses] = await Promise.all([
    db.recurringExpenses.where('businessId').equals(businessId).filter((r) => !r.deleted).toArray(),
    db.expenses.where('businessId').equals(businessId).filter((e) => !e.deleted && !!e.recurringId).toArray(),
  ]);
  return list.map((recurring) => {
    const paid = new Set(expenses.filter((e) => e.recurringId === recurring.id).map((e) => e.recurringFor));
    const due = recurring.stopped ? [] : dueDates(recurring, today).filter((d) => !paid.has(d));
    const next = dueDates(recurring, addDaysISO(today, recurring.every === 'month' ? 62 : 14)).find((d) => d > today) ?? '';
    return { recurring, due, next };
  });
}

export async function saveRecurring(actor: Actor, r: Omit<RecurringExpense, 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>): Promise<RecurringExpense> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can do this'));
  if (!(r.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return putRecord('recurringExpenses', actor, { ...r, paidTo: r.paidTo?.trim() || undefined, note: r.note?.trim() || undefined } as RecurringExpense);
}

/** Records one due date as paid (the amount may differ, e.g. this month's electricity). */
export async function payRecurring(actor: Actor, r: RecurringExpense, dueDate: string, m: { amount: number; mode: Expense['mode']; accountId?: string | null; date: string; note?: string }): Promise<Expense> {
  return saveExpense(actor, {
    id: newId(),
    category: r.category,
    amount: m.amount,
    mode: m.mode,
    accountId: m.accountId ?? r.accountId ?? null,
    date: m.date,
    paidTo: r.paidTo,
    note: m.note?.trim() || r.note,
    recurringId: r.id,
    recurringFor: dueDate,
  } as Expense);
}
