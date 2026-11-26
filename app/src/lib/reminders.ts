import { todayISO } from '@invoice/shared';
import { db, type BusinessSettings, type Customer } from './db';
import { receivables } from './khata';
import { putRecord, type Actor } from './repo';

/**
 * Payment reminders on a schedule. Each morning the app lists the customers whose money is overdue
 * and who are due a reminder (first one a set number of days after the due date, then every few
 * days, at most a few times). WhatsApp has no way for an app to send by itself, so each reminder is
 * one tap that opens the customer's chat with the message and a UPI link; the app notes when it was
 * sent. (SMS can send by itself once the store's SMS sender and DLT templates are approved.)
 */

export interface ReminderRules {
  enabled: boolean;
  /** First reminder this many days after the bill's due date. */
  afterDays: number;
  /** Then again every this many days. */
  everyDays: number;
  /** At most this many reminders for one overdue spell. */
  maxTimes: number;
  /** Only when at least this much is overdue (paise). */
  minAmount: number;
}

export const DEFAULT_REMINDERS: ReminderRules = { enabled: true, afterDays: 1, everyDays: 7, maxTimes: 4, minAmount: 10000 };
export const remindersOf = (s: Pick<BusinessSettings, 'reminders'>): ReminderRules => ({ ...DEFAULT_REMINDERS, ...(s.reminders ?? {}) });

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

export interface DueReminder {
  customer: Customer;
  balance: number;
  overdue: number;
  /** Days since the oldest unpaid due date. */
  daysLate: number;
  times: number;
}

/** Customers to remind today. */
export async function remindersDue(businessId: string, settings: BusinessSettings, today = todayISO()): Promise<DueReminder[]> {
  const r = remindersOf(settings);
  if (!r.enabled) return [];
  const owed = (await receivables(businessId)).filter((x) => x.overdue >= Math.max(1, r.minAmount) && !!x.customer.phone);
  if (!owed.length) return [];
  const bills = await db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && !!i.dueDate && i.dueDate < today).toArray();
  const out: DueReminder[] = [];
  for (const o of owed) {
    const oldest = bills.filter((b) => b.billTo?.customerId === o.customer.id).map((b) => b.dueDate!).sort()[0];
    if (!oldest) continue;
    const late = daysBetween(oldest, today);
    if (late < r.afterDays) continue;
    const last = o.customer.remindedAt?.slice(0, 10);
    // A new spell starts when the last reminder was before this overdue began.
    const times = last && last >= oldest ? (o.customer.remindCount ?? 0) : 0;
    if (times >= r.maxTimes) continue;
    if (last && last >= oldest && daysBetween(last, today) < r.everyDays) continue;
    out.push({ customer: o.customer, balance: o.balance, overdue: o.overdue, daysLate: late, times });
  }
  return out.sort((a, b) => b.overdue - a.overdue);
}

/** Notes that a reminder went to the customer today. */
export async function markReminded(actor: Actor, c: Customer, times: number): Promise<void> {
  await putRecord('customers', actor, { ...c, remindedAt: new Date().toISOString(), remindCount: times + 1 });
}
