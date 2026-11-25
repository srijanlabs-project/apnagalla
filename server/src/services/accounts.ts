import { and, asc, count, eq, isNull, like, or } from 'drizzle-orm';
import { MAX_OWNED_STORES, nextSeriesCode, type BusinessDto, type CreateBusinessInput, type InviteDto, type MeResponse, type MemberDto, type Role, type StaffPermissions, type TeamResponse } from '@invoice/shared';
import type { DB } from '../db/client';
import { businesses, invites, memberships, numberCounters, users } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../errors';

/** Accounts: users, businesses, memberships and staff invites. */
export class AccountService {
  /** `adminPhones`: E.164 numbers of ApnaGalla staff allowed into the admin panel. */
  constructor(
    private readonly db: DB,
    private readonly adminPhones: ReadonlySet<string> = new Set(),
  ) {}

  /** ApnaGalla admin (by phone number, from ADMIN_PHONES)? */
  async isAdmin(userId: string): Promise<boolean> {
    if (!this.adminPhones.size) return false;
    const [u] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
    return !!u && this.adminPhones.has(u.phone);
  }

  async upsertUserByPhone(phone: string): Promise<string> {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (existing) return existing.id;
    const [created] = await this.db
      .insert(users)
      .values({ phone })
      .onConflictDoNothing({ target: users.phone })
      .returning({ id: users.id });
    if (created) return created.id;
    // Lost a race with a parallel insert — read it back.
    const [again] = await this.db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    return again!.id;
  }

  async getMe(userId: string): Promise<MeResponse> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.deletedAt) throw notFound('User not found');

    const ms = await this.db
      .select({
        businessId: memberships.businessId,
        businessName: businesses.name,
        businessCity: businesses.city,
        businessState: businesses.state,
        role: memberships.role,
        deactivatedAt: memberships.deactivatedAt,
        seriesCode: memberships.seriesCode,
        permissions: memberships.permissions,
        suspendedAt: businesses.suspendedAt,
      })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)))
      .orderBy(asc(memberships.createdAt));

    const pending = await this.openInvites(eq(invites.phone, user.phone));

    return {
      user: { id: user.id, phone: user.phone, name: user.name },
      memberships: ms.map(({ deactivatedAt, suspendedAt, permissions, ...m }) => ({ ...m, active: !deactivatedAt, suspended: !!suspendedAt, permissions: (permissions as StaffPermissions | null) ?? null })),
      invites: pending,
      ...(this.adminPhones.has(user.phone) ? { isAdmin: true } : {}),
    };
  }

  async updateName(userId: string, name: string) {
    await this.db.update(users).set({ name }).where(eq(users.id, userId));
  }

  /** Returns the caller's active role in a business, or throws 403. */
  async requireRole(userId: string, businessId: string, allowed: Role[] = ['owner', 'staff']): Promise<Role> {
    const [m] = await this.db
      .select({ role: memberships.role, deactivatedAt: memberships.deactivatedAt, suspendedAt: businesses.suspendedAt })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId), isNull(memberships.removedAt)))
      .limit(1);
    if (!m) throw forbidden('You are not a member of this business');
    if (m.suspendedAt) throw forbidden('This store has been suspended. Please contact ApnaGalla.', 'store_suspended');
    if (m.deactivatedAt) throw forbidden('The owner has paused your access to this store', 'member_inactive');
    if (!allowed.includes(m.role)) throw forbidden('Only the owner can do this');
    return m.role;
  }

  private async membershipIn(businessId: string, userId: string) {
    const [m] = await this.db
      .select({ id: memberships.id, role: memberships.role, deactivatedAt: memberships.deactivatedAt, seriesCode: memberships.seriesCode })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId), isNull(memberships.removedAt)))
      .limit(1);
    return m;
  }

  async createBusiness(userId: string, body: CreateBusinessInput): Promise<BusinessDto> {
    const [owned] = await this.db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner'), isNull(memberships.removedAt)));
    if ((owned?.n ?? 0) >= MAX_OWNED_STORES) {
      throw conflict('store_limit', `You can have up to ${MAX_OWNED_STORES} stores.`);
    }
    return this.db.transaction(async (tx) => {
      const [b] = await tx
        .insert(businesses)
        .values({ name: body.name, phone: body.phone || null, city: body.city || null, state: body.state || null, createdBy: userId })
        .returning();
      await tx.insert(memberships).values({ businessId: b!.id, userId, role: 'owner' });
      return toBusinessDto(b!);
    });
  }

  async getBusiness(businessId: string): Promise<BusinessDto> {
    const [b] = await this.db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!b) throw notFound('Business not found');
    return toBusinessDto(b);
  }

  async getTeam(businessId: string): Promise<TeamResponse> {
    const members: MemberDto[] = (
      await this.db
        .select({
          userId: users.id,
          name: users.name,
          phone: users.phone,
          role: memberships.role,
          joinedAt: memberships.createdAt,
          deactivatedAt: memberships.deactivatedAt,
          seriesCode: memberships.seriesCode,
          permissions: memberships.permissions,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.businessId, businessId), isNull(memberships.removedAt)))
        .orderBy(asc(memberships.createdAt))
    ).map(({ deactivatedAt, permissions, ...m }) => ({ ...m, joinedAt: m.joinedAt.toISOString(), active: !deactivatedAt, permissions: (permissions as StaffPermissions | null) ?? null }));
    return { members, invites: await this.openInvites(eq(invites.businessId, businessId)) };
  }

  async createInvite(businessId: string, invitedBy: string, phone: string, role: Role): Promise<InviteDto> {
    const [already] = await this.db
      .select({ id: memberships.id, deactivatedAt: memberships.deactivatedAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.businessId, businessId), eq(users.phone, phone), isNull(memberships.removedAt)))
      .limit(1);
    if (already?.deactivatedAt) throw conflict('already_member', 'This number is in your team but paused. Turn their access back on instead.');
    if (already) throw conflict('already_member', 'This number is already in your team');

    const [row] = await this.db
      .insert(invites)
      .values({ businessId, phone, role, invitedBy })
      .onConflictDoNothing()
      .returning({ id: invites.id });
    if (!row) throw conflict('invite_exists', 'This number has already been invited');
    const [dto] = await this.openInvites(eq(invites.id, row.id));
    return dto!;
  }

  async revokeInvite(businessId: string, inviteId: string) {
    const res = await this.db
      .update(invites)
      .set({ closedAt: new Date() })
      .where(and(eq(invites.id, inviteId), eq(invites.businessId, businessId), isNull(invites.acceptedAt), isNull(invites.closedAt)))
      .returning({ id: invites.id });
    if (res.length === 0) throw notFound('Invite not found');
  }

  private async openInviteForUser(userId: string, inviteId: string) {
    const [user] = await this.db.select({ phone: users.phone }).from(users).where(eq(users.id, userId)).limit(1);
    const [inv] = await this.db
      .select()
      .from(invites)
      .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt), isNull(invites.closedAt)))
      .limit(1);
    if (!inv || !user || inv.phone !== user.phone) throw notFound('Invite not found');
    return inv;
  }

  async acceptInvite(userId: string, inviteId: string) {
    const inv = await this.openInviteForUser(userId, inviteId);
    if (await this.membershipIn(inv.businessId, userId)) {
      throw conflict('already_member', 'You are already in this store');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
      // Staff get their own number series letter; someone re-joining gets their old letter back.
      let seriesCode = '';
      if (inv.role === 'staff') {
        const rows = await tx
          .select({ userId: memberships.userId, code: memberships.seriesCode })
          .from(memberships)
          .where(eq(memberships.businessId, inv.businessId));
        seriesCode = rows.find((r) => r.userId === userId && r.code)?.code ?? nextSeriesCode(rows.map((r) => r.code).filter(Boolean));
      }
      await tx.insert(memberships).values({ businessId: inv.businessId, userId, role: inv.role, seriesCode });
    });
  }

  /** This person's series letter in a store ("" for the owner). */
  /** Staff permissions in a store (null = defaults). */
  async permissionsOf(businessId: string, userId: string): Promise<StaffPermissions | null> {
    const [row] = await this.db
      .select({ permissions: memberships.permissions })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, userId), isNull(memberships.removedAt)))
      .limit(1);
    return (row?.permissions as StaffPermissions | null) ?? null;
  }

  async setPermissions(businessId: string, memberUserId: string, permissions: StaffPermissions) {
    const m = await this.membershipIn(businessId, memberUserId);
    if (!m) throw notFound('Member not found');
    if (m.role === 'owner') throw badRequest('owner', 'The owner may do everything');
    await this.db.update(memberships).set({ permissions: permissions as Record<string, unknown> }).where(eq(memberships.id, m.id));
  }

  async seriesCodeOf(businessId: string, userId: string): Promise<string> {
    return (await this.membershipIn(businessId, userId))?.seriesCode ?? '';
  }

  /**
   * Owner changes a staff member's series letter. Only before that letter has been used for a
   * number, and never to a letter someone in the store has (or had).
   */
  async setSeriesCode(businessId: string, memberUserId: string, code: string) {
    const m = await this.membershipIn(businessId, memberUserId);
    if (!m) throw notFound('Member not found');
    if (m.role === 'owner') throw badRequest('owner_has_no_code', "The owner's numbers have no letter");
    if (m.seriesCode === code) return;
    const taken = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.businessId, businessId), eq(memberships.seriesCode, code)))
      .limit(1);
    if (taken.length) throw conflict('code_taken', `Letter ${code} is already used in this store`);
    const used = await this.db
      .select({ series: numberCounters.series })
      .from(numberCounters)
      .where(and(eq(numberCounters.businessId, businessId), or(like(numberCounters.series, `%-${m.seriesCode}:%`), like(numberCounters.series, `%-${code}:%`))))
      .limit(1);
    if (used.length) throw conflict('code_used', 'This letter is already on saved bills, so it can no longer change');
    await this.db.update(memberships).set({ seriesCode: code }).where(eq(memberships.id, m.id));
  }

  async declineInvite(userId: string, inviteId: string) {
    const inv = await this.openInviteForUser(userId, inviteId);
    await this.db.update(invites).set({ closedAt: new Date() }).where(eq(invites.id, inv.id));
  }

  async removeMember(businessId: string, actorId: string, memberUserId: string) {
    if (actorId === memberUserId) throw badRequest('cannot_remove_self', 'The owner cannot remove themselves');
    const res = await this.db
      .update(memberships)
      .set({ removedAt: new Date() })
      .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, memberUserId), isNull(memberships.removedAt)))
      .returning({ id: memberships.id });
    if (res.length === 0) throw notFound('Member not found');
  }

  /**
   * Owner pauses or restores a member's access to this store. A paused member is refused on every
   * request for this store at once; their other stores and their past bills are untouched.
   */
  async setMemberActive(businessId: string, actorId: string, memberUserId: string, active: boolean) {
    if (actorId === memberUserId) throw badRequest('cannot_change_self', 'You cannot pause your own access');
    const m = await this.membershipIn(businessId, memberUserId);
    if (!m) throw notFound('Member not found');
    if (m.role === 'owner') throw badRequest('cannot_pause_owner', "The owner's access cannot be paused");
    await this.db
      .update(memberships)
      .set({ deactivatedAt: active ? null : new Date() })
      .where(eq(memberships.id, m.id));
  }

  private async openInvites(where: ReturnType<typeof eq>): Promise<InviteDto[]> {
    const rows = await this.db
      .select({
        id: invites.id,
        businessId: invites.businessId,
        businessName: businesses.name,
        phone: invites.phone,
        role: invites.role,
        invitedByName: users.name,
        createdAt: invites.createdAt,
      })
      .from(invites)
      .innerJoin(businesses, eq(businesses.id, invites.businessId))
      .innerJoin(users, eq(users.id, invites.invitedBy))
      .where(and(where, isNull(invites.acceptedAt), isNull(invites.closedAt)))
      .orderBy(asc(invites.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}

function toBusinessDto(b: typeof businesses.$inferSelect): BusinessDto {
  return { id: b.id, name: b.name, phone: b.phone, city: b.city, state: b.state, createdAt: b.createdAt.toISOString() };
}
