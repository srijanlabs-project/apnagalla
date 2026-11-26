import { Capacitor } from '@capacitor/core';
import { supplierDues } from './purchases';
import { remindersDue } from './reminders';
import { todayISO } from '@invoice/shared';
import { db } from './db';
import { rupees } from './format';
import { t } from './i18n';
import { receivables } from './khata';
import { todaySummary } from './reports';
import type { Actor } from './repo';
import { isLow, stockLevels } from './stock';
import { KEYS, kv } from './storage';

/**
 * Shop alerts on this phone, made by the phone itself (local notifications: no Google services,
 * no internet): low stock and money overdue in the morning, the day's summary at closing time.
 * The text is worked out when the app schedules them (on opening and after each change), so the
 * evening summary covers the sales made on this phone and those synced to it.
 */

export interface AlertSettings {
  lowStock: boolean;
  overdue: boolean;
  summary: boolean;
  /** "HH:MM" */
  morning: string;
  closing: string;
}

export const DEFAULT_ALERTS: AlertSettings = { lowStock: true, overdue: true, summary: true, morning: '09:30', closing: '21:00' };

/** Shop alerts use ids below this; delivery alerts are above it. */
export const SHOP_ALERT_MAX_ID = 0x10000;
const ID = { lowStock: 101, overdue: 102, summary: 103, supplierDue: 104, reminders: 105 };

export async function loadAlertSettings(): Promise<AlertSettings> {
  return { ...DEFAULT_ALERTS, ...((await kv.get<Partial<AlertSettings>>(KEYS.alerts)) ?? {}) };
}

export async function saveAlertSettings(s: AlertSettings): Promise<void> {
  await kv.set(KEYS.alerts, s);
}

/** The next time "HH:MM" comes round (today if still ahead, else tomorrow). */
export function nextAt(hhmm: string, now = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  if (at.getTime() <= now.getTime() + 30_000) at.setDate(at.getDate() + 1);
  return at;
}

export interface ShopAlert {
  id: number;
  title: string;
  body: string;
  at: Date;
}

/** What to tell this person (the owner, or staff who see reports). */
export async function shopAlerts(actor: Actor, s: AlertSettings, opts: { canSeeMoney: boolean; canSeePurchases?: boolean; storeName: string; now?: Date }): Promise<ShopAlert[]> {
  const now = opts.now ?? new Date();
  const out: ShopAlert[] = [];
  const prefix = opts.storeName ? `${opts.storeName}: ` : '';
  if (s.lowStock) {
    const [items, levels] = await Promise.all([db.items.where('businessId').equals(actor.businessId).filter((i) => !i.deleted).toArray(), stockLevels(actor.businessId)]);
    const low = items.filter((i) => isLow(i, levels.get(i.id) ?? 0));
    if (low.length) {
      const names = low.slice(0, 4).map((i) => i.name).join(', ');
      out.push({ id: ID.lowStock, title: prefix + t('{count} items low on stock', { count: low.length }), body: names + (low.length > 4 ? '…' : ''), at: nextAt(s.morning, now) });
    }
  }
  if (s.overdue && opts.canSeeMoney) {
    const late = (await receivables(actor.businessId)).filter((r) => r.overdue > 0);
    if (late.length) {
      const total = late.reduce((a, r) => a + r.overdue, 0);
      out.push({
        id: ID.overdue,
        title: prefix + t('{amount} overdue from {count} customers', { amount: rupees(total), count: late.length }),
        body: late
          .sort((a, b) => b.overdue - a.overdue)
          .slice(0, 3)
          .map((r) => `${r.customer.name} ${rupees(r.overdue)}`)
          .join(', '),
        at: nextAt(s.morning, now),
      });
    }
  }
  if (s.overdue && opts.canSeeMoney) {
    const st = await db.settings.get(actor.businessId);
    const at = nextAt(s.morning, now);
    const due = st ? await remindersDue(actor.businessId, st, todayISO(at)) : [];
    if (due.length) out.push({ id: ID.reminders, title: prefix + t('{count} payment reminders to send', { count: due.length }), body: due.slice(0, 3).map((d) => d.customer.name).join(', '), at });
  }
  if (s.overdue && opts.canSeeMoney && opts.canSeePurchases !== false) {
    const at = nextAt(s.morning, now);
    // Bills to pay by the day the alert rings (or earlier and still unpaid).
    const due = (await supplierDues(actor.businessId, todayISO(at))).filter((d) => d.daysLate >= 0);
    if (due.length) {
      out.push({
        id: ID.supplierDue,
        title: prefix + t('Pay suppliers: {amount} due on {count} bills', { amount: rupees(due.reduce((a, d) => a + d.unpaid, 0)), count: due.length }),
        body: due
          .slice(0, 3)
          .map((d) => `${d.supplierName} ${rupees(d.unpaid)}`)
          .join(', '),
        at,
      });
    }
  }
  if (s.summary && opts.canSeeMoney) {
    const at = nextAt(s.closing, now);
    const forToday = todayISO(at) === todayISO(now);
    if (forToday) {
      const d = await todaySummary(actor.businessId, false);
      out.push({
        id: ID.summary,
        title: prefix + t('Today: {amount} from {count} bills', { amount: rupees(d.sales), count: d.bills }),
        body: t('Cash {cash} · UPI {upi} · on credit {credit} · cash in drawer {drawer}', { cash: rupees(d.cash), upi: rupees(d.upi), credit: rupees(d.credit), drawer: rupees(d.cashInDrawer) }),
        at,
      });
    } else {
      out.push({ id: ID.summary, title: prefix + t('Today’s sales'), body: t('Open ApnaGalla to see the day’s sales and close the cash.'), at });
    }
  }
  return out;
}

let asked = false;

/** (Re)schedules the shop alerts. Android app only; never throws. */
export async function scheduleShopAlerts(actor: Actor, opts: { canSeeMoney: boolean; canSeePurchases?: boolean; storeName: string }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const s = await loadAlertSettings();
    const pending = (await LocalNotifications.getPending()).notifications.filter((n) => n.id < SHOP_ALERT_MAX_ID);
    if (pending.length) await LocalNotifications.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
    const list = await shopAlerts(actor, s, opts);
    if (!list.length) return;
    if (!asked) {
      asked = true;
      if ((await LocalNotifications.checkPermissions()).display !== 'granted') await LocalNotifications.requestPermissions();
    }
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    await LocalNotifications.schedule({ notifications: list.map((a) => ({ id: a.id, title: a.title, body: a.body, schedule: { at: a.at, allowWhileIdle: true } })) });
  } catch {
    // Alerts are a convenience: never break the app over them.
  }
}
