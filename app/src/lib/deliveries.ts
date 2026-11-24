import { Capacitor } from '@capacitor/core';
import { addDaysISO, todayISO } from '@invoice/shared';
import { db, type DocBase, type Estimate, type Invoice } from './db';
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

/** Anyone may mark a delivery done (staff included, even on a saved bill). */
export async function markDelivered(actor: Actor, kind: 'invoice' | 'estimate', id: string): Promise<void> {
  const doc = kind === 'invoice' ? await db.invoices.get(id) : await db.estimates.get(id);
  if (!doc || doc.deliveredAt) return;
  const at = new Date().toISOString();
  const entry = { at, by: actor.userId, byName: actor.userName, action: 'delivered' };
  await putRecord(kind === 'invoice' ? 'invoices' : 'estimates', actor, { ...doc, deliveredAt: at, deliveredByName: actor.userName, history: [...doc.history, entry] });
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
      const who = doc.billTo?.name ?? 'customer';
      return {
        id: alertId(doc.id),
        title: 'Delivery tomorrow',
        body: `${who}${doc.number ? ` · ${kind === 'invoice' ? 'Bill' : 'Order'} ${doc.number}` : ''}${doc.deliveryAssignee ? ` · ${doc.deliveryAssignee.name}` : ''}`,
        schedule: { at, allowWhileIdle: true },
        extra: { kind, id: doc.id },
      };
    })
    .filter((n) => n.schedule.at.getTime() > now)
    .slice(0, 60); // Android keeps a limited number of scheduled alarms per app
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}
