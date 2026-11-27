/** Why a credit note is made. */
export const CREDIT_REASONS = [
  { value: 'return' as const, label: 'Goods returned' },
  { value: 'price' as const, label: 'Price reduced / discount after sale' },
  { value: 'other' as const, label: 'Other correction' },
];
// i18n: labels above are translated where rendered
