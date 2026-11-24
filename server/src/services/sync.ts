import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  OWNER_ONLY_TABLES,
  SYNC_PULL_MAX,
  parseDocNumber,
  type ClientKind,
  type ReserveNumbersBody,
  type Role,
  type SyncPullResponse,
  type SyncPushBody,
  type SyncPushResult,
  type SyncTable,
} from '@invoice/shared';
import type { DB } from '../db/client';
import { numberCounters, syncRecords } from '../db/schema';

export interface SyncActor {
  businessId: string;
  userId: string;
  role: Role;
  client: ClientKind;
}

type Data = Record<string, unknown>;
type Change = SyncPushBody['changes'][number];

/** A client clock far in the future would win every conflict forever; cap it. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Fields anyone who may record a payment can change on a saved invoice. */
const PAYMENT_FIELDS = ['payment', 'history', 'updatedAt', 'updatedBy'];

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

    const denied = this.checkPermission(actor, table, data, existing);
    if (denied) return reject(denied);

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

    if ((table === 'invoices' || table === 'estimates') && typeof data.number === 'string' && data.number) {
      await this.bumpCounter(tx, actor.businessId, table === 'invoices' ? 'invoice' : 'estimate', data.number);
    }
    return { table, id, status: 'ok' };
  }

  /** Returns a reason when the change is not allowed, else null. */
  private checkPermission(actor: SyncActor, table: SyncTable, data: Data, existing: Data | undefined): string | null {
    if ((table === 'profiles' || table === 'settings') && data.id !== actor.businessId) return 'wrong store';
    if (OWNER_ONLY_TABLES.includes(table) && actor.role !== 'owner') return 'Only the owner can change store details';

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
      return 'Only the owner can edit this estimate';
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

  /** Hands out the next `count` numbers of a series, strictly increasing, never twice. */
  async reserveNumbers(businessId: string, body: ReserveNumbersBody): Promise<number[]> {
    const series = `${body.kind}:${body.period}`;
    const [row] = await this.db
      .insert(numberCounters)
      .values({ businessId, series, next: body.count + 1 })
      .onConflictDoUpdate({
        target: [numberCounters.businessId, numberCounters.series],
        set: { next: sql`${numberCounters.next} + ${body.count}` },
      })
      .returning({ next: numberCounters.next });
    const start = row!.next - body.count;
    return Array.from({ length: body.count }, (_, i) => start + i);
  }

  /** A number used on a phone (e.g. typed by hand, or from before sync) is never handed out again. */
  private async bumpCounter(tx: DB, businessId: string, kind: 'invoice' | 'estimate', number: string) {
    const parsed = parseDocNumber(number);
    if (!parsed) return;
    const series = `${kind}:${parsed.period}`;
    await tx
      .insert(numberCounters)
      .values({ businessId, series, next: parsed.seq + 1 })
      .onConflictDoUpdate({
        target: [numberCounters.businessId, numberCounters.series],
        set: { next: sql`greatest(${numberCounters.next}, ${parsed.seq + 1})` },
      });
  }
}
