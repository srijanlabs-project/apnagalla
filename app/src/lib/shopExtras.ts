import type { CatalogSection } from '@invoice/shared';
import type { BusinessSettings } from './db';
import { t } from './i18n';

/**
 * Features only some shops need. Each is shown (in More, item form, bills, reports) only when the shop
 * turns it on in Invoice settings → Shop features, so a new shop starts simple: sale, bills, khata, cash book.
 */
export const SHOP_EXTRAS = [
  { key: 'jobs', label: () => t('Jobs and repairs'), note: () => t('Repair and job-work orders with stages and advances.') },
  { key: 'orders', label: () => t('Sales orders and challans'), note: () => t('Orders billed later, delivery challans, proforma and sale-or-return.') },
  { key: 'books', label: () => t('Books, loans and cheques'), note: () => t('Ledgers, balance sheet, loans and cheque tracking, for an accountant.') },
  { key: 'staff', label: () => t('Staff and salary'), note: () => t('Staff attendance, salary and advances.') },
  { key: 'visits', label: () => t('Field visits'), note: () => t('Salespeople plan and check in at customers.') },
  { key: 'jewellery', label: () => t('Gold and silver (jewellery)'), note: () => t('Day’s gold and silver rates; pieces priced by weight with making and wastage.') },
  { key: 'pharmacy', label: () => t('Medicines (pharmacy)'), note: () => t('Schedule H / H1 / X on medicines and the Schedule H register.') },
  { key: 'vouchers', label: () => t('Gift vouchers'), note: () => t('Sell gift vouchers and take them as payment.') },
  { key: 'rentals', label: () => t('Rentals'), note: () => t('Things given on rent by the day, with deposit and return.') },
  { key: 'loyalty', label: () => t('Loyalty points'), note: () => t('Points on every bill, used as payment later.') },
  { key: 'onlineStore', label: () => t('Online store'), note: () => t('A web page where customers see your items and order.') },
] as const;
export type ShopExtra = (typeof SHOP_EXTRAS)[number]['key'];

/** Stores set up from this day start simple; older ones keep what they had so nothing they use disappears. */
export const SIMPLE_FROM = '2026-11-28';
const isOlderStore = (s: Pick<BusinessSettings, 'createdAt'>) => !!s.createdAt && s.createdAt.slice(0, 10) < SIMPLE_FROM;

/** On when the shop switched it on; before any choice, on only if the shop already set it up (or is an older store). */
export function extraOn(s: BusinessSettings, key: ShopExtra): boolean {
  const chosen = s.extras?.[key];
  if (chosen != null) return chosen;
  switch (key) {
    case 'jobs':
    case 'orders':
    case 'books':
    case 'staff':
    case 'visits':
      return isOlderStore(s);
    case 'jewellery':
      return !!s.jewellery;
    case 'loyalty':
      return !!s.loyalty?.enabled;
    case 'onlineStore':
      return !!s.onlineStore?.enabled;
    default:
      return false;
  }
}

/** What each kind of shop usually needs, switched on when it picks what it sells (never switching anything off). */
const PRESETS: Partial<Record<CatalogSection, { extras?: ShopExtra[]; areaBilling?: boolean }>> = {
  acrylic: { extras: ['jobs', 'orders'], areaBilling: true },
  bakery: { extras: ['jobs', 'orders'] },
  hardware: { extras: ['orders'] },
  garments: { extras: [] },
  fruits_veg: { extras: [] },
  kirana: { extras: [] },
};

export function presetFor(s: BusinessSettings, sections: CatalogSection[]): Partial<BusinessSettings> {
  const extras = { ...s.extras };
  let areaBilling = s.areaBilling;
  for (const sec of sections) {
    const p = PRESETS[sec];
    for (const k of p?.extras ?? []) if (extras[k] == null) extras[k] = true;
    if (p?.areaBilling) areaBilling = true;
  }
  return { extras, areaBilling };
}
