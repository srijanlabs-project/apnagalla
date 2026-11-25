import { and, count, desc, eq, ilike, isNull, max, or, sql } from 'drizzle-orm';
import type { AdminCreateStoreBody, AdminStoreDto, AuditEntryDto } from '@invoice/shared';
import { normalizeIndianMobile } from '@invoice/shared';
import type { DB } from '../db/client';
import { auditLog, businesses, memberships, sessions, syncRecords, users } from '../db/schema';
import { badRequest, notFound } from '../errors';
import { audit } from './audit';

/**
 * ApnaGalla's own admin panel (web only, for numbers in ADMIN_PHONES): see every store, create a
 * store for an owner's phone, suspend or reactivate a store. Every action is in the audit log.
 */
export class AdminService {
  constructor(private readonly db: DB) {}

  async listStores(q?: string): Promise<AdminStoreDto[]> {
    const search = q?.trim();
    const owners = this.db
      .select({ businessId: memberships.businessId, userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.role, 'owner'), isNull(memberships.removedAt)))
      .as('owners');
    const rows = await this.db
      .select({
        id: businesses.id,
        name: businesses.name,
        city: businesses.city,
        createdAt: businesses.createdAt,
        suspendedAt: businesses.suspendedAt,
        suspendedReason: businesses.suspendedReason,
        ownerName: users.name,
        ownerPhone: users.phone,
      })
      .from(businesses)
      .leftJoin(owners, eq(owners.businessId, businesses.id))
      .leftJoin(users, eq(users.id, owners.userId))
      .where(search ? or(ilike(businesses.name, `%${search}%`), ilike(users.phone, `%${search}%`), ilike(businesses.city, `%${search}%`)) : undefined)
      .orderBy(desc(businesses.createdAt))
      .limit(500);
    if (!rows.length) return [];

    const ids = rows.map((r) => r.id);
    const inIds = sql`${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}`;
    const memberCounts = await this.db
      .select({ id: memberships.businessId, n: count() })
      .from(memberships)
      .where(and(isNull(memberships.removedAt), sql`${memberships.businessId} in (${inIds})`))
      .groupBy(memberships.businessId);
    const activity = await this.db
      .select({
        id: syncRecords.businessId,
        bills: sql<number>`count(*) filter (where ${syncRecords.tableName} = 'invoices' and ${syncRecords.deleted} = false and ${syncRecords.data}->>'status' = 'saved')`,
        last: max(syncRecords.receivedAt),
      })
      .from(syncRecords)
      .where(sql`${syncRecords.businessId} in (${inIds})`)
      .groupBy(syncRecords.businessId);
    const m = new Map(memberCounts.map((r) => [r.id, Number(r.n)]));
    const a = new Map(activity.map((r) => [r.id, r]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      createdAt: r.createdAt.toISOString(),
      ownerName: r.ownerName ?? null,
      ownerPhone: r.ownerPhone ?? null,
      members: m.get(r.id) ?? 0,
      bills: Number(a.get(r.id)?.bills ?? 0),
      lastActivity: a.get(r.id)?.last ? new Date(a.get(r.id)!.last as unknown as string).toISOString() : null,
      suspendedAt: r.suspendedAt?.toISOString() ?? null,
      suspendedReason: r.suspendedReason ?? null,
    }));
  }

  /** Creates the store with the phone number as its owner (the owner logs in with OTP as usual). */
  async createStore(adminId: string, body: Omit<AdminCreateStoreBody, 'ownerPhone'> & { ownerPhone: string }): Promise<{ id: string }> {
    const phone = normalizeIndianMobile(body.ownerPhone);
    if (!phone) throw badRequest('invalid_phone', 'Enter a valid 10-digit mobile number');
    const id = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
      const ownerId = existing?.id ?? (await tx.insert(users).values({ phone }).returning({ id: users.id }))[0]!.id;
      const [b] = await tx
        .insert(businesses)
        .values({ name: body.name, city: body.city || null, state: body.state || null, createdBy: ownerId })
        .returning({ id: businesses.id });
      await tx.insert(memberships).values({ businessId: b!.id, userId: ownerId, role: 'owner' });
      return b!.id;
    });
    await audit(this.db, { businessId: id, actorUserId: adminId, action: 'admin.store_created', detail: { name: body.name, ownerPhone: phone } });
    return { id };
  }

  /** Suspended: every request for the store is refused, on every phone, until reactivated. */
  async setSuspended(adminId: string, businessId: string, suspended: boolean, reason?: string): Promise<void> {
    const res = await this.db
      .update(businesses)
      .set(suspended ? { suspendedAt: new Date(), suspendedReason: reason ?? null } : { suspendedAt: null, suspendedReason: null })
      .where(eq(businesses.id, businessId))
      .returning({ id: businesses.id });
    if (!res.length) throw notFound('Store not found');
    await audit(this.db, { businessId, actorUserId: adminId, action: suspended ? 'admin.store_suspended' : 'admin.store_reactivated', detail: reason ? { reason } : undefined });
  }

  async auditTrail(businessId: string): Promise<AuditEntryDto[]> {
    const rows = await this.db
      .select({ at: auditLog.at, action: auditLog.action, detail: auditLog.detail, actorName: users.name, actorPhone: users.phone })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(eq(auditLog.businessId, businessId))
      .orderBy(desc(auditLog.at))
      .limit(300);
    return rows.map((r) => ({ at: r.at.toISOString(), action: r.action, detail: r.detail ?? null, actorName: r.actorName ?? null, actorPhone: r.actorPhone ?? null }));
  }

  /** Signed-in devices across all stores (for the admin overview). */
  async activeSessions(): Promise<number> {
    const [r] = await this.db.select({ n: count() }).from(sessions).where(and(isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`));
    return Number(r?.n ?? 0);
  }
}
