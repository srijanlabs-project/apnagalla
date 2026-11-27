import { todayISO } from '@invoice/shared';
import { db, type BusinessSettings } from './db';

/**
 * Compulsory day-end. A day that had business (bills, payments, expenses) must be closed with a
 * cash count before the store bills on a later day. Days with no business need no closing. Days
 * before the rule started (`dayEndFrom`) are never asked for.
 */

/** Stores that had the app before this rule start being asked from this day. */
export const DAY_END_START = '2026-11-27';
export const DEFAULT_CLOSING = '21:00';
export const DEFAULT_OPENING = '09:00';

/** The day-start count is kept next to the day-ends, under its own id (it never changes the cash book). */
export const openId = (businessId: string, date: string) => `${businessId}:open:${date}`;

/** Today's day-start count, if done. */
export async function dayOpened(businessId: string, date = todayISO()) {
  const c = await db.dayCloses.get(openId(businessId, date));
  return c && !c.deleted ? c : null;
}

/** After opening time, today's cash count at the counter is not done yet. */
export async function openingDue(businessId: string, settings: BusinessSettings, now = new Date()): Promise<boolean> {
  if (!dayEndOn(settings)) return false;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm < (settings.openingTime || DEFAULT_OPENING)) return false;
  if (hhmm >= (settings.closingTime || DEFAULT_CLOSING)) return false;
  return !(await dayOpened(businessId, todayISO(now)));
}

export const dayEndOn = (s: Pick<BusinessSettings, 'dayEndRequired'>) => s.dayEndRequired !== false;

/** Days (before `before`) on which the store did business, newest first. */
async function activeDays(businessId: string, from: string, before: string): Promise<string[]> {
  const inRange = (d: string) => d >= from && d < before;
  const [inv, pays, exp] = await Promise.all([
    db.invoices.where('[businessId+date]').between([businessId, from], [businessId, before]).filter((i) => !i.deleted && i.status !== 'draft').toArray(),
    db.payments.where('businessId').equals(businessId).filter((p) => !p.deleted && inRange(p.date)).toArray(),
    db.expenses.where('businessId').equals(businessId).filter((e) => !e.deleted && inRange(e.date)).toArray(),
  ]);
  return [...new Set([...inv.map((i) => i.date), ...pays.map((p) => p.date), ...exp.map((e) => e.date)])].filter(inRange).sort().reverse();
}

const isClosed = async (businessId: string, date: string) => {
  const c = await db.dayCloses.get(`${businessId}:${date}`);
  return !!c && !c.deleted;
};

/** The day that must be closed before billing today, or null. */
export async function dayToClose(businessId: string, settings: BusinessSettings, now = new Date()): Promise<string | null> {
  if (!dayEndOn(settings)) return null;
  const from = settings.dayEndFrom || DAY_END_START;
  const last = (await activeDays(businessId, from, todayISO(now)))[0];
  if (!last) return null;
  return (await isClosed(businessId, last)) ? null : last;
}

export type DayEndMode = 'remind' | 'after2' | 'next';
export const dayEndModeOf = (s: Pick<BusinessSettings, 'dayEndMode'>): DayEndMode => s.dayEndMode ?? 'after2';

/** Past business days that are still not closed, newest first. */
export async function unclosedDays(businessId: string, settings: BusinessSettings, now = new Date()): Promise<string[]> {
  if (!dayEndOn(settings)) return [];
  const from = settings.dayEndFrom || DAY_END_START;
  const out: string[] = [];
  for (const d of await activeDays(businessId, from, todayISO(now))) if (!(await isClosed(businessId, d))) out.push(d);
  return out;
}

/**
 * Billing is stopped only when the store's rule says so: the next day, or (default) once two business
 * days are left unclosed. "Remind only" never stops billing. Returns the day to close, or null.
 */
export async function billingBlocked(businessId: string, settings: BusinessSettings, now = new Date()): Promise<{ date: string; count: number } | null> {
  const mode = dayEndModeOf(settings);
  if (mode === 'remind') return null;
  const days = await unclosedDays(businessId, settings, now);
  if (days.length >= (mode === 'next' ? 1 : 2)) return { date: days[days.length - 1]!, count: days.length };
  return null;
}

/** After closing time: today had business and isn't closed yet (a reminder, not a block). */
export async function closingDue(businessId: string, settings: BusinessSettings, now = new Date()): Promise<boolean> {
  if (!dayEndOn(settings)) return false;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm < (settings.closingTime || DEFAULT_CLOSING)) return false;
  const today = todayISO(now);
  const tomorrow = todayISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const days = await activeDays(businessId, today, tomorrow);
  return days.length > 0 && !(await isClosed(businessId, today));
}
