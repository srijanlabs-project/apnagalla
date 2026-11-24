import { NUMBER_SERIES, SYNC_PUSH_MAX, financialYearLabel, todayISO, type MeResponse, type NumberSeries, type SyncPushResult, type SyncTable } from '@invoice/shared';
import type { Table } from 'dexie';
import { ApiError, NetworkError, api } from './api';
import { db, getMeta, setMeta, type SyncedRecord } from './db';
import { CAN_CREATE_INVOICES } from './platform';
import { blockTarget, effectiveGstType, isPersonalSeries, noteUsedNumber, numberPoolKey, setNumberAllocator, settingsOf } from './repo';
import { KEYS, kv } from './storage';

/**
 * Phone side of offline sync:
 *   push: send queued local changes (outbox) for every store this person works in;
 *   pull: fetch every change after this phone's cursor, per store;
 *   numbers: for shared series, keep a block sized to this phone's use; give back blocks it no
 *   longer needs (series per person needs no block). See repo numbering.
 * Runs on app open, when the internet returns, a few seconds after each save, and every few
 * minutes. Only one run at a time.
 */

export interface SyncState {
  running: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Changes the server refused (e.g. staff editing a saved invoice), most recent first. */
  rejected: { table: SyncTable; id: string; reason: string; at: string }[];
}

const NUMBERED: readonly SyncTable[] = ['invoices', 'estimates', 'creditNotes'];

let state: SyncState = { running: false, lastSyncAt: null, lastError: null, rejected: [] };
const listeners = new Set<(s: SyncState) => void>();
let inFlight: Promise<void> | null = null;
let again = false;

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function subscribeSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

const table = (name: SyncTable) => db.table(name) as Table<SyncedRecord, string>;
const cursorKey = (businessId: string) => `sync.cursor:${businessId}`;

/** Numbers come from the server when online (see repo numbering). */
setNumberAllocator(async (businessId, series, period) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  // Short timeout: on a weak connection, fall back to this phone's reserved block quickly.
  const { numbers } = await api.reserveNumbers(businessId, { kind: series, period, count: 1 }, 4_000);
  return numbers[0] ?? null;
});

let lastArgs: [string[], string | null] = [[], null];

/** Re-runs the last sync (e.g. the user tapped the sync chip). */
export function syncAgain(): Promise<void> {
  return syncNow(...lastArgs);
}

/** Sync every store in `businessIds`; numbers are topped up for `current`. Never throws. */
export function syncNow(businessIds: string[], current: string | null): Promise<void> {
  lastArgs = [businessIds, current];
  if (inFlight) {
    again = true; // something changed while syncing: go round once more
    return inFlight;
  }
  inFlight = (async () => {
    setState({ running: true });
    try {
      do {
        again = false;
        for (const id of businessIds) await pushStore(id);
        for (const id of businessIds) await pullStore(id);
        if (current) await topUpNumbers(current);
      } while (again);
      setState({ lastSyncAt: new Date().toISOString(), lastError: null });
    } catch (e) {
      const message =
        e instanceof NetworkError ? null : e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Sync failed';
      setState({ lastError: message });
    } finally {
      setState({ running: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

async function pushStore(businessId: string) {
  for (;;) {
    const entries = await db.outbox.where('businessId').equals(businessId).limit(SYNC_PUSH_MAX).toArray();
    if (!entries.length) return;

    const changes: { table: SyncTable; id: string; data: Record<string, unknown> }[] = [];
    const missing: number[] = [];
    for (const e of entries) {
      const rec = await table(e.table).get(e.recordId);
      if (rec) changes.push({ table: e.table, id: e.recordId, data: rec as unknown as Record<string, unknown> });
      else missing.push(e.seq!);
    }
    if (missing.length) await db.outbox.bulkDelete(missing);
    if (!changes.length) continue;

    let results: SyncPushResult[];
    try {
      ({ results } = await api.syncPush(businessId, { changes }));
    } catch (e) {
      // Paused or removed from this store: keep the changes, try the next store.
      if (e instanceof ApiError && e.status === 403) return;
      throw e;
    }

    const bySeq = new Map(entries.map((e) => [`${e.table}:${e.recordId}`, e.seq!]));
    const rejected: SyncState['rejected'] = [];
    await db.transaction('rw', [db.outbox, ...changes.map((c) => table(c.table))], async () => {
      for (const r of results) {
        const seq = bySeq.get(`${r.table}:${r.id}`);
        if (seq != null) await db.outbox.delete(seq);
        // The server's copy wins (newer edit, or our change wasn't allowed) — unless the record was
        // edited again while we were syncing, in which case that new edit goes out next round.
        if (r.current && !(await hasPending(r.table, r.id))) await table(r.table).put(r.current as unknown as SyncedRecord);
        if (r.status === 'rejected') rejected.push({ table: r.table, id: r.id, reason: r.reason ?? 'Not allowed', at: new Date().toISOString() });
      }
    });
    if (rejected.length) setState({ rejected: [...rejected, ...state.rejected].slice(0, 50) });
    if (entries.length < SYNC_PUSH_MAX) return;
  }
}

async function hasPending(t: SyncTable, id: string) {
  return (await db.outbox.where('[table+recordId]').equals([t, id]).count()) > 0;
}

async function pullStore(businessId: string) {
  let cursor = (await getMeta<number>(cursorKey(businessId))) ?? 0;
  for (;;) {
    let page;
    try {
      page = await api.syncPull(businessId, cursor);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return;
      throw e;
    }
    const tables = [...new Set(page.changes.map((c) => c.table))].map(table);
    await db.transaction('rw', [db.outbox, db.meta, ...tables], async () => {
      for (const ch of page.changes) {
        // A local edit not yet pushed is newer than what we know; it goes out on the next push.
        // Never reuse a number seen on another phone (or this person's old phone).
        const { numberSeries, numberSeq } = ch.data as { numberSeries?: unknown; numberSeq?: unknown };
        if (NUMBERED.includes(ch.table) && typeof numberSeries === 'string' && typeof numberSeq === 'number') {
          await noteUsedNumber(businessId, numberSeries, numberSeq);
        }
        if (await hasPending(ch.table, ch.id)) continue;
        await table(ch.table).put(ch.data as unknown as SyncedRecord);
      }
      await setMeta(cursorKey(businessId), page.cursor);
    });
    cursor = page.cursor;
    if (!page.more) return;
  }
}

/** Keeps a block of numbers for each shared series this phone may use; tops up when half is gone. */
async function topUpNumbers(businessId: string) {
  const s = await settingsOf(businessId);
  const period = s.resetEachFinancialYear ? financialYearLabel(todayISO()) : 'all';
  const kinds: NumberSeries[] = ['estimate'];
  if (CAN_CREATE_INVOICES) {
    kinds.push('invoice');
    // Non-GST bills have their own series only in a regular GST store; credit notes are the owner's.
    if (effectiveGstType(await db.profiles.get(businessId)) === 'regular') kinds.push('bill');
    if (await isOwnerOf(businessId)) kinds.push('credit');
  }
  const shared = kinds.filter((k) => !isPersonalSeries(s, k));
  // Blocks this phone no longer needs (store switched to series per person, or a past year) go back.
  await returnNumbers(businessId, (k) => !shared.includes(k.series) || k.period !== period);
  for (const kind of shared) {
    const key = numberPoolKey(businessId, kind, period);
    const pool = (await getMeta<number[]>(key)) ?? [];
    const target = await blockTarget(businessId, kind);
    if (pool.length >= target / 2) continue;
    try {
      const { numbers } = await api.reserveNumbers(businessId, { kind, period, count: target - pool.length });
      // Re-read: a save may have used a number meanwhile.
      const now = (await getMeta<number[]>(key)) ?? [];
      await setMeta(key, [...now, ...numbers]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return;
      throw e;
    }
  }
}

async function isOwnerOf(businessId: string): Promise<boolean> {
  try {
    const me = await kv.get<MeResponse>(KEYS.me);
    return me?.memberships.some((m) => m.businessId === businessId && m.role === 'owner') ?? false;
  } catch {
    return false;
  }
}

/**
 * Gives unused numbers of this phone's blocks back to the server, so another phone uses them and
 * the series has no gaps. `which` picks the blocks (default: all). Offline, they stay for later.
 */
async function returnNumbers(businessId: string, which: (k: { series: NumberSeries; period: string }) => boolean = () => true) {
  const prefix = `numpool:${businessId}:`;
  const entries = await db.meta.where('key').startsWith(prefix).toArray();
  for (const e of entries) {
    const [series, period] = e.key.slice(prefix.length).split(':') as [NumberSeries, string];
    if (!NUMBER_SERIES.includes(series) || !period || !which({ series, period })) continue;
    const numbers = (e.value as number[] | undefined) ?? [];
    try {
      if (numbers.length) await api.returnNumbers(businessId, { kind: series, period, numbers });
      await db.meta.delete(e.key);
    } catch (err) {
      if (err instanceof NetworkError) return;
      if (err instanceof ApiError && err.status === 403) return;
      throw err;
    }
  }
}

/** Before logging out: hand back every unused number this phone holds, in all its stores. */
export async function returnAllNumbers(businessIds: string[]): Promise<void> {
  for (const id of businessIds) {
    try {
      await returnNumbers(id);
    } catch {
      // Best effort: a failure only leaves a gap in the series.
    }
  }
}
