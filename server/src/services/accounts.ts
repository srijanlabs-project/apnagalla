import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BusinessDto, CreateBusinessInput, InviteDto, MeResponse, MemberDto, Role, TeamResponse } from '@invoice/shared';
import type { DB } from '../db/client';
import { businesses, invites, memberships, users } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../errors';

/** Accounts: users, businesses, memberships and staff invites. */
export class AccountService {
  constructor(private readonly db: DB) {}

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
      .select({ businessId: memberships.businessId, businessName: businesses.name, role: memberships.role })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)));

    const pending = await this.openInvites(eq(invites.phone, user.phone));

    return {
      user: { id: user.id, phone: user.phone, name: user.name },
      memberships: ms,
      invites: pending,
    };
  }

  async updateName(userId: string, name: string) {
    await this.db.update(users).set({ name }).where(eq(users.id, userId));
  }

  /** Returns the caller's active role in a business, or throws 403. */
  async requireRole(userId: string, businessId: string, allowed: Role[] = ['owner', 'staff']): Promise<Role> {
    const [m] = await this.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.businessId, businessId), isNull(memberships.removedAt)))
      .limit(1);
    if (!m) throw forbidden('You are not a member of this business');
    if (!allowed.includes(m.role)) throw forbidden('Only the owner can do this');
    return m.role;
  }

  private async activeMembershipOf(userId: string) {
    const [m] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)))
      .limit(1);
    return m;
  }

  async createBusiness(userId: string, body: CreateBusinessInput): Promise<BusinessDto> {
    if (await this.activeMembershipOf(userId)) {
      throw conflict('already_member', 'You already belong to a business. Leave it before creating a new one.');
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
        .select({ userId: users.id, name: users.name, phone: users.phone, role: memberships.role, joinedAt: memberships.createdAt })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.businessId, businessId), isNull(memberships.removedAt)))
        .orderBy(asc(memberships.createdAt))
    ).map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }));
    return { members, invites: await this.openInvites(eq(invites.businessId, businessId)) };
  }

  async createInvite(businessId: string, invitedBy: string, phone: string, role: Role): Promise<InviteDto> {
    const [already] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.businessId, businessId), eq(users.phone, phone), isNull(memberships.removedAt)))
      .limit(1);
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
    if (await this.activeMembershipOf(userId)) {
      throw conflict('already_member', 'You already belong to a business. Leave it before joining another.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
      await tx.insert(memberships).values({ businessId: inv.businessId, userId, role: inv.role });
    });
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
