import { addDaysISO } from './dates';

/**
 * Old bills can be locked: after N days, and / or everything up to a date (the month whose GST
 * return is filed). A locked bill keeps taking payments and notes, but its lines, prices and
 * status can't change, not even by the owner (a credit note corrects it instead).
 */
export interface BillLock {
  afterDays?: number | null;
  until?: string | null;
}

/** Today's date in India (the server runs in another time zone). */
export const istToday = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export function billLocked(date: string | null | undefined, lock: BillLock | null | undefined, today: string): boolean {
  if (!date || !lock) return false;
  if (lock.until && date <= lock.until) return true;
  const days = lock.afterDays ?? 0;
  return days > 0 && date < addDaysISO(today, -days);
}
