import Dexie, { type EntityTable } from 'dexie';
import type { ChargeInput, DiscountInput, InvoiceTotals } from '@invoice/shared';

/**
 * Local offline database (IndexedDB via Dexie). The app reads and writes here first;
 * every write also appends to `outbox`, which the M3 sync engine pushes to the server.
 *
 * Money is integer paise everywhere. Dates are "YYYY-MM-DD".
 * Every synced record carries: id (client UUID), businessId, updatedAt, updatedBy, deleted.
 */
export interface SyncedRecord {
  id: string;
  businessId: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  deleted?: boolean;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pin?: string;
}

/* ---------- business profile & settings (one record each, id = businessId) ---------- */

export interface BusinessProfile extends SyncedRecord {
  name: string;
  legalName?: string;
  logo?: string; // data URL (resized)
  address: Address;
  phone?: string;
  email?: string;
  website?: string;
  taxIdLabel?: string;
  taxIdValue?: string;
  signature?: string; // data URL
}

export interface BankAccount extends SyncedRecord {
  holderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch?: string;
  accountType: 'current' | 'savings';
  isDefault: boolean;
}

export interface UpiId extends SyncedRecord {
  upiId: string;
  payeeName: string;
  isDefault: boolean;
}

export type TemplateId = 'classic' | 'modern' | 'minimal';

export interface DesignSettings {
  template: TemplateId;
  color: string;
  fontSize: 'S' | 'M' | 'L';
  paper: 'A4' | 'A5';
  show: {
    logo: boolean;
    taxId: boolean;
    shipTo: boolean;
    itemDescription: boolean;
    unitColumn: boolean;
    discountColumn: boolean;
    taxColumn: boolean;
    bankDetails: boolean;
    upiQr: boolean;
    signature: boolean;
    terms: boolean;
    amountInWords: boolean;
  };
}

export interface BusinessSettings extends SyncedRecord {
  invoicePrefix: string;
  estimatePrefix: string;
  resetEachFinancialYear: boolean;
  defaultPaymentTermsDays: number; // 0 = due on receipt
  defaultTaxPct: number;
  roundOff: boolean;
  defaultNotes: string;
  defaultTerms: string;
  otherPaymentInstructions: string;
  customFieldLabels: string[]; // up to 3
  units: string[];
  taxRates: number[];
  reminderTemplate: string;
  design: DesignSettings;
}

/* ---------- catalogue ---------- */

export interface Customer extends SyncedRecord {
  name: string;
  phone?: string;
  email?: string;
  billingAddress: Address;
  shippingAddress?: Address | null;
  taxId?: string;
  openingBalance: number; // paise, amount the customer already owed before using the app
}

export interface Item extends SyncedRecord {
  name: string;
  description?: string;
  unit: string;
  rate: number; // paise
  rateIncludesTax: boolean;
  taxPct: number;
}

/* ---------- documents (invoice & estimate share one shape) ---------- */

export interface DocLine {
  id: string;
  itemId?: string | null;
  name: string;
  description?: string;
  qty: number;
  unit: string;
  rate: number;
  rateIncludesTax: boolean;
  taxPct: number;
  discount?: DiscountInput | null;
}

export interface PartySnapshot {
  customerId?: string | null;
  name: string;
  phone?: string;
  email?: string;
  address: Address;
  taxId?: string;
}

export interface HistoryEntry {
  at: string;
  by: string; // user id
  byName?: string;
  action: string; // created, saved, edited, cancelled, payment, converted …
  detail?: string;
}

export interface PaymentInfo {
  status: 'unpaid' | 'paid' | 'partial';
  amountPaid: number; // paise, ≤ grand total
  date?: string;
  mode?: 'cash' | 'upi' | 'bank' | 'cheque' | 'other';
}

export interface DocBase extends SyncedRecord {
  /** Final number; empty for drafts. */
  number: string;
  date: string;
  dueDate?: string;
  paymentTermsDays?: number;
  reference?: string;
  customFields: { label: string; value: string }[];
  billTo: PartySnapshot | null;
  shipTo?: Address | null;
  lines: DocLine[];
  overallDiscount?: DiscountInput | null;
  targetTotal?: number | null;
  charges: ChargeInput[];
  roundOff: boolean;
  notes: string;
  terms: string;
  bankAccountId?: string | null; // null = don't show
  upiIdId?: string | null;
  /** Copy of totals for lists/dashboard; always recomputed on save. */
  totals: InvoiceTotals;
  createdBy: string;
  history: HistoryEntry[];
}

export interface Invoice extends DocBase {
  status: 'draft' | 'saved' | 'cancelled';
  payment: PaymentInfo;
  /** Business details frozen at save time (SPEC §1 snapshot rule). */
  businessSnapshot?: Omit<BusinessProfile, keyof SyncedRecord> | null;
  fromEstimateId?: string | null;
}

export interface Estimate extends DocBase {
  status: 'draft' | 'open' | 'accepted' | 'declined' | 'converted';
  convertedInvoiceId?: string | null;
  businessSnapshot?: Omit<BusinessProfile, keyof SyncedRecord> | null;
}

/* ---------- sync bookkeeping ---------- */

export type SyncedTable = 'profiles' | 'settings' | 'bankAccounts' | 'upiIds' | 'customers' | 'items' | 'invoices' | 'estimates';

export interface OutboxEntry {
  seq?: number;
  table: SyncedTable;
  recordId: string;
  businessId: string;
  op: 'upsert' | 'delete';
  createdAt: string;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export const db = new Dexie('apnagalla') as Dexie & {
  profiles: EntityTable<BusinessProfile, 'id'>;
  settings: EntityTable<BusinessSettings, 'id'>;
  bankAccounts: EntityTable<BankAccount, 'id'>;
  upiIds: EntityTable<UpiId, 'id'>;
  customers: EntityTable<Customer, 'id'>;
  items: EntityTable<Item, 'id'>;
  invoices: EntityTable<Invoice, 'id'>;
  estimates: EntityTable<Estimate, 'id'>;
  outbox: EntityTable<OutboxEntry, 'seq'>;
  meta: EntityTable<MetaEntry, 'key'>;
};

db.version(1).stores({
  profiles: 'id',
  settings: 'id',
  bankAccounts: 'id, businessId',
  upiIds: 'id, businessId',
  customers: 'id, businessId, [businessId+name], updatedAt',
  items: 'id, businessId, [businessId+name], updatedAt',
  invoices: 'id, businessId, [businessId+date], [businessId+number], billTo.customerId, status, updatedAt',
  estimates: 'id, businessId, [businessId+date], [businessId+number], billTo.customerId, status, updatedAt',
  outbox: '++seq, [table+recordId], businessId',
  meta: 'key',
});

export const ALL_TABLES = [db.profiles, db.settings, db.bankAccounts, db.upiIds, db.customers, db.items, db.invoices, db.estimates, db.outbox, db.meta];

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
  await db.transaction('rw', ALL_TABLES, async () => {
    await Promise.all(ALL_TABLES.map((t) => t.clear()));
  });
}

export async function pendingChangesCount(): Promise<number> {
  return db.outbox.count();
}
