import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
    /** App version last seen from this device ("R4-2026112601"). */
    appVersion: text('app_version'),
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
  /** Suspended by ApnaGalla (admin panel): every request for the store is refused. */
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: text('suspended_reason'),
});

/** Who did what, for sensitive actions (staff paused, payment voided, store suspended…). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** null for platform actions not tied to a store. */
    businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  (t) => [index('audit_log_business_at_idx').on(t.businessId, t.at)],
);

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
    /** Letter(s) of this person's own number series in the store ("" for the owner). Kept after removal. */
    seriesCode: text('series_code').notNull().default(''),
    /** Staff permissions set by the owner (see StaffPermissions). */
    permissions: jsonb('permissions').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('memberships_business_idx').on(t.businessId),
    index('memberships_user_idx').on(t.userId),
    // A user can belong to many stores, but only once to each.
    uniqueIndex('memberships_one_per_business_user').on(t.businessId, t.userId).where(sql`${t.removedAt} is null`),
  ],
);

/** Every change to a synced record gets the next value; phones pull "everything after N". */
export const syncSeq = pgSequence('sync_seq');

/**
 * The store's offline data (customers, items, invoices, settings…), one row per record, stored
 * as the app's JSON. Latest edit wins by `updatedAt`. Typed tables for reporting can come later.
 */
export const syncRecords = pgTable(
  'sync_records',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    id: text('id').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    updatedBy: uuid('updated_by'),
    deleted: boolean('deleted').notNull().default(false),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.tableName, t.id] }),
    index('sync_records_business_seq_idx').on(t.businessId, t.seq),
    // Finds a document by its number, so no number is used twice.
    index('sync_records_number_idx').on(t.businessId, t.tableName, sql`(${t.data}->>'number')`),
  ],
);

/** GST API answers, kept 30 days so the same GSTIN isn't paid for twice. */
export const gstinCache = pgTable('gstin_cache', {
  gstin: text('gstin').primaryKey(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per GST API call, for the daily limit per store. */
export const gstinLookups = pgTable(
  'gstin_lookups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    gstin: text('gstin').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gstin_lookups_business_at_idx').on(t.businessId, t.at)],
);

/** Numbers a phone gave back unused; handed out again before new ones. */
export const returnedNumbers = pgTable(
  'returned_numbers',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    series: text('series').notNull(),
    seq: integer('seq').notNull(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.series, t.seq] })],
);

/** Next free number per store and series ("invoice:26-27", "invoice-B:26-27", "estimate:all"). */
export const numberCounters = pgTable(
  'number_counters',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    series: text('series').notNull(),
    next: integer('next').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.series] })],
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

/**
 * Nightly Excel of the day's business, per store: emailed and/or uploaded to the owner's cloud
 * folder. The cloud sign-in (refresh token) is encrypted and never leaves the server.
 */
export const storeExports = pgTable('store_exports', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(true),
  email: text('email'),
  /** Hour of the day in India time (0-23) when it is sent. */
  hour: integer('hour').notNull().default(21),
  provider: text('provider'),
  /** Encrypted refresh token for the provider. */
  tokenEnc: text('token_enc'),
  accountLabel: text('account_label'),
  /** Google Drive folder made by us (drive.file can only see its own files). */
  folderId: text('folder_id'),
  /** India-time date (YYYY-MM-DD) of the last file sent. */
  lastSentDate: text('last_sent_date'),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- plans and subscriptions (ApnaGalla charging stores) ---------- */

/** A plan the client offers. Prices before GST, in paise; limits as JSON (see PlanLimits). */
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priceMonthly: integer('price_monthly').notNull().default(0),
  priceYearly: integer('price_yearly').notNull().default(0),
  limits: jsonb('limits').$type<Record<string, unknown>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
});

export const subscriptions = pgTable('subscriptions', {
  businessId: uuid('business_id')
    .primaryKey()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  planId: text('plan_id').notNull(),
  /** Trial until this time (then the plan has to be paid, or it falls back to free). */
  trialEnd: timestamp('trial_end', { withTimezone: true }),
  /** Paid until this time. */
  periodEnd: timestamp('period_end', { withTimezone: true }),
  /** Code used when signing up / paying: a coupon, another store's referral code, a partner code. */
  referredBy: text('referred_by'),
  partnerCode: text('partner_code'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const coupons = pgTable('coupons', {
  code: text('code').primaryKey(),
  /** pct: % off; amount: paise off; days: free days added. */
  kind: text('kind').notNull(),
  value: integer('value').notNull(),
  /** Distributor / partner this code belongs to (for their commission). */
  partner: text('partner'),
  maxUses: integer('max_uses'),
  used: integer('used').notNull().default(0),
  validTo: timestamp('valid_to', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What stores paid ApnaGalla; each paid one gets a GST invoice number. */
export const platformPayments = pgTable(
  'platform_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    planId: text('plan_id').notNull(),
    period: text('period').notNull(),
    /** Before GST, after the code's discount (paise). */
    amount: integer('amount').notNull(),
    gst: integer('gst').notNull(),
    total: integer('total').notNull(),
    code: text('code'),
    linkId: text('link_id'),
    linkUrl: text('link_url'),
    status: text('status').notNull().default('created'),
    invoiceNo: text('invoice_no'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('platform_payments_business_idx').on(t.businessId), index('platform_payments_link_idx').on(t.linkId)],
);
