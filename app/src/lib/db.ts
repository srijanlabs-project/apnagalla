import Dexie, { type EntityTable } from 'dexie';

/**
 * Local offline database (IndexedDB via Dexie) — the app reads and writes here first;
 * the sync engine (M3) pushes `outbox` entries to the server and pulls remote changes.
 *
 * Every synced record carries the same bookkeeping fields:
 *   id         client-generated UUID (so records can be created offline)
 *   businessId which business it belongs to
 *   updatedAt  ISO timestamp of the last local change
 *   deleted    soft-delete flag (deletes must sync too)
 * Entity-specific fields are added in M2; only indexed fields are declared in the schema.
 */
export interface SyncedRecord {
  id: string;
  businessId: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface Customer extends SyncedRecord {
  name: string;
  phone?: string;
}

export interface Item extends SyncedRecord {
  name: string;
}

export interface Invoice extends SyncedRecord {
  number?: string;
  customerId?: string;
  date: string;
  status: 'draft' | 'saved' | 'cancelled';
}

export interface Estimate extends SyncedRecord {
  number?: string;
  customerId?: string;
  date: string;
}

/** A local change waiting to be pushed to the server. */
export interface OutboxEntry {
  seq?: number;
  table: 'customers' | 'items' | 'invoices' | 'estimates';
  recordId: string;
  businessId: string;
  op: 'upsert' | 'delete';
  createdAt: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export const db = new Dexie('invoice-app') as Dexie & {
  customers: EntityTable<Customer, 'id'>;
  items: EntityTable<Item, 'id'>;
  invoices: EntityTable<Invoice, 'id'>;
  estimates: EntityTable<Estimate, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<MetaEntry, 'key'>;
};

db.version(1).stores({
  customers: 'id, businessId, [businessId+name], updatedAt',
  items: 'id, businessId, [businessId+name], updatedAt',
  invoices: 'id, businessId, [businessId+date], [businessId+number], customerId, updatedAt',
  estimates: 'id, businessId, [businessId+date], customerId, updatedAt',
  outbox: '++seq, [table+recordId], businessId',
  meta: 'key',
});

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Ask the browser/WebView not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported — fine */
  }
}

/** Wipes all local business data (used on logout). */
export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', [db.customers, db.items, db.invoices, db.estimates, db.outbox, db.meta], async () => {
    await Promise.all([db.customers.clear(), db.items.clear(), db.invoices.clear(), db.estimates.clear(), db.outbox.clear(), db.meta.clear()]);
  });
}

export async function pendingChangesCount(): Promise<number> {
  return db.outbox.count();
}
