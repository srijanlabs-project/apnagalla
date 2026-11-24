import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'staff']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** E.164, e.g. +919876543210 */
  phone: text('phone').notNull().unique(),
  name: text('name'),
  createdAt: createdAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const otpRequests = pgTable(
  'otp_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    ip: text('ip'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_requests_phone_created_idx').on(t.phone, t.createdAt), index('otp_requests_ip_created_idx').on(t.ip, t.createdAt)],
);

/** One row per logged-in device. The refresh token is stored only as a hash. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceName: text('device_name'),
    /** 'mobile' (one active per user) or 'web' (can't create invoices). */
    client: text('client', { enum: ['mobile', 'web'] }).notNull().default('mobile'),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Why the session ended: logout | signed_in_elsewhere | signed_out_remotely | deactivated */
    revokedReason: text('revoked_reason'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone'),
  city: text('city'),
  state: text('state'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: createdAt(),
    /** Owner paused this person's access; their past work stays. Cleared on re-activation. */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t) => [
    index('memberships_business_idx').on(t.businessId),
    index('memberships_user_idx').on(t.userId),
    // A user can belong to many stores, but only once to each.
    uniqueIndex('memberships_one_per_business_user').on(t.businessId, t.userId).where(sql`${t.removedAt} is null`),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    role: roleEnum('role').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('invites_phone_idx').on(t.phone),
    uniqueIndex('invites_one_open_per_phone_business')
      .on(t.businessId, t.phone)
      .where(sql`${t.acceptedAt} is null and ${t.closedAt} is null`),
  ],
);
