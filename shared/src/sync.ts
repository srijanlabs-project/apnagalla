import { z } from 'zod';
import { NUMBER_SERIES } from './gst';

/** Every table the phone keeps offline and syncs with the server. */
export const SYNC_TABLES = ['profiles', 'settings', 'bankAccounts', 'upiIds', 'customers', 'items', 'invoices', 'estimates', 'creditNotes'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Store details and credit notes: only the owner may change them. */
export const OWNER_ONLY_TABLES: readonly SyncTable[] = ['profiles', 'settings', 'bankAccounts', 'upiIds', 'creditNotes'];

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
