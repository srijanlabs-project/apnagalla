import type { BusinessSettings } from './db';
import { t } from './i18n';

/**
 * Features only some kinds of shop need. Each is shown (in More, item form, bills, reports) only when
 * the shop turns it on in Invoice settings → Shop features, so a hardware shop never sees medicine schedules.
 */
export const SHOP_EXTRAS = [
  { key: 'jobs', label: () => t('Jobs and repairs'), note: () => t('Repair and job-work orders with stages and advances.') },
  { key: 'jewellery', label: () => t('Gold and silver (jewellery)'), note: () => t('Day’s gold and silver rates; pieces priced by weight with making and wastage.') },
  { key: 'pharmacy', label: () => t('Medicines (pharmacy)'), note: () => t('Schedule H / H1 / X on medicines and the Schedule H register.') },
  { key: 'vouchers', label: () => t('Gift vouchers'), note: () => t('Sell gift vouchers and take them as payment.') },
  { key: 'rentals', label: () => t('Rentals'), note: () => t('Things given on rent by the day, with deposit and return.') },
  { key: 'loyalty', label: () => t('Loyalty points'), note: () => t('Points on every bill, used as payment later.') },
  { key: 'onlineStore', label: () => t('Online store'), note: () => t('A web page where customers see your items and order.') },
] as const;
export type ShopExtra = (typeof SHOP_EXTRAS)[number]['key'];

/** On when the shop switched it on; before any choice, on only if the shop already set it up. */
export function extraOn(s: BusinessSettings, key: ShopExtra): boolean {
  const chosen = s.extras?.[key];
  if (chosen != null) return chosen;
  switch (key) {
    case 'jobs':
      return true;
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
