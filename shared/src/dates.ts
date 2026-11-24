/** Dates are stored as local calendar dates "YYYY-MM-DD" (no time zone surprises). */

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d + days);
  return todayISO(dt);
}

/** Indian financial year (1 April – 31 March) label for a date: 2026-11-24 → "26-27", 2027-02-01 → "26-27". */
export function financialYearLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "2026-11-24" → "24 Nov 2026" */
export function formatDateIN(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`;
}

/** Days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = from.split('-').map(Number) as [number, number, number];
  const b = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}
