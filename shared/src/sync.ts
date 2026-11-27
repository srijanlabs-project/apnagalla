import { z } from 'zod';
import { NUMBER_SERIES } from './gst';

/** Every table the phone keeps offline and syncs with the server. */
export const SYNC_TABLES = [
  'profiles',
  'settings',
  'bankAccounts',
  'upiIds',
  'customers',
  'items',
  'invoices',
  'estimates',
  'creditNotes',
  'payments',
  'categories',
  // R2
  'stockMoves',
  'suppliers',
  'purchaseOrders',
  'purchases',
  'supplierPayments',
  'expenses',
  'dayCloses',
  // R3
  'offers',
  'savedReports',
  // R4
  'employees',
  'attendance',
  // R6
  'moneyMoves',
  'incomes',
  'loans',
  'loanEntries',
  'recurringExpenses',
  // R7
  'ledgers',
  'journals',
  // R10
  'visits',
  // R11
  'crates',
  'schemes',
  'vouchers',
  'rentals',
  'recipes',
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * One rule per table, read top to bottom:
 * - since: the data layout (SYNC_SCHEMA) an app must have to receive it; older apps don't know the table.
 * - owner: only the owner may change it (store details, books). private: only the owner even sees it.
 * - money: money records the owner and the accountant login see. cost: purchase prices, hidden from staff
 *   of a store that hides costs. append: only ever added; a mistake is voided by the owner.
 */
type Rule = { since: number; owner?: true; private?: true; money?: true; cost?: true; append?: true };
export const TABLE_RULES: Record<SyncTable, Rule> = {
  profiles: { since: 1, owner: true },
  settings: { since: 1, owner: true },
  bankAccounts: { since: 1, owner: true },
  upiIds: { since: 1, owner: true },
  customers: { since: 1 },
  items: { since: 1 },
  invoices: { since: 1 },
  estimates: { since: 1 },
  creditNotes: { since: 1 },
  payments: { since: 1, append: true },
  categories: { since: 1, owner: true },
  stockMoves: { since: 2, append: true },
  suppliers: { since: 2, cost: true },
  purchaseOrders: { since: 2, cost: true },
  purchases: { since: 2, cost: true },
  supplierPayments: { since: 2, cost: true, append: true },
  expenses: { since: 2 },
  dayCloses: { since: 2 },
  offers: { since: 3, owner: true },
  savedReports: { since: 3, owner: true },
  employees: { since: 4, owner: true, private: true },
  attendance: { since: 4, owner: true, private: true },
  moneyMoves: { since: 5, owner: true, money: true },
  incomes: { since: 5, owner: true, money: true },
  loans: { since: 5, owner: true, money: true },
  loanEntries: { since: 5, owner: true, money: true },
  recurringExpenses: { since: 5, owner: true, money: true },
  ledgers: { since: 6, owner: true, money: true },
  journals: { since: 6, owner: true, money: true },
  visits: { since: 7 },
  crates: { since: 8 },
  schemes: { since: 8, cost: true },
  // Gift vouchers are money: only the owner sells or changes them (staff still take them as payment).
  vouchers: { since: 8, owner: true },
  rentals: { since: 8 },
  recipes: { since: 8 },
};
const where = (test: (r: Rule) => boolean | undefined): readonly SyncTable[] => SYNC_TABLES.filter((t) => test(TABLE_RULES[t]));

/** Tables an app of this data layout doesn't know yet (left out of what it receives). */
export const tablesNewerThan = (schema: number): readonly SyncTable[] => where((r) => r.since > schema);

// The lists below are read from TABLE_RULES; the release names are kept for older code and tests.
export const R2_TABLES = where((r) => r.since === 2);
export const R3_TABLES = where((r) => r.since === 3);
export const R4_TABLES = where((r) => r.since === 4);
export const R6_TABLES = where((r) => r.since === 5);
export const R7_TABLES = where((r) => r.since === 6);
export const R10_TABLES = where((r) => r.since === 7);
export const R11_TABLES = where((r) => r.since === 8);
export const MONEY_TABLES = where((r) => r.money);
export const OWNER_PRIVATE_TABLES = where((r) => r.private);
export const COST_TABLES = where((r) => r.cost);
export const APPEND_ONLY_TABLES = where((r) => r.append);
export const OWNER_ONLY_TABLES = where((r) => r.owner);

/** The data layout the phone understands; sent on pull. Older apps send none (= 1). */
export const SYNC_SCHEMA = 8;

/** Payment modes for a payment or refund entry. `advance` = paid from money the customer left on account. */
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank', 'cheque', 'other', 'advance', 'finance', 'creditnote', 'points', 'buyback', 'voucher'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Fields of an added-only entry the owner may change afterwards (to void it); nothing else ever changes. */
export const PAYMENT_VOID_FIELDS = ['voidedAt', 'voidedBy', 'voidedByName', 'voidReason', 'updatedAt', 'updatedBy'];

/** A cheque payment's state: anyone may mark it cleared (a bounced cheque is voided by the owner). */
export const CHEQUE_FIELDS = ['chequeStatus', 'chequeClearedAt', 'chequeClearedByName'];

export const SYNC_PUSH_MAX = 100;
export const SYNC_PULL_MAX = 500;

export const syncPushBody = z.object({
  changes: z
    .array(
      z.object({
        table: z.enum(SYNC_TABLES),
        id: z.string().min(1).max(64),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .max(SYNC_PUSH_MAX),
});
export type SyncPushBody = z.input<typeof syncPushBody>;

/**
 * ok = stored; stale = the server already has a newer version (pull to get it);
 * rejected = not allowed (reason says why) — the server's version, if any, comes back on pull.
 */
export interface SyncPushResult {
  table: SyncTable;
  id: string;
  status: 'ok' | 'stale' | 'rejected';
  reason?: string;
  /** For stale / rejected: the server's current copy, so the phone can replace its local one. */
  current?: Record<string, unknown>;
}

export interface SyncPushResponse {
  results: SyncPushResult[];
}

export interface SyncPullChange {
  table: SyncTable;
  id: string;
  data: Record<string, unknown>;
  seq: number;
}

export interface SyncPullResponse {
  changes: SyncPullChange[];
  /** Pass as `since` next time. */
  cursor: number;
  /** More changes are waiting: pull again with the new cursor. */
  more: boolean;
}

/** Most numbers one phone holds for one shared series. */
export const MAX_NUMBER_BLOCK = 200;

/** A number series: kind + financial year label ("26-27"), or "all" when numbering never resets. */
export const reserveNumbersBody = z.object({
  kind: z.enum(NUMBER_SERIES),
  period: z.string().regex(/^(\d{2}-\d{2}|all)$/, 'Invalid period'),
  count: z.number().int().min(1).max(MAX_NUMBER_BLOCK),
});
export type ReserveNumbersBody = z.input<typeof reserveNumbersBody>;

/** Numbers a phone held but never used (e.g. on logout); the server hands them out again first. */
export const returnNumbersBody = z.object({
  kind: z.enum(NUMBER_SERIES),
  period: z.string().regex(/^(\d{2}-\d{2}|all)$/, 'Invalid period'),
  numbers: z.array(z.number().int().min(1)).min(1).max(MAX_NUMBER_BLOCK),
});
export type ReturnNumbersBody = z.input<typeof returnNumbersBody>;

export interface ReserveNumbersResponse {
  /** Sequence numbers reserved for this device, in order (e.g. [41, 42, 43]). */
  numbers: number[];
}

/**
 * Reads the series period and sequence number back out of a number like "INV/26-27/0041".
 * Only for documents saved before R1.3; newer ones carry `numberSeries` and `numberSeq`.
 */
export function parseDocNumber(number: string): { period: string; seq: number } | null {
  const m = /(?:\/(\d{2}-\d{2}))?\/(\d+)$/.exec(number.trim());
  if (!m) return null;
  return { period: m[1] ?? 'all', seq: Number(m[2]) };
}
