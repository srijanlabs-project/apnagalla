import { db, type Estimate, type Invoice } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { newId, newInvoiceDraft, saveInvoice, type Actor } from './repo';

/**
 * Sales orders: the customer orders now, goods go in one or more bills later. An order is an
 * estimate marked `order`, with its own SO number series. Each bill made from it carries
 * `fromEstimateId` and, per line, `fromLineId`, so what was delivered and what is still pending is
 * worked out from the saved bills (cancelled ones don't count). Orders don't move stock; bills do.
 */

export interface OrderLine {
  lineId: string;
  itemId?: string | null;
  name: string;
  unit: string;
  rate: number;
  ordered: number;
  delivered: number;
  pending: number;
}

export interface OrderProgress {
  order: Estimate;
  lines: OrderLine[];
  state: 'open' | 'part' | 'done' | 'closed';
  bills: Invoice[];
  /** Value of what is still to deliver (rate × pending, before tax). */
  pendingValue: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export async function orderProgress(order: Estimate): Promise<OrderProgress> {
  const bills = await db.invoices.where('businessId').equals(order.businessId).filter((i) => i.fromEstimateId === order.id && !i.deleted && i.status !== 'cancelled').toArray();
  const saved = bills.filter((b) => b.status === 'saved');
  const lines = order.lines.map((l) => {
    const delivered = round3(saved.reduce((a, b) => a + b.lines.filter((x) => x.fromLineId === l.id).reduce((s, x) => s + x.qty, 0), 0));
    return { lineId: l.id, itemId: l.itemId, name: l.name, unit: l.unit, rate: l.rate, ordered: l.qty, delivered, pending: Math.max(0, round3(l.qty - delivered)) };
  });
  const anyDelivered = lines.some((l) => l.delivered > 0);
  const allDone = lines.every((l) => l.pending <= 0);
  const state = order.status === 'declined' ? 'closed' : allDone ? 'done' : anyDelivered ? 'part' : 'open';
  return { order, lines, state, bills, pendingValue: Math.round(lines.reduce((a, l) => a + l.pending * l.rate, 0)) };
}

export const orderStateLabel = (s: OrderProgress['state']) =>
  ({ open: () => t('Not delivered'), part: () => t('Part delivered'), done: () => t('Delivered'), closed: () => t('Closed') })[s]();

/** A bill draft for everything still pending on the order (change the quantities for a part delivery). */
export async function billFromOrder(actor: Actor, orderId: string): Promise<Invoice> {
  const order = await db.estimates.get(orderId);
  if (!order?.order) throw new Error(t('Order not found'));
  const p = await orderProgress(order);
  const pending = new Map(p.lines.map((l) => [l.lineId, l.pending]));
  const lines = order.lines.filter((l) => (pending.get(l.id) ?? 0) > 0).map((l) => ({ ...l, id: newId(), qty: pending.get(l.id)!, fromLineId: l.id }));
  if (!lines.length) throw new Error(t('Everything on this order is already billed'));
  const draft = await newInvoiceDraft(actor);
  return saveInvoice(
    actor,
    {
      ...draft,
      reference: t('Order {number}', { number: order.number }),
      taxMode: order.taxMode ?? draft.taxMode,
      placeOfSupply: order.placeOfSupply ?? null,
      billTo: order.billTo,
      shipTo: order.shipTo,
      lines,
      charges: [],
      roundOff: order.roundOff,
      notes: order.notes,
      terms: order.terms,
      fromEstimateId: order.id,
    },
    { finalize: false },
  );
}

/** Open orders (not fully delivered, not closed). */
export async function openOrders(businessId: string): Promise<OrderProgress[]> {
  const orders = await db.estimates.where('businessId').equals(businessId).filter((e) => !!e.order && !e.deleted && e.status !== 'draft' && e.status !== 'declined').toArray();
  const all = await Promise.all(orders.map(orderProgress));
  return all.filter((p) => p.state === 'open' || p.state === 'part').sort((a, b) => a.order.date.localeCompare(b.order.date));
}

/** Pending orders report: every open order line still to deliver. */
export async function pendingOrdersTable(businessId: string): Promise<ExportTable> {
  const open = await openOrders(businessId);
  const rows = open.flatMap((p) =>
    p.lines.filter((l) => l.pending > 0).map((l) => [p.order.date, p.order.number, p.order.billTo?.name ?? '', l.name, l.ordered, l.delivered, l.pending, l.unit, Math.round(l.pending * l.rate)]),
  );
  return {
    title: t('Pending orders'),
    subtitle: [t('{count} orders', { count: open.length })],
    landscape: true,
    columns: [
      { label: t('Date'), kind: 'date' },
      { label: t('Order') },
      { label: t('Customer') },
      { label: t('Item') },
      { label: t('Ordered'), kind: 'qty' },
      { label: t('Delivered'), kind: 'qty' },
      { label: t('Pending'), kind: 'qty' },
      { label: t('Unit') },
      { label: t('Pending value'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', '', '', '', '', '', '', rows.reduce((a, r) => a + (r[8] as number), 0)]],
    fileBase: 'Pending-orders',
  };
}

/** Item-wise order report: per item, what open orders still need (to plan stock). */
export async function orderItemsTable(businessId: string): Promise<ExportTable> {
  const open = await openOrders(businessId);
  const m = new Map<string, { name: string; unit: string; ordered: number; delivered: number; pending: number; orders: number; value: number }>();
  for (const p of open)
    for (const l of p.lines) {
      if (l.pending <= 0) continue;
      const key = `${l.name}|${l.unit}`;
      const s = m.get(key) ?? (m.set(key, { name: l.name, unit: l.unit, ordered: 0, delivered: 0, pending: 0, orders: 0, value: 0 }), m.get(key)!);
      s.ordered += l.ordered;
      s.delivered += l.delivered;
      s.pending += l.pending;
      s.orders += 1;
      s.value += Math.round(l.pending * l.rate);
    }
  const rows = [...m.values()].sort((a, b) => b.value - a.value).map((s) => [s.name, s.orders, round3(s.ordered), round3(s.delivered), round3(s.pending), s.unit, s.value]);
  return {
    title: t('Items on order'),
    columns: [
      { label: t('Item') },
      { label: t('Orders'), kind: 'qty' },
      { label: t('Ordered'), kind: 'qty' },
      { label: t('Delivered'), kind: 'qty' },
      { label: t('Pending'), kind: 'qty' },
      { label: t('Unit') },
      { label: t('Pending value'), kind: 'money' },
    ],
    rows,
    foot: [[t('Total'), '', '', '', '', '', rows.reduce((a, r) => a + (r[6] as number), 0)]],
    fileBase: 'Items-on-order',
  };
}

/** R11 booked stock: what open sales orders still have to deliver, per item (base units). */
export async function bookedQty(businessId: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const p of await openOrders(businessId))
    for (const l of p.lines) {
      if (!l.itemId || l.pending <= 0) continue;
      const factor = p.order.lines.find((x) => x.id === l.lineId)?.unitFactor ?? 1;
      m.set(l.itemId, round3((m.get(l.itemId) ?? 0) + l.pending * factor));
    }
  return m;
}
