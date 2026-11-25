import { Capacitor } from '@capacitor/core';
import { addDaysISO, todayISO } from '@invoice/shared';
import { db, type DocBase, type Estimate, type Invoice } from './db';
import { t } from './i18n';
import { putRecord, type Actor } from './repo';

/** A bill or estimate (job-work order) with a delivery date, not yet delivered. */
export interface DeliveryDue {
  kind: 'invoice' | 'estimate';
  doc: Invoice | Estimate;
  when: 'overdue' | 'today' | 'tomorrow' | 'later';
}

const open = (d: DocBase & { status: string }) => !d.deleted && !d.deliveredAt && !!d.deliveryDate && d.status !== 'cancelled' && d.status !== 'declined' && d.status !== 'converted';

/** Deliveries this person should see: the owner sees all; staff see those assigned to them or to nobody. */
export async function deliveriesFor(actor: Actor, today = todayISO()): Promise<DeliveryDue[]> {
  const mine = (d: DocBase) => actor.role === 'owner' || !d.deliveryAssignee || d.deliveryAssignee.userId === actor.userId;
  const tomorrow = addDaysISO(today, 1);
  const [invoices, estimates] = await Promise.all([
    db.invoices.where('businessId').equals(actor.businessId).filter((d) => open(d) && mine(d)).toArray(),
    db.estimates.where('businessId').equals(actor.businessId).filter((d) => open(d) && mine(d)).toArray(),
  ]);
  const when = (date: string): DeliveryDue['when'] => (date < today ? 'overdue' : date === today ? 'today' : date === tomorrow ? 'tomorrow' : 'later');
  return [
    ...invoices.map((doc) => ({ kind: 'invoice' as const, doc, when: when(doc.deliveryDate!) })),
    ...estimates.map((doc) => ({ kind: 'estimate' as const, doc, when: when(doc.deliveryDate!) })),
  ].sort((a, b) => a.doc.deliveryDate!.localeCompare(b.doc.deliveryDate!));
}

/** Anyone may mark a delivery done (staff included, even on a saved bill); the warehouse adds a photo. */
export async function markDelivered(actor: Actor, kind: 'invoice' | 'estimate', id: string, photo?: string): Promise<void> {
  const doc = kind === 'invoice' ? await db.invoices.get(id) : await db.estimates.get(id);
  if (!doc || doc.deliveredAt) return;
  if (actor.access === 'warehouse' && !photo) throw new Error(t('Take a photo of the goods first'));
  const at = new Date().toISOString();
  const entry = { at, by: actor.userId, byName: actor.userName, action: 'delivered' };
  await putRecord(kind === 'invoice' ? 'invoices' : 'estimates', actor, {
    ...doc,
    deliveredAt: at,
    deliveredByName: actor.userName,
    ...(photo ? { deliveryPhoto: photo } : {}),
    history: [...doc.history, entry],
  });
}

export interface WarehouseRow {
  kind: 'invoice' | 'estimate';
  doc: Invoice | Estimate;
}

/**
 * The warehouse list: saved bills and delivery challans still to deliver (those with a delivery
 * date, every challan, and with `recentDays` every bill of those last days), or those delivered
 * in the last 30 days.
 */
export async function warehouseList(businessId: string, opts: { delivered: boolean; recentDays?: number; today?: string }): Promise<WarehouseRow[]> {
  const today = opts.today ?? todayISO();
  const since = addDaysISO(today, -(opts.delivered ? 30 : (opts.recentDays ?? 0)));
  const live = (d: DocBase & { status: string }) => !d.deleted && d.status !== 'draft' && d.status !== 'cancelled' && d.status !== 'declined';
  const want = (d: DocBase & { status: string; challan?: boolean }) => {
    if (opts.delivered) return !!d.deliveredAt && d.deliveredAt.slice(0, 10) >= since;
    if (d.deliveredAt) return false;
    return !!d.deliveryDate || !!d.challan || (!!opts.recentDays && d.date >= since);
  };
  const [invoices, estimates] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((d) => live(d) && want(d)).toArray(),
    db.estimates
      .where('businessId')
      .equals(businessId)
      // Estimates count only as challans or job-work orders with a delivery date (not converted).
      .filter((d) => live(d) && d.status !== 'converted' && (!!d.challan || !!d.deliveryDate) && want(d))
      .toArray(),
  ]);
  const rows: WarehouseRow[] = [...invoices.map((doc) => ({ kind: 'invoice' as const, doc })), ...estimates.map((doc) => ({ kind: 'estimate' as const, doc }))];
  const key = (r: WarehouseRow) => (opts.delivered ? r.doc.deliveredAt ?? '' : r.doc.deliveryDate ?? r.doc.date);
  return rows.sort((a, b) => (opts.delivered ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b))));
}

/* ---------- phone alerts ---------- */

/** Stable notification id (positive 31-bit) for a document. */
function alertId(docId: string): number {
  let h = 0;
  for (let i = 0; i < docId.length; i++) h = (Math.imul(31, h) + docId.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

let asked = false;

/**
 * Schedules a phone notification the day before each delivery, at the store's alert time
 * (default 9:00), for this person's deliveries in the current store. Runs offline (local
 * notifications, no Google services). Replaces earlier schedules. Android app only.
 */
export async function scheduleDeliveryAlerts(actor: Actor, alertTime: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if (!asked) {
    asked = true;
    const p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') await LocalNotifications.requestPermissions();
  }
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });

  const [hh, mm] = (alertTime || '09:00').split(':').map(Number) as [number, number];
  const now = Date.now();
  const list = (await deliveriesFor(actor)).filter((d) => d.when === 'tomorrow' || d.when === 'later');
  const notifications = list
    .map(({ kind, doc }) => {
      const [y, m, d] = addDaysISO(doc.deliveryDate!, -1).split('-').map(Number) as [number, number, number];
      const at = new Date(y, m - 1, d, hh, mm);
      const who = doc.billTo?.name ?? t('customer');
      return {
        id: alertId(doc.id),
        title: t('Delivery tomorrow'),
        body: `${who}${doc.number ? ` · ${kind === 'invoice' ? t('Bill {number}', { number: doc.number }) : t('Order {number}', { number: doc.number })}` : ''}${doc.deliveryAssignee ? ` · ${doc.deliveryAssignee.name}` : ''}`,
        schedule: { at, allowWhileIdle: true },
        extra: { kind, id: doc.id },
      };
    })
    .filter((n) => n.schedule.at.getTime() > now)
    .slice(0, 60); // Android keeps a limited number of scheduled alarms per app
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}
