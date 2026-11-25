import Dexie, { type EntityTable } from 'dexie';
import type { ChargeInput, DiscountInput, Dims, GstType, InvoiceTotals, Lang, NumberingMode, PaymentMode, SyncTable, TaxMode } from '@invoice/shared';

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
  /** GST registration. Missing on stores set up before R1.3: see effectiveGstType(). */
  gstType?: GstType;
  /** Label + value of the store's tax ID. For a GST-registered store: "GSTIN" + the GSTIN. */
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
    /** MRP column on bills (items that have an MRP). */
    mrpColumn: boolean;
  };
}

export interface BusinessSettings extends SyncedRecord {
  /** Tax invoices (and every bill of a store not registered for regular GST). */
  invoicePrefix: string;
  /** Non-GST bills of a regular GST store: a separate series. */
  billPrefix: string;
  estimatePrefix: string;
  creditNotePrefix: string;
  /** e.g. "{PREFIX}/{FY}/{SEQ}" — see formatNumber() in shared/gst.ts. */
  numberPattern: string;
  numberDigits: number;
  /** perPerson: each person's own series (default); shared: one series, blocks of numbers per phone. */
  numberingMode: NumberingMode;
  /** Job-work shops: items priced per sq ft or running foot, with sizes on the bill. */
  areaBilling: boolean;
  /** Language of printed receipts (labels and amount in words). PDFs stay English for now. */
  billLanguage: Lang;
  /** Staff must lock the app with a PIN / fingerprint on their phones. */
  staffMustLock: boolean;
  /** Staff may see items' purchase price. Off: the server never sends it to staff phones. */
  staffSeeCost: boolean;
  /** "HH:MM": when the day-before delivery alert rings. */
  deliveryAlertTime: string;
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
  /** Warn when what the customer owes would go above this (paise). */
  creditLimit?: number | null;
  phone?: string;
  email?: string;
  billingAddress: Address;
  shippingAddress?: Address | null;
  /** GSTIN of a registered customer. */
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
  /** HSN (goods) or SAC (services) code. */
  hsn?: string;
  /** Printed barcode (EAN / UPC / Code 128…) for scanning. */
  barcode?: string;
  /** The shop's own item code / SKU. */
  code?: string;
  /** Maximum retail price per unit, incl. tax (paise). */
  mrp?: number;
  /** Keep count of stock (default on; off for services). Area-priced items never do. */
  trackStock?: boolean;
  /** Warn and put on the reorder list at or below this stock. */
  lowStock?: number | null;
  /** Usual quantity to order from the supplier. */
  reorderQty?: number | null;
  /** Supplier this item is usually bought from. */
  supplierId?: string | null;
  /** Cost per unit (paise). Hidden from staff unless the store allows it. */
  purchasePrice?: number;
  categoryId?: string | null;
  /** How the item is priced: per unit (default), per square foot, or per running foot. */
  pricing?: Pricing;
}

export type Pricing = 'unit' | 'sqft' | 'rft';

/** Size of an area-priced line: length (× width for sq ft) × pieces; qty is worked out from it. */
export type LineDims = Dims;

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
  hsn?: string;
  pricing?: Pricing;
  dims?: LineDims | null;
  /** Copied from the item for the optional MRP column. */
  mrp?: number;
}

/** Item category; up to 3 levels (parentId = null for a top level). */
export interface Category extends SyncedRecord {
  name: string;
  parentId: string | null;
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

/** Before R1.4 an invoice kept one editable paid amount; now only read to convert it to an entry. */
export interface PaymentInfo {
  status: 'unpaid' | 'paid' | 'partial';
  amountPaid: number; // paise, ≤ grand total
  date?: string;
  mode?: 'cash' | 'upi' | 'bank' | 'cheque' | 'other';
}

export interface DocBase extends SyncedRecord {
  /** Final number; empty for drafts. */
  number: string;
  /** Series ("bill:26-27") and running number the number came from; the server uses them to never repeat a number. */
  numberSeries?: string;
  numberSeq?: number;
  /** Date the goods or job are due to be delivered (optional), who delivers, and when it was done. */
  deliveryDate?: string | null;
  deliveryAssignee?: { userId: string; name: string } | null;
  deliveredAt?: string | null;
  deliveredByName?: string;
  /** gst = tax invoice; none = bill without GST. Missing on documents from before R1.3 (taxed as entered). */
  taxMode?: TaxMode;
  /** GST state code of the place of supply. null/missing = worked out from the addresses. */
  placeOfSupply?: string | null;
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
  /** Legacy (before R1.4). Money received is in the payments table. */
  payment?: PaymentInfo;
  /** Business details frozen at save time (SPEC §1 snapshot rule). */
  businessSnapshot?: Omit<BusinessProfile, keyof SyncedRecord> | null;
  fromEstimateId?: string | null;
  /** A counter bill put on hold (draft) while the next customer is served. */
  held?: boolean;
  /** Legacy (R1.3): credit notes are now added up from the creditNotes table. */
  credited?: number;
}

/**
 * Money received for a bill (or paid back, for a refund). Added, never edited: a mistake is voided
 * by the owner and stays in the history. Status (paid / partly paid) is worked out from these.
 */
export interface PaymentEntry extends SyncedRecord {
  /** The bill paid; empty for money taken on account (khata payment beyond the bills, advance). */
  invoiceId: string;
  /** The customer: always set on khata payments, also on bill payments made from the khata screen. */
  customerId?: string | null;
  /** Entries split from one khata payment share this. */
  receiptId?: string | null;
  /** Set for a refund made because of a return. */
  creditNoteId?: string | null;
  kind: 'payment' | 'refund';
  /** Paise, always positive. */
  amount: number;
  mode: PaymentMode;
  date: string;
  /** UPI reference, cheque number… */
  reference?: string;
  note?: string;
  receivedBy: string;
  receivedByName?: string;
  voidedAt?: string | null;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

/** Reduces a saved invoice: goods returned or a price cut. Its own number series. */
export interface CreditNote extends DocBase {
  status: 'draft' | 'saved' | 'cancelled';
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  reason: 'return' | 'price' | 'other';
  businessSnapshot?: Omit<BusinessProfile, keyof SyncedRecord> | null;
}

export interface Estimate extends DocBase {
  status: 'draft' | 'open' | 'accepted' | 'declined' | 'converted';
  convertedInvoiceId?: string | null;
  businessSnapshot?: Omit<BusinessProfile, keyof SyncedRecord> | null;
}

/* ---------- R2: stock, purchases, money ---------- */

export type StockReason = 'opening' | 'damage' | 'theft' | 'expired' | 'count' | 'gift' | 'own_use' | 'other';

/**
 * Opening stock or a manual change (damage, theft, physical count…). Added, never edited: the
 * owner voids a wrong one. Sales, purchases and returns change stock through their documents.
 */
export interface StockMove extends SyncedRecord {
  itemId: string;
  itemName: string;
  /** + adds stock, − removes it (item's unit). */
  qty: number;
  kind: 'opening' | 'adjust' | 'count';
  reason: StockReason;
  note?: string;
  date: string;
  byName?: string;
  voidedAt?: string | null;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

export interface Supplier extends SyncedRecord {
  name: string;
  phone?: string;
  email?: string;
  address: Address;
  /** GSTIN of a registered supplier. */
  taxId?: string;
  /** What the store already owed this supplier before using the app (paise). */
  openingBalance: number;
  notes?: string;
}

export interface SupplierSnapshot {
  supplierId: string;
  name: string;
  phone?: string;
  address?: Address;
  taxId?: string;
}

/** A purchase line: cost per unit (`rate`), as on the supplier's bill. */
export interface PurchaseLine extends Omit<DocLine, 'pricing' | 'dims'> {
  /** Selling price to set on the item when the bill is saved (optional). */
  salePrice?: number | null;
}

/** List of items to order from a supplier, sent as a PDF. Becomes a purchase bill when goods arrive. */
export interface PurchaseOrder extends SyncedRecord {
  number: string;
  date: string;
  supplier: SupplierSnapshot | null;
  lines: { id: string; itemId?: string | null; name: string; qty: number; unit: string; rate?: number | null }[];
  notes: string;
  status: 'open' | 'received' | 'cancelled';
  purchaseId?: string | null;
  createdBy: string;
  byName?: string;
}

/**
 * A supplier's bill (goods in: stock goes up, we owe the supplier) or a purchase return / debit
 * note (goods sent back: stock goes down, we owe less).
 */
export interface Purchase extends SyncedRecord {
  kind: 'bill' | 'return';
  status: 'draft' | 'saved' | 'cancelled';
  supplier: SupplierSnapshot | null;
  /** The supplier's own bill number (for a return: our debit note reference). */
  supplierBillNo: string;
  date: string;
  dueDate?: string | null;
  /** gst = bill with GST (input tax credit); none = without GST. */
  taxMode: TaxMode;
  /** Supplier's state is another state → IGST. */
  interState: boolean;
  lines: PurchaseLine[];
  overallDiscount?: DiscountInput | null;
  charges: ChargeInput[];
  roundOff: boolean;
  totals: InvoiceTotals;
  notes: string;
  /** Change the items' cost / MRP / selling price to this bill's when it is saved. */
  updatePrices: boolean;
  fromOrderId?: string | null;
  /** For a return: the bill the goods came on. */
  returnOfId?: string | null;
  /** Photo of the supplier's bill (data URL, resized). */
  photo?: string | null;
  createdBy: string;
  history: HistoryEntry[];
}

/** Money paid to a supplier (or refunded by one). Added, never edited; the owner voids a wrong one. */
export interface SupplierPayment extends SyncedRecord {
  supplierId: string;
  purchaseId?: string | null;
  kind: 'payment' | 'refund';
  amount: number;
  mode: Exclude<PaymentMode, 'advance'>;
  date: string;
  reference?: string;
  note?: string;
  paidByName?: string;
  voidedAt?: string | null;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

export const EXPENSE_CATEGORIES = ['rent', 'salary', 'electricity', 'transport', 'tea', 'repairs', 'phone', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense extends SyncedRecord {
  category: ExpenseCategory;
  amount: number;
  mode: Exclude<PaymentMode, 'advance'>;
  date: string;
  note?: string;
  paidByName?: string;
}

/** Day-end cash count. id = `${businessId}:${date}`. */
export interface DayClose extends SyncedRecord {
  date: string;
  /** Cash the app expected in the drawer (paise). */
  expected: number;
  counted: number;
  /** counted − expected: + excess, − shortage. */
  difference: number;
  note?: string;
  closedByName?: string;
}

/* ---------- sync bookkeeping ---------- */

export type SyncedTable = SyncTable;

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
  creditNotes: EntityTable<CreditNote, 'id'>;
  payments: EntityTable<PaymentEntry, 'id'>;
  categories: EntityTable<Category, 'id'>;
  stockMoves: EntityTable<StockMove, 'id'>;
  suppliers: EntityTable<Supplier, 'id'>;
  purchaseOrders: EntityTable<PurchaseOrder, 'id'>;
  purchases: EntityTable<Purchase, 'id'>;
  supplierPayments: EntityTable<SupplierPayment, 'id'>;
  expenses: EntityTable<Expense, 'id'>;
  dayCloses: EntityTable<DayClose, 'id'>;
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

db.version(2).stores({
  creditNotes: 'id, businessId, [businessId+date], [businessId+number], invoiceId, billTo.customerId, status, updatedAt',
});

db.version(3).stores({
  payments: 'id, businessId, invoiceId, [businessId+date], updatedAt',
  items: 'id, businessId, [businessId+name], [businessId+barcode], updatedAt',
});

db.version(4).stores({
  categories: 'id, businessId, parentId',
});

db.version(5).stores({
  payments: 'id, businessId, invoiceId, customerId, [businessId+date], updatedAt',
  stockMoves: 'id, businessId, itemId, [businessId+date]',
  suppliers: 'id, businessId, [businessId+name]',
  purchaseOrders: 'id, businessId, [businessId+date], supplier.supplierId',
  purchases: 'id, businessId, [businessId+date], supplier.supplierId, status',
  supplierPayments: 'id, businessId, supplierId, [businessId+date]',
  expenses: 'id, businessId, [businessId+date]',
  dayCloses: 'id, businessId, [businessId+date]',
});

export const ALL_TABLES = [
  db.profiles,
  db.settings,
  db.bankAccounts,
  db.upiIds,
  db.customers,
  db.items,
  db.invoices,
  db.estimates,
  db.creditNotes,
  db.payments,
  db.categories,
  db.stockMoves,
  db.suppliers,
  db.purchaseOrders,
  db.purchases,
  db.supplierPayments,
  db.expenses,
  db.dayCloses,
  db.outbox,
  db.meta,
];

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
