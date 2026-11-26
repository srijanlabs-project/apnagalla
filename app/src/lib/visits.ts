import { todayISO } from '@invoice/shared';
import { db, type Customer, type Visit } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { newId, putRecord, type Actor } from './repo';

/**
 * R10 field sales. A salesperson checks in at a customer; the phone notes where they are (when the
 * phone allows location), then they take an order, collect money or note why not. The owner sees
 * every visit by day and person, with a map link. Location is asked for only at check-in; the app
 * never tracks anyone in the background.
 */

export function currentPlace(timeoutMs = 10_000): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

export async function checkIn(actor: Actor, customer: Pick<Customer, 'id' | 'name'>, place: { lat: number; lng: number; accuracy: number } | null): Promise<Visit> {
  const now = new Date();
  return putRecord('visits', actor, {
    id: newId(),
    customerId: customer.id,
    customerName: customer.name,
    date: todayISO(now),
    at: now.toISOString(),
    ...(place ?? {}),
    byUserId: actor.userId,
    byName: actor.userName,
  } as Visit);
}

export const setOutcome = (actor: Actor, v: Visit, outcome: Visit['outcome'], extra: Partial<Visit> = {}) => putRecord('visits', actor, { ...v, outcome, ...extra });

export const mapLink = (v: Pick<Visit, 'lat' | 'lng'>) => (v.lat != null && v.lng != null ? `https://www.google.com/maps?q=${v.lat},${v.lng}` : null);

export const outcomeLabel = (o?: Visit['outcome']) =>
  o ? { order: () => t('Order taken'), payment: () => t('Money collected'), no_order: () => t('No order'), closed: () => t('Shop closed') }[o]() : t('Visited');

/** Visits in a period, newest first; staff see their own. */
export async function visitsIn(businessId: string, from: string, to: string, byUserId?: string | null): Promise<Visit[]> {
  const list = await db.visits.where('[businessId+date]').between([businessId, from], [businessId, to], true, true).filter((v) => !v.deleted && (!byUserId || v.byUserId === byUserId)).toArray();
  return list.sort((a, b) => b.at.localeCompare(a.at));
}

/** Visits report: per person per day — visits, orders, value ordered. */
export async function visitsTable(businessId: string, from: string, to: string): Promise<ExportTable> {
  const list = await visitsIn(businessId, from, to);
  const orders = new Map((await db.estimates.where('businessId').equals(businessId).toArray()).map((e) => [e.id, e]));
  const rows = list
    .slice()
    .reverse()
    .map((v) => [v.date, v.at.slice(11, 16), v.byName, v.customerName, outcomeLabel(v.outcome), v.orderId ? (orders.get(v.orderId)?.totals.grandTotal ?? null) : null, mapLink(v) ?? '', v.note ?? '']);
  return {
    title: t('Field visits'),
    subtitle: [`${from.split('-').reverse().join('/')} – ${to.split('-').reverse().join('/')}`],
    landscape: true,
    columns: [{ label: t('Date'), kind: 'date' }, { label: t('Time') }, { label: t('Person') }, { label: t('Customer') }, { label: t('Result') }, { label: t('Order value'), kind: 'money' }, { label: t('Map') }, { label: t('Note') }],
    rows,
    foot: [[t('Total'), '', '', String(rows.length), '', rows.reduce((a, r) => a + ((r[5] as number) ?? 0), 0), '', '']],
    fileBase: `Field-visits-${from}-${to}`,
  };
}
