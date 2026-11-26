import { todayISO } from '@invoice/shared';
import type { MoneyEntry } from '../components/MoneyEntrySheet';
import { db, type Attendance, type AttendanceStatus, type Employee, type Expense } from './db';
import { t } from './i18n';
import { saveExpense } from './purchases';
import { newId, putRecord, type Actor } from './repo';

/**
 * Staff attendance and pay. Only absences need marking: a day not marked counts as present.
 * Monthly pay is earned per day (salary × paid days ÷ days in the month); daily pay is the day
 * rate × paid days. Money given to staff is an expense ("Salary"): an advance now, or the month's
 * salary less any advance recovered from it, so the cash book and profit stay right.
 */

export const DAY_VALUE: Record<AttendanceStatus, number> = { present: 1, half: 0.5, leave: 1, absent: 0 };
export const NEXT_STATUS: Record<AttendanceStatus, AttendanceStatus> = { present: 'absent', absent: 'half', half: 'leave', leave: 'present' };

export const attendanceId = (employeeId: string, date: string) => `${employeeId}:${date}`;
export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(y, m, 0).getDate();
};

export async function markAttendance(actor: Actor, employeeId: string, date: string, status: AttendanceStatus): Promise<void> {
  const id = attendanceId(employeeId, date);
  const cur = await db.attendance.get(id);
  if ((cur?.status ?? 'present') === status) return;
  await putRecord('attendance', actor, { ...(cur ?? {}), id, employeeId, date, status } as Attendance);
}

export interface MonthSheet {
  month: string;
  days: { date: string; status: AttendanceStatus }[];
  paidDays: number;
  earned: number;
  /** Salary paid for the month, and advance recovered from it. */
  paid: number;
  recovered: number;
  due: number;
  /** Advances given and not yet recovered (all months). */
  advanceLeft: number;
}

export async function monthSheet(businessId: string, emp: Employee, month: string, today = todayISO()): Promise<MonthSheet> {
  const total = daysInMonth(month);
  const marks = new Map(
    (await db.attendance.where('businessId').equals(businessId).filter((a) => a.employeeId === emp.id && a.date.startsWith(month) && !a.deleted).toArray()).map((a) => [a.date, a.status]),
  );
  const days: MonthSheet['days'] = [];
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (date > today) break;
    if (emp.joinDate && date < emp.joinDate) continue;
    days.push({ date, status: marks.get(date) ?? 'present' });
  }
  const paidDays = days.reduce((a, x) => a + DAY_VALUE[x.status], 0);
  const earned = emp.pay === 'day' ? Math.round(emp.rate * paidDays) : Math.round((emp.rate * paidDays) / total);
  const money = await db.expenses.where('businessId').equals(businessId).filter((e) => !e.deleted && e.employeeId === emp.id).toArray();
  const salary = money.filter((e) => e.staffKind === 'salary');
  const thisMonth = salary.filter((e) => e.month === month);
  const paid = thisMonth.reduce((a, e) => a + e.amount, 0);
  const recovered = thisMonth.reduce((a, e) => a + (e.recovered ?? 0), 0);
  const advanceLeft = money.filter((e) => e.staffKind === 'advance').reduce((a, e) => a + e.amount, 0) - salary.reduce((a, e) => a + (e.recovered ?? 0), 0);
  return { month, days, paidDays, earned, paid, recovered, due: Math.max(0, earned - paid - recovered), advanceLeft: Math.max(0, advanceLeft) };
}

export async function giveAdvance(actor: Actor, emp: Employee, m: MoneyEntry): Promise<Expense> {
  if (!(m.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return saveExpense(actor, {
    id: newId(),
    category: 'salary',
    amount: m.amount,
    mode: m.mode,
    accountId: m.accountId ?? null,
    date: m.date,
    note: t('Advance · {name}', { name: emp.name }) + (m.note?.trim() ? ` · ${m.note.trim()}` : ''),
    employeeId: emp.id,
    staffKind: 'advance',
  } as Expense);
}

/** Pays the month's salary: `m.amount` in money plus `recover` taken back from advances. */
export async function paySalary(actor: Actor, emp: Employee, month: string, m: MoneyEntry, recover: number): Promise<Expense> {
  if (!(m.amount > 0) && !(recover > 0)) throw new Error(t('Amount must be more than zero'));
  const sheet = await monthSheet(actor.businessId, emp, month);
  const take = Math.max(0, Math.min(recover, sheet.advanceLeft));
  return saveExpense(actor, {
    id: newId(),
    category: 'salary',
    amount: Math.max(0, m.amount),
    mode: m.mode,
    accountId: m.accountId ?? null,
    date: m.date,
    note: t('Salary {month} · {name}', { month, name: emp.name }) + (take ? ` · ${t('advance recovered {amount}', { amount: `₹${(take / 100).toFixed(2)}` })}` : ''),
    employeeId: emp.id,
    staffKind: 'salary',
    month,
    recovered: take || undefined,
  } as Expense);
}
