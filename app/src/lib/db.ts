import Dexie, { type EntityTable } from 'dexie';
import type { ChargeInput, DiscountInput, Dims, GstType, InvoiceTotals, Lang, NumberingMode, PaymentMode, SyncTable, TaxMode, CatalogSection, CatalogItemDto, CatalogAliasDto } from '@invoice/shared';

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
  /** R6: money in the account on `openingDate` (paise; − = overdraft). */
  openingBalance?: number;
  openingDate?: string;
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
    /** Photos attached to a bill, printed on a page after it. Missing = yes. */
    photos?: boolean;
  };
  /** The seller's message in a band at the bottom of every page (offers, timings, thanks). */
  banner?: string;
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
  /** Scanning an item already on the bill asks before adding one more (default yes). */
  confirmRepeatScan?: boolean;
  /** Day-end closing is compulsory (default on): billing waits until the last business day is closed. */
  dayEndRequired?: boolean;
  /** "HH:MM": the store closes; after it Home asks to close the day. */
  closingTime?: string;
  /** Days before this are never asked to be closed (set when the rule is turned on). */
  dayEndFrom?: string;
  /** R8: weighing-scale barcode layout (see lib/scale.ts). */
  scale?: Partial<import('./scale').ScaleSettings>;
  /** R8: godowns inside this store (the shop itself is not listed; it is place ""). */
  godowns?: { id: string; name: string; deleted?: boolean }[];
  /** Staff can't bill on credit beyond a customer's credit limit (the owner still can). */
  creditLimitBlocks?: boolean;
  /** Delivery challans: their own number series. */
  challanPrefix?: string;
  orderPrefix?: string;
  proformaPrefix?: string;
  /** Shared product lists this store uses for suggestions (undefined = not chosen yet). */
  catalogSections?: CatalogSection[];
  /** Suggest products from the list when adding items (default yes). */
  catalogSuggest?: boolean;
  /** Lock saved bills older than this many days (0 / empty = never). */
  lockBillsAfterDays?: number | null;
  /** Books closed up to this date (e.g. the GST return is filed): bills on or before it are locked. */
  booksClosedUntil?: string | null;
  /** R6: the store's own expense and income categories (besides the built-in ones). */
  expenseCategories?: string[];
  incomeCategories?: string[];
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

export type PriceLevel = 'retail' | 'wholesale' | 'special';

export interface Customer extends SyncedRecord {
  name: string;
  /** Wholesale / special customers get those item prices. */
  priceLevel?: PriceLevel;
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
  /** Small photo shown in lists and pickers (JPEG data URL). */
  photo?: string | null;
  /** Sold as non-returnable (the bill line is marked so). */
  nonReturnable?: boolean;
  /** Keep count of stock (default on; off for services). Area-priced items never do. */
  trackStock?: boolean;
  /** Warn and put on the reorder list at or below this stock. */
  lowStock?: number | null;
  /** Usual quantity to order from the supplier. */
  reorderQty?: number | null;
  /** Supplier this item is usually bought from. */
  supplierId?: string | null;
  /** Electronics: each piece has a serial / IMEI number, recorded in and out. */
  trackSerial?: boolean;
  /** R8: the item's code on the weighing scale (PLU), for scale-printed labels. */
  scaleCode?: string;
  /** R8: keeps batch number and expiry (medicines, packaged food…). */
  trackBatch?: boolean;
  /** Warranty from the date of sale, in months. */
  warrantyMonths?: number | null;
  /** Garments etc.: this item only groups its variants (no stock of its own). */
  hasVariants?: boolean;
  /** The shared-list product it was made from (R5). */
  catalogId?: string;
  /** A variant: its parent item and "M · Red". */
  variantOf?: string | null;
  variantLabel?: string;
  /** Other units it is bought or sold in: 1 box = 12 (base unit). Own price optional. */
  altUnits?: { unit: string; factor: number; rate?: number | null }[];
  /** Prices per base unit for customer types; retail is `rate`. */
  prices?: { wholesale?: number | null; special?: number | null };
  /** Last price changes, newest last (at most 20). */
  priceHistory?: { at: string; from: number; to: number; byName?: string }[];
  /** Cost per unit (paise). Hidden from staff unless the store allows it. */
  purchasePrice?: number;
  categoryId?: string | null;
  /** How the item is priced: per unit (default), per square foot, or per running foot. */
  pricing?: Pricing;
}

export type Pricing = 'unit' | 'sqft' | 'rft' | 'sqm' | 'rmt';

/** Size of an area-priced line: length (× width for sq ft) × pieces; qty is worked out from it. */
export type LineDims = Dims;

/* ---------- documents (invoice & estimate share one shape) ---------- */

export interface DocLine {
  id: string;
  /** R8: the order line this bill line delivers. */
  fromLineId?: string;
  /** R8: batch number and expiry month ("YYYY-MM") of a batch item. */
  batch?: string;
  expiry?: string;
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
  /** Base units in one of this line's unit (a box of 12 → 12). Stock moves qty × this. */
  unitFactor?: number;
  /** Serial / IMEI numbers of the pieces on this line. */
  serials?: string[];
  /** Copied from the item: warranty months from the bill date. */
  warrantyMonths?: number | null;
  /** Offer that set this line's discount; "off" = the cashier removed it. */
  offer?: string | null;
  /** Can't be returned (printed on the bill; returns of it need the owner). */
  nonReturnable?: boolean;
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
  /** R8: godown the goods leave from (none = the shop). */
  godownId?: string;
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
  /** Photos attached (a paper bill, a delivery proof); small JPEGs. */
  photos?: string[];
  /** Coupon code typed at billing. */
  coupon?: string | null;
  /** Notes for the shop only: shown in the app, never printed or shared. */
  privateNotes?: string;
  /** Photo taken by the warehouse when the goods were delivered. */
  deliveryPhoto?: string | null;
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
  /** An advance taken for this job (estimate id); used on the job's bill. */
  jobId?: string | null;
  /** Cheque payments: pending until marked cleared (a bounced one is voided). */
  chequeStatus?: 'pending' | 'cleared' | null;
  chequeClearedAt?: string | null;
  chequeClearedByName?: string;
  /** Set for a refund made because of a return. */
  creditNoteId?: string | null;
  kind: 'payment' | 'refund';
  /** Paise, always positive. */
  amount: number;
  mode: PaymentMode;
  /** R6: bank account the money went to (UPI, card, bank, cheque); none = the default account. */
  accountId?: string | null;
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
  /** Set when this estimate is a job (work order or repair): its quote is the estimate's lines. */
  job?: JobInfo | null;
  /** A delivery challan: goods sent before the bill; own number series; takes stock out. */
  challan?: boolean;
  /** R8: a sales order (SO series): billed in one or more parts; pending worked out from the bills. */
  order?: boolean;
  /** R8: a proforma invoice (PI series): a quote in invoice form, often for an advance. */
  proforma?: boolean;
}

export type WorkStage = 'measure' | 'quoted' | 'confirmed' | 'in_progress' | 'ready' | 'delivered' | 'cancelled';
export type RepairStage = 'received' | 'diagnosing' | 'waiting_parts' | 'repaired' | 'delivered' | 'returned';
export type JobStage = WorkStage | RepairStage;

export interface JobInfo {
  kind: 'work' | 'repair';
  stage: JobStage;
  /** "Living room painting", "Shop board 8×4". For repairs: the device. */
  title: string;
  /** Sizes and notes taken at the site. */
  measurements?: string;
  device?: { brand?: string; model?: string; imei?: string; problem?: string; accessories?: string; condition?: string };
  /** Who does the work / repair. */
  assignee?: { userId: string; name: string } | null;
  /** Small JPEG data URLs, at most 6. */
  photos: string[];
  stageHistory: { stage: JobStage; at: string; byName?: string }[];
}

/* ---------- R2: stock, purchases, money ---------- */

export type StockReason = 'opening' | 'damage' | 'theft' | 'expired' | 'count' | 'gift' | 'own_use' | 'other' | 'transfer';

/**
 * Opening stock or a manual change (damage, theft, physical count…). Added, never edited: the
 * owner voids a wrong one. Sales, purchases and returns change stock through their documents.
 */
export interface StockMove extends SyncedRecord {
  itemId: string;
  itemName: string;
  /** + adds stock, − removes it (item's unit). */
  qty: number;
  kind: 'opening' | 'adjust' | 'count' | 'transfer';
  reason: StockReason;
  /** R8: the batch this change is for (expired stock written off, opening stock of a batch). */
  batch?: string;
  expiry?: string;
  /** R8: the godown this change is in (none = the shop); a godown transfer names the other place. */
  godownId?: string;
  fromGodownId?: string;
  toGodownId?: string;
  note?: string;
  date: string;
  byName?: string;
  /** Stock transfer: both stores' entries share this id; the other store. */
  transferId?: string;
  otherBusinessId?: string;
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
  /** R8: usual credit days; a new purchase bill's "pay by" date follows it. */
  creditDays?: number;
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
  /** R8: godown the goods arrived at (none = the shop). */
  godownId?: string;
  kind: 'bill' | 'return';
  status: 'draft' | 'saved' | 'cancelled';
  supplier: SupplierSnapshot | null;
  /** The supplier's own bill number (for a return: our debit note reference). */
  supplierBillNo: string;
  date: string;
  dueDate?: string | null;
  /** R8: add freight, loading and other charges on this bill into the items' cost (default yes). */
  spreadCharges?: boolean;
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
  mode: Exclude<PaymentMode, 'advance' | 'creditnote'>;
  /** R6: bank account paid from (not cash); none = the default account. */
  accountId?: string | null;
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
  /** One of EXPENSE_CATEGORIES or the store's own category name (R6). */
  category: ExpenseCategory | (string & {});
  amount: number;
  mode: Exclude<PaymentMode, 'advance' | 'creditnote'>;
  /** R6: bank account paid from (not cash); none = the default account. */
  accountId?: string | null;
  date: string;
  note?: string;
  /** R6: who was paid (landlord, electricity board…). */
  paidTo?: string;
  /** R6: photo of the bill or receipt (data URL, resized). */
  photo?: string | null;
  /** R6: paid from this repeating expense (rent every month…). */
  recurringId?: string;
  /** R6: the due date it pays (a repeating expense paid late still counts for its month / week). */
  recurringFor?: string;
  paidByName?: string;
  /** Money paid to a staff member: an advance, or salary for a month (less advance recovered). */
  employeeId?: string;
  staffKind?: 'advance' | 'salary';
  /** Salary: the month it is for (YYYY-MM). */
  month?: string;
  /** Salary: advance recovered from it (paise, no cash moves). */
  recovered?: number;
}

/** A person who works in the store (with or without an app login): pay and attendance. */
export interface Employee extends SyncedRecord {
  name: string;
  phone?: string;
  /** What they do (helper, driver…). */
  job?: string;
  /** Paid per month, or per day worked. */
  pay: 'month' | 'day';
  /** Paise per month or per day. */
  rate: number;
  joinDate?: string;
  active: boolean;
}

export type AttendanceStatus = 'present' | 'absent' | 'half' | 'leave';

/** One day's attendance; id = `${employeeId}:${date}`. Days not marked count as present. */
export interface Attendance extends SyncedRecord {
  employeeId: string;
  date: string;
  status: AttendanceStatus;
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

/* ---------- R6: money and books ---------- */

/** Where money sits: the cash drawer or one of the store's bank accounts. */
export type MoneyPlace = 'cash' | string;

/**
 * Money moved between the drawer and a bank account (deposit, withdrawal), between two accounts
 * (transfer), or a correction of an account's balance to what the bank shows (adjust).
 */
export interface MoneyMove extends SyncedRecord {
  kind: 'deposit' | 'withdraw' | 'transfer' | 'adjust';
  /** 'cash' or a bank account id; empty for an adjustment. */
  from: MoneyPlace | null;
  /** 'cash' or a bank account id. */
  to: MoneyPlace | null;
  /** Paise, more than 0; an adjustment may be below 0 (money less than the app shows). */
  amount: number;
  date: string;
  reference?: string;
  note?: string;
  byName?: string;
}

export const INCOME_CATEGORIES = ['interest', 'rent', 'commission', 'scrap', 'discount', 'other'] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

/** Money that isn't from selling: bank interest, rent received, commission, scrap sale… */
export interface Income extends SyncedRecord {
  category: IncomeCategory | (string & {});
  amount: number;
  mode: Exclude<PaymentMode, 'advance' | 'creditnote'>;
  accountId?: string | null;
  date: string;
  from?: string;
  note?: string;
  byName?: string;
  /** Loan given: interest received on it. */
  loanId?: string;
}

/** A loan the store took (bank, person, finance company) or gave. */
export interface Loan extends SyncedRecord {
  kind: 'taken' | 'given';
  /** Lender or borrower: "HDFC Bank", "Ramesh ji". */
  name: string;
  /** Owed on `startDate` (paise): the loan amount, or what was left when it was entered. */
  openingBalance: number;
  startDate: string;
  /** Yearly interest, for reference. */
  interestPct?: number;
  /** Monthly instalment, for reference. */
  emi?: number;
  accountNumber?: string;
  note?: string;
  closed?: boolean;
}

/**
 * Money on a loan. Loan taken: `received` (loan money in), `repaid` (principal paid back),
 * `interest` and `charge` (paid; expenses). Loan given: `given` (lent out), `received` (principal
 * back), `interest` (received; income).
 */
export interface LoanEntry extends SyncedRecord {
  loanId: string;
  kind: 'received' | 'repaid' | 'given' | 'interest' | 'charge';
  amount: number;
  mode: Exclude<PaymentMode, 'advance' | 'creditnote'>;
  accountId?: string | null;
  date: string;
  reference?: string;
  note?: string;
  byName?: string;
}

/** An expense that comes back (rent each month): listed as due, paid with one tap. */
export interface RecurringExpense extends SyncedRecord {
  category: Expense['category'];
  amount: number;
  mode: Exclude<PaymentMode, 'advance' | 'creditnote'>;
  accountId?: string | null;
  paidTo?: string;
  note?: string;
  every: 'month' | 'week';
  /** Month: day of the month (1–28); week: 0 = Sunday … 6. */
  day: number;
  /** First date it is due. */
  startDate: string;
  stopped?: boolean;
}

/* ---------- R3: offers, saved reports ---------- */

export interface Offer extends SyncedRecord {
  name: string;
  active: boolean;
  /** Dates it runs (inclusive); empty = always. */
  from?: string | null;
  to?: string | null;
  /** percent: % off items of a category (or all); amount: ₹ off the bill; buyget: buy N get M free; combo: set price. */
  kind: 'percent' | 'amount' | 'buyget' | 'combo';
  /** ₹ off (paise), for kind amount. */
  amount?: number;
  /** Only on bills of at least this much (paise, before discounts). */
  minBill?: number | null;
  /** A coupon: applies only when this code is typed on the bill. */
  code?: string | null;
  /** Coupon: how many bills may use it in all. */
  maxUses?: number | null;
  pct?: number;
  categoryId?: string | null;
  itemId?: string | null;
  buyQty?: number;
  getQty?: number;
  combo?: { itemId: string; qty: number }[];
  /** Price of one combo set (paise, as the items are priced). */
  comboPrice?: number;
}

/** A report the owner set up (columns, filters, grouping). */
export interface SavedReport extends SyncedRecord {
  name: string;
  spec: unknown;
  /** Add it to the nightly Excel. */
  nightly?: boolean;
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
  offers: EntityTable<Offer, 'id'>;
  savedReports: EntityTable<SavedReport, 'id'>;
  employees: EntityTable<Employee, 'id'>;
  attendance: EntityTable<Attendance, 'id'>;
  moneyMoves: EntityTable<MoneyMove, 'id'>;
  incomes: EntityTable<Income, 'id'>;
  loans: EntityTable<Loan, 'id'>;
  loanEntries: EntityTable<LoanEntry, 'id'>;
  recurringExpenses: EntityTable<RecurringExpense, 'id'>;
  catalogItems: EntityTable<CatalogItemDto, 'id'>;
  catalogAliases: EntityTable<CatalogAliasDto, 'word'>;
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

db.version(6).stores({
  offers: 'id, businessId',
  savedReports: 'id, businessId',
});

db.version(7).stores({
  employees: 'id, businessId',
  attendance: 'id, businessId, employeeId, [businessId+date]',
});

/** The shared product list (not synced: downloaded by section, the same for every shop). */
db.version(8).stores({
  catalogItems: 'id, section',
  catalogAliases: 'word',
});

db.version(9).stores({
  moneyMoves: 'id, businessId, [businessId+date]',
  incomes: 'id, businessId, [businessId+date]',
  loans: 'id, businessId',
  loanEntries: 'id, businessId, loanId, [businessId+date]',
  recurringExpenses: 'id, businessId',
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
  db.offers,
  db.savedReports,
  db.employees,
  db.attendance,
  db.moneyMoves,
  db.incomes,
  db.loans,
  db.loanEntries,
  db.recurringExpenses,
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
