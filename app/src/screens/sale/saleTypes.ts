import type { Invoice, Item } from '../../lib/db';
import type { computeTotals } from '../../lib/repo';

/** What the parts of New sale share: the bill being made, what is on screen, and what each button does. */
export type SaleCtx = {
  bill: Invoice;
  items: Item[] | undefined;
  matches: Item[];
  byAmount: { amount: number; found: Item[] } | null;
  totals: ReturnType<typeof computeTotals>;
  done: { invoice: Invoice; paid: number; change: number } | null;
} & Record<'patch' | 'q' | 'setQ' | 'addItem' | 'addForAmount' | 'byBarcode' | 'setScanning' | 'setEditing' | 'settings' | 'perms' | 'level' | 'custom' | 'step' | 'walkIn' | 'exchange' | 'actor' | 'creditUse' | 'setCreditUse' | 'setCreditPick' | 'pointsLeft' | 'usePoints' | 'setUsePoints' | 'pointsValue' | 'voucherUse' | 'setVoucherUse' | 'voucherValue' | 'askVoucher' | 'couponOpen' | 'setCouponOpen' | 'regular' | 'setPicker' | 'printer' | 'whatsappText' | 'shareBill' | 'startNew' | 'giveBackBefore' | 'giveBackAfter', any>;
