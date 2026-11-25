import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import {
  APPEND_ONLY_TABLES,
  COST_TABLES,
  OWNER_ONLY_TABLES,
  R2_TABLES,
  PAYMENT_MODES,
  PAYMENT_VOID_FIELDS,
  SYNC_PULL_MAX,
  parseDocNumber,
  parseSeriesKey,
  type ClientKind,
  type ReserveNumbersBody,
  type ReturnNumbersBody,
  type Role,
  type SyncPullResponse,
  type SyncPushBody,
  type SyncPushResult,
  type SyncTable,
} from '@invoice/shared';
import type { DB } from '../db/client';
import { numberCounters, returnedNumbers, syncRecords } from '../db/schema';
import { audit } from './audit';

export interface SyncActor {
  businessId: string;
  userId: string;
  role: Role;
  client: ClientKind;
  /** The person's own series letter ("" for the owner). */
  seriesCode?: string;
  /** Staff of a store that keeps purchase prices from staff. */
  hideCost?: boolean;
}

/** Item fields staff never receive when the store hides cost. */
const COST_FIELDS = ['purchasePrice'];

function hideCost(table: string, data: Data | undefined, hide: boolean | undefined): Data | undefined {
  if (!hide || table !== 'items' || !data) return data;
  return without(data, COST_FIELDS);
}

/** Checks a new added-only entry (payment, supplier payment, stock change). */
function newEntryProblem(table: SyncTable, data: Data): string | null {
  if (table === 'stockMoves') {
    if (typeof data.itemId !== 'string' || !data.itemId) return 'A stock change belongs to an item';
    if (typeof data.qty !== 'number' || !Number.isFinite(data.qty)) return 'Quantity must be a number';
    if (!['opening', 'adjust', 'count'].includes(String(data.kind))) return 'Unknown stock change';
    return null;
  }
  if (!Number.isInteger(data.amount) || (data.amount as number) <= 0) return 'Amount must be more than zero';
  if (data.kind !== 'payment' && data.kind !== 'refund') return 'Unknown entry';
  if (!PAYMENT_MODES.includes(data.mode as never)) return 'Unknown payment mode';
  if (table === 'supplierPayments') {
    if (typeof data.supplierId !== 'string' || !data.supplierId) return 'A payment belongs to a supplier';
    if (data.mode === 'advance') return 'Unknown payment mode';
    return null;
  }
  // A customer payment is for a bill, or on account (khata) for a customer.
  const forBill = typeof data.invoiceId === 'string' && !!data.invoiceId;
  const onAccount = typeof data.customerId === 'string' && !!data.customerId;
  if (!forBill && !onAccount) return 'A payment belongs to a bill or a customer';
  return null;
}

const NUMBERED_TABLES: readonly SyncTable[] = ['invoices', 'estimates', 'creditNotes'];

type Data = Record<string, unknown>;
type Change = SyncPushBody['changes'][number];

/** A client clock far in the future would win every conflict forever; cap it. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Fields staff (and the web) may still change on a saved invoice: history and marking it delivered. */
const PAYMENT_FIELDS = ['payment', 'history', 'deliveredAt', 'deliveredByName', 'updatedAt', 'updatedBy'];

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Data)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Data)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function without(d: Data, keys: string[]): Data {
  const copy = { ...d };
  for (const k of keys) delete copy[k];
  return copy;
}

const paid = (d: Data | undefined) => Number((d?.payment as { amountPaid?: number } | undefined)?.amountPaid ?? 0);

/**
 * Server half of offline sync. Phones push changed records (latest `updatedAt` wins) and pull
 * every change after a cursor. Pushes for one store are serialised with an advisory lock, so
 * change numbers are committed in order and a pull can never skip one.
 */
export class SyncService {
  constructor(private readonly db: DB) {}

  async push(actor: SyncActor, changes: Change[]): Promise<SyncPushResult[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.businessId}))`);
      const results: SyncPushResult[] = [];
      for (const ch of changes) {
        results.push(await this.pushOne(tx as unknown as DB, actor, ch));
      }
      return results;
    });
  }

  private async pushOne(tx: DB, actor: SyncActor, ch: Change): Promise<SyncPushResult> {
    const { table, id } = ch;
    const [existingRow] = await tx
      .select({ data: syncRecords.data, updatedAt: syncRecords.updatedAt })
      .from(syncRecords)
      .where(and(eq(syncRecords.businessId, actor.businessId), eq(syncRecords.tableName, table), eq(syncRecords.id, id)))
      .limit(1);
    const existing = existingRow?.data;
    const shown = hideCost(table, existing, actor.hideCost);
    const reject = (reason: string): SyncPushResult => ({ table, id, status: 'rejected', reason, ...(shown ? { current: shown } : {}) });

    // Never trust identity fields from the client.
    const clientTime = Date.parse(String(ch.data.updatedAt ?? ''));
    if (!Number.isFinite(clientTime)) return reject('missing updatedAt');
    const updatedAt = new Date(Math.min(clientTime, Date.now() + MAX_CLOCK_SKEW_MS));
    const data: Data = { ...ch.data, id, businessId: actor.businessId, updatedBy: actor.userId, updatedAt: updatedAt.toISOString() };
    // Who took a payment is the person pushing it, never what the phone claims.
    if (table === 'payments' && !existing) data.receivedBy = actor.userId;
    // A staff phone never had the cost, so it must not wipe (or set) it.
    if (table === 'items' && actor.hideCost) {
      delete data.purchasePrice;
      if (existing?.purchasePrice !== undefined) data.purchasePrice = existing.purchasePrice;
    }

    const denied = this.checkPermission(actor, table, data, existing);
    if (denied) return reject(denied);
    const clash = await this.numberClash(tx, actor.businessId, table, id, data, existing);
    if (clash) return reject(clash);

    const [row] = await tx
      .insert(syncRecords)
      .values({
        businessId: actor.businessId,
        tableName: table,
        id,
        data,
        updatedAt,
        updatedBy: actor.userId,
        deleted: data.deleted === true,
        seq: sql`nextval('sync_seq')`,
      })
      .onConflictDoUpdate({
        target: [syncRecords.businessId, syncRecords.tableName, syncRecords.id],
        set: {
          data,
          updatedAt,
          updatedBy: actor.userId,
          deleted: data.deleted === true,
          seq: sql`nextval('sync_seq')`,
          receivedAt: sql`now()`,
        },
        // Latest edit wins; an older copy arriving late is ignored.
        setWhere: sql`${syncRecords.updatedAt} <= ${updatedAt}`,
      })
      .returning({ id: syncRecords.id });
    if (!row) return { table, id, status: 'stale', current: shown };

    const used = usedNumber(table, data);
    if (used) await this.bumpCounter(tx, actor.businessId, used.series, used.seq);
    const event = auditEvent(table, data, existing);
    if (event) await audit(tx, { businessId: actor.businessId, actorUserId: actor.userId, ...event });
    return { table, id, status: 'ok' };
  }

  /** A number already on another document of the store is refused, so no number is ever used twice. */
  private async numberClash(tx: DB, businessId: string, table: SyncTable, id: string, data: Data, existing: Data | undefined): Promise<string | null> {
    if (!NUMBERED_TABLES.includes(table) || data.deleted === true) return null;
    const number = typeof data.number === 'string' ? data.number.trim() : '';
    if (!number || existing?.number === number) return null;
    const [other] = await tx
      .select({ id: syncRecords.id })
      .from(syncRecords)
      .where(
        and(
          eq(syncRecords.businessId, businessId),
          eq(syncRecords.tableName, table),
          sql`(${syncRecords.data}->>'number') = ${number}`,
          ne(syncRecords.id, id),
          eq(syncRecords.deleted, false),
        ),
      )
      .limit(1);
    return other ? `Number ${number} is already used` : null;
  }

  /** Returns a reason when the change is not allowed, else null. */
  private checkPermission(actor: SyncActor, table: SyncTable, data: Data, existing: Data | undefined): string | null {
    // Staff number new documents only in their own series (or a shared one).
    if (NUMBERED_TABLES.includes(table) && !existing && actor.role !== 'owner' && typeof data.numberSeries === 'string') {
      const key = parseSeriesKey(data.numberSeries);
      if (key && key.code && key.code !== (actor.seriesCode ?? '')) return "That is another person's number series";
    }
    if ((table === 'profiles' || table === 'settings') && data.id !== actor.businessId) return 'wrong store';
    if (COST_TABLES.includes(table) && actor.hideCost) return 'Only the owner handles purchases in this store';
    if (OWNER_ONLY_TABLES.includes(table) && actor.role !== 'owner') return 'Only the owner can change store details';

    if (table === 'creditNotes') {
      if (actor.client === 'web' && !existing) return 'Credit notes are made in the phone app';
      if (data.deleted === true && existing && existing.status !== 'draft') return 'Only drafts can be deleted';
      if (actor.role !== 'owner') {
        // Staff take returns on any bill; price cuts, corrections and cancelling are the owner's.
        if (data.reason !== 'return') return 'Only the owner can make this credit note';
        if (existing && existing.status !== 'draft') return 'Only the owner can change a saved credit note';
      }
    }

    if (APPEND_ONLY_TABLES.includes(table)) {
      // Entries are added, never changed: the owner can only void one. They are never deleted.
      const what = table === 'stockMoves' ? 'stock change' : 'payment';
      if (data.deleted === true) return `${what === 'payment' ? 'Payments' : 'Stock changes'} cannot be deleted; void them instead`;
      if (!existing) {
        if (data.voidedAt) return 'A new entry cannot be voided';
        const bad = newEntryProblem(table, data);
        if (bad) return bad;
      } else {
        if (stable(without(data, PAYMENT_VOID_FIELDS)) !== stable(without(existing, PAYMENT_VOID_FIELDS))) return `A recorded ${what} cannot be changed; void it instead`;
        if (actor.role !== 'owner') return `Only the owner can void a ${what}`;
      }
    }

    if (table === 'purchases') {
      if (data.deleted === true && existing && existing.status !== 'draft') return 'Only drafts can be deleted';
      if (actor.role !== 'owner' && existing && existing.status !== 'draft') return 'Only the owner can change a saved purchase';
    }
    // Petty cash and the day-end count: anyone adds, only the owner changes them afterwards.
    if ((table === 'expenses' || table === 'dayCloses') && existing && actor.role !== 'owner') return 'Only the owner can change this';

    if (table === 'invoices') {
      const wasDraft = !existing || existing.status === 'draft';
      if (actor.client === 'web' && !existing) return 'Invoices are created in the phone app';
      if (data.deleted === true && existing && existing.status !== 'draft') return 'Only drafts can be deleted';
      const limited = actor.client === 'web' || (actor.role === 'staff' && !wasDraft);
      if (limited && existing) {
        if (stable(without(data, PAYMENT_FIELDS)) !== stable(without(existing, PAYMENT_FIELDS))) {
          return actor.client === 'web' ? 'Invoices can only be edited in the phone app' : 'Only the owner can edit a saved invoice';
        }
        if (actor.role === 'staff' && paid(data) < paid(existing)) return 'Only the owner can reduce a recorded payment';
      }
    }

    if (table === 'estimates' && actor.role === 'staff' && existing && existing.status !== 'draft' && existing.createdBy !== actor.userId) {
      // Staff may still mark someone else's order delivered, move a job along (stage, photos) or
      // make its bill; prices and lines stay the owner's (or the maker's).
      const staffMay = [...PAYMENT_FIELDS, 'job', ...(data.status === 'converted' ? ['status', 'convertedInvoiceId'] : [])];
      if (stable(without(data, staffMay)) !== stable(without(existing, staffMay))) return 'Only the owner can edit this estimate';
    }
    return null;
  }

  /** Does this store let staff see purchase prices? (Its settings record, synced like any other.) */
  async staffSeeCost(businessId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ data: syncRecords.data })
      .from(syncRecords)
      .where(and(eq(syncRecords.businessId, businessId), eq(syncRecords.tableName, 'settings'), eq(syncRecords.id, businessId)))
      .limit(1);
    return row?.data.staffSeeCost === true;
  }

  /**
   * Changes after `since`. Tables the phone can't see (purchases for staff when costs are hidden)
   * or doesn't know yet (an older app: `schema` 1) are left out; an app that updates starts again
   * from 0, so it still gets them.
   */
  async pull(businessId: string, since: number, limit = SYNC_PULL_MAX, opts: { hideCost?: boolean; schema?: number } = {}): Promise<SyncPullResponse> {
    const skip = [...((opts.schema ?? 1) < 2 ? R2_TABLES : []), ...(opts.hideCost ? COST_TABLES : [])];
    const rows = await this.db
      .select({ table: syncRecords.tableName, id: syncRecords.id, data: syncRecords.data, seq: syncRecords.seq })
      .from(syncRecords)
      .where(
        and(
          eq(syncRecords.businessId, businessId),
          gt(syncRecords.seq, since),
          skip.length
            ? sql`${syncRecords.tableName} not in (${sql.join(
                skip.map((t) => sql`${t}`),
                sql`, `,
              )})`
            : undefined,
        ),
      )
      .orderBy(asc(syncRecords.seq))
      .limit(limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      changes: page.map((r) => ({ table: r.table as SyncTable, id: r.id, data: hideCost(r.table, r.data, opts.hideCost)!, seq: r.seq })),
      cursor: page.length ? page[page.length - 1]!.seq : since,
      more,
    };
  }

  /**
   * Hands out `count` numbers of a shared series, never twice: numbers phones gave back come
   * first (lowest first, so gaps fill), then new ones from the counter.
   */
  async reserveNumbers(businessId: string, body: ReserveNumbersBody): Promise<number[]> {
    const series = `${body.kind}:${body.period}`;
    return this.db.transaction(async (tx) => {
      const reused = (
        await tx.execute<{ seq: number }>(sql`
          delete from ${returnedNumbers}
          where (business_id, series, seq) in (
            select business_id, series, seq from ${returnedNumbers}
            where business_id = ${businessId} and series = ${series}
            order by seq limit ${body.count}
            for update skip locked)
          returning seq`)
      ).rows
        .map((r) => Number(r.seq))
        .sort((a, b) => a - b);
      const fresh = body.count - reused.length;
      if (!fresh) return reused;
      const [row] = await tx
        .insert(numberCounters)
        .values({ businessId, series, next: fresh + 1 })
        .onConflictDoUpdate({
          target: [numberCounters.businessId, numberCounters.series],
          set: { next: sql`${numberCounters.next} + ${fresh}` },
        })
        .returning({ next: numberCounters.next });
      const start = row!.next - fresh;
      return [...reused, ...Array.from({ length: fresh }, (_, i) => start + i)];
    });
  }

  /** A phone gives back numbers it held but never used; ones already used or never handed out are ignored. */
  async returnNumbers(businessId: string, body: ReturnNumbersBody): Promise<void> {
    const series = `${body.kind}:${body.period}`;
    const [counter] = await this.db
      .select({ next: numberCounters.next })
      .from(numberCounters)
      .where(and(eq(numberCounters.businessId, businessId), eq(numberCounters.series, series)))
      .limit(1);
    if (!counter) return;
    const candidates = [...new Set(body.numbers)].filter((n) => n < counter.next);
    if (!candidates.length) return;
    const used = await this.db
      .select({ seq: sql<number>`(${syncRecords.data}->>'numberSeq')::int` })
      .from(syncRecords)
      .where(
        and(
          eq(syncRecords.businessId, businessId),
          sql`${syncRecords.data}->>'numberSeries' = ${series}`,
          sql`(${syncRecords.data}->>'numberSeq')::int = any(${sql.raw(`array[${candidates.join(',')}]`)})`,
        ),
      );
    const usedSet = new Set(used.map((u) => Number(u.seq)));
    const free = candidates.filter((n) => !usedSet.has(n));
    if (!free.length) return;
    await this.db
      .insert(returnedNumbers)
      .values(free.map((seq) => ({ businessId, series, seq })))
      .onConflictDoNothing();
  }

  /** A number used on a phone (e.g. typed by hand, or from before sync) is never handed out again. */
  private async bumpCounter(tx: DB, businessId: string, series: string, seq: number) {
    await tx
      .insert(numberCounters)
      .values({ businessId, series, next: seq + 1 })
      .onConflictDoUpdate({
        target: [numberCounters.businessId, numberCounters.series],
        set: { next: sql`greatest(${numberCounters.next}, ${seq + 1})` },
      });
  }
}

/** The series and running number a pushed document used, if any. */
function usedNumber(table: SyncTable, data: Data): { series: string; seq: number } | null {
  if (typeof data.number !== 'string' || !data.number) return null;
  // Documents from R1.3 on say which series and number they used.
  const series = data.numberSeries;
  const seq = data.numberSeq;
  if (typeof series === 'string' && typeof seq === 'number') {
    if (!parseSeriesKey(series) || !Number.isInteger(seq) || seq < 1 || seq > 1e9) return null;
    return { series, seq };
  }
  // Older documents: read it back from the number itself.
  if (table !== 'invoices' && table !== 'estimates') return null;
  const parsed = parseDocNumber(data.number);
  return parsed ? { series: `${table === 'invoices' ? 'invoice' : 'estimate'}:${parsed.period}`, seq: parsed.seq } : null;
}

const STORE_DETAIL_TABLES: readonly SyncTable[] = ['profiles', 'settings', 'bankAccounts', 'upiIds'];

/** Sensitive changes worth a line in the audit log (who voided a payment, cancelled a bill…). */
function auditEvent(table: SyncTable, data: Data, existing: Data | undefined): { action: string; detail: Record<string, unknown> } | null {
  const num = (d: Data | undefined) => (typeof d?.number === 'string' ? d.number : undefined);
  if (table === 'payments' && existing && !existing.voidedAt && data.voidedAt) {
    return { action: 'payment.voided', detail: { invoiceId: data.invoiceId, amount: data.amount, mode: data.mode, reason: data.voidReason } };
  }
  if (table === 'supplierPayments' && existing && !existing.voidedAt && data.voidedAt) {
    return { action: 'supplier_payment.voided', detail: { supplierId: data.supplierId, amount: data.amount, reason: data.voidReason } };
  }
  if (table === 'stockMoves' && existing && !existing.voidedAt && data.voidedAt) {
    return { action: 'stock.change_voided', detail: { itemId: data.itemId, qty: data.qty, reason: data.voidReason } };
  }
  if (table === 'stockMoves' && !existing && data.kind !== 'opening') {
    return { action: 'stock.adjusted', detail: { itemId: data.itemId, itemName: data.itemName, qty: data.qty, reason: data.reason } };
  }
  if (table === 'purchases' && existing?.status === 'saved') {
    if (data.status === 'cancelled') return { action: 'purchase.cancelled', detail: { supplierBillNo: data.supplierBillNo, total: (data.totals as Data | undefined)?.grandTotal } };
    if (stable(without(data, ['updatedAt', 'updatedBy', 'history'])) !== stable(without(existing, ['updatedAt', 'updatedBy', 'history']))) {
      return { action: 'purchase.edited', detail: { supplierBillNo: data.supplierBillNo } };
    }
  }
  if (table === 'expenses' && existing) {
    if (data.deleted === true) return { action: 'expense.deleted', detail: { category: existing.category, amount: existing.amount } };
    if (existing.amount !== data.amount) return { action: 'expense.changed', detail: { category: data.category, from: existing.amount, to: data.amount } };
  }
  if (table === 'dayCloses' && Number(data.difference ?? 0) !== 0 && (!existing || existing.counted !== data.counted)) {
    return { action: 'day.closed_with_difference', detail: { date: data.date, expected: data.expected, counted: data.counted, difference: data.difference } };
  }
  if (table === 'payments' && !existing && data.kind === 'refund') {
    return { action: 'payment.refunded', detail: { invoiceId: data.invoiceId, amount: data.amount, mode: data.mode } };
  }
  if (table === 'invoices' && existing?.status === 'saved') {
    if (data.status === 'cancelled') return { action: 'invoice.cancelled', detail: { number: num(data) } };
    if (data.status === 'saved' && stable(without(data, PAYMENT_FIELDS)) !== stable(without(existing, PAYMENT_FIELDS))) {
      return { action: 'invoice.edited', detail: { number: num(data) } };
    }
  }
  if (table === 'creditNotes') {
    if (existing?.status === 'saved' && data.status === 'cancelled') return { action: 'credit_note.cancelled', detail: { number: num(data) } };
    if (existing?.status !== 'saved' && data.status === 'saved') return { action: 'credit_note.saved', detail: { number: num(data), invoiceId: data.invoiceId } };
  }
  if (STORE_DETAIL_TABLES.includes(table) && existing && stable(without(data, ['updatedAt', 'updatedBy'])) !== stable(without(existing, ['updatedAt', 'updatedBy']))) {
    return { action: 'store.details_changed', detail: { table } };
  }
  if (table === 'items' && existing && (existing.rate !== data.rate || (data.purchasePrice !== undefined && existing.purchasePrice !== data.purchasePrice))) {
    return { action: 'item.price_changed', detail: { name: data.name, from: existing.rate, to: data.rate } };
  }
  return null;
}
