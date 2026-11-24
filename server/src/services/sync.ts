import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import {
  OWNER_ONLY_TABLES,
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

export interface SyncActor {
  businessId: string;
  userId: string;
  role: Role;
  client: ClientKind;
  /** The person's own series letter ("" for the owner). */
  seriesCode?: string;
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
    const reject = (reason: string): SyncPushResult => ({ table, id, status: 'rejected', reason, ...(existing ? { current: existing } : {}) });

    // Never trust identity fields from the client.
    const clientTime = Date.parse(String(ch.data.updatedAt ?? ''));
    if (!Number.isFinite(clientTime)) return reject('missing updatedAt');
    const updatedAt = new Date(Math.min(clientTime, Date.now() + MAX_CLOCK_SKEW_MS));
    const data: Data = { ...ch.data, id, businessId: actor.businessId, updatedBy: actor.userId, updatedAt: updatedAt.toISOString() };
    // Who took a payment is the person pushing it, never what the phone claims.
    if (table === 'payments' && !existing) data.receivedBy = actor.userId;

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
    if (!row) return { table, id, status: 'stale', current: existing };

    const used = usedNumber(table, data);
    if (used) await this.bumpCounter(tx, actor.businessId, used.series, used.seq);
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

    if (table === 'payments') {
      // Entries are added, never changed: the owner can only void one. They are never deleted.
      if (data.deleted === true) return 'Payments cannot be deleted; void them instead';
      if (!existing) {
        if (typeof data.invoiceId !== 'string' || !data.invoiceId) return 'A payment belongs to a bill';
        if (!Number.isInteger(data.amount) || (data.amount as number) <= 0) return 'Amount must be more than zero';
        if (data.kind !== 'payment' && data.kind !== 'refund') return 'Unknown entry';
        if (!PAYMENT_MODES.includes(data.mode as never)) return 'Unknown payment mode';
        if (data.voidedAt) return 'A new entry cannot be voided';
      } else {
        if (stable(without(data, PAYMENT_VOID_FIELDS)) !== stable(without(existing, PAYMENT_VOID_FIELDS))) return 'A recorded payment cannot be changed; void it instead';
        if (actor.role !== 'owner') return 'Only the owner can void a payment';
      }
    }

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
      // Staff may still mark someone else's order delivered.
      if (stable(without(data, PAYMENT_FIELDS)) !== stable(without(existing, PAYMENT_FIELDS))) return 'Only the owner can edit this estimate';
    }
    return null;
  }

  async pull(businessId: string, since: number, limit = SYNC_PULL_MAX): Promise<SyncPullResponse> {
    const rows = await this.db
      .select({ table: syncRecords.tableName, id: syncRecords.id, data: syncRecords.data, seq: syncRecords.seq })
      .from(syncRecords)
      .where(and(eq(syncRecords.businessId, businessId), gt(syncRecords.seq, since)))
      .orderBy(asc(syncRecords.seq))
      .limit(limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      changes: page.map((r) => ({ table: r.table as SyncTable, id: r.id, data: r.data, seq: r.seq })),
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
