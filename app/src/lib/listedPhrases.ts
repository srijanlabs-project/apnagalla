import { t } from './i18n';

/**
 * Phrases kept as English in lists and translated where they are shown (status names, filter
 * chips, option labels). Listed here only so `node scripts/i18n.mjs` finds them; never called.
 */
export const LISTED_PHRASES = () => [
  // Invoice / credit note / estimate status (StatusBadge) and list filters (DocListScreen)
  t('All'), t('Draft'), t('Cancelled'), t('Credited'), t('Refund due'), t('Paid'), t('Overdue'), t('Partly paid'), t('Unpaid'), t('Saved'),
  t('Open'), t('Accepted'), t('Declined'), t('Converted'),
  // Payment terms (InvoiceSettingsScreen, DocEditorScreen)
  t('Due on receipt'), t('Net 7 days'), t('Net 15 days'), t('Net 30 days'), t('Net 45 days'), t('Net 60 days'),
  // Number styles (InvoiceSettingsScreen)
  t('INV/0001 (never restarts)'),
  // Credit note reasons (DocEditorScreen)
  t('Goods returned'), t('Price reduced / discount after sale'), t('Other correction'),
  // Invoice design: what to show (DesignScreen)
  t('Logo'), t('Tax ID'), t('Ship-to address'), t('Item description'), t('Unit column'), t('Discount column'), t('Tax column'), t('Bank details'), t('UPI QR code'),
  t('Signature'), t('Terms & conditions'), t('Amount in words'), t('MRP column'),
  // Invoice design: templates (DesignScreen)
  t('Classic'), t('Modern'), t('Minimal'), t('Bordered table, traditional'), t('Colour header band'), t('Black & white, saves ink'),
];
