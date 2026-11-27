import { useLiveQuery } from 'dexie-react-hooks';
import { getMeta, setMeta } from './db';
import { t } from './i18n';

/** The figures Home can show; each phone picks which (More → Home screen). */
export const HOME_CARDS = [
  { key: 'sales', label: () => t('Today’s sales') },
  { key: 'cash', label: () => t('Cash in drawer') },
  { key: 'received', label: () => t('Received today: cash / UPI') },
  { key: 'credit', label: () => t('Given on credit today') },
  { key: 'collect', label: () => t('To collect (all customers)') },
  { key: 'deliveries', label: () => t('Urgent deliveries (next 48 hours)') },
  { key: 'payable', label: () => t('To pay suppliers') },
  { key: 'bank', label: () => t('In bank accounts') },
  { key: 'purchases', label: () => t('Purchases this month') },
  { key: 'stock', label: () => t('Stock value (at cost)') },
  { key: 'income', label: () => t('Other income this month') },
  { key: 'expenses', label: () => t('Expenses this month') },
  { key: 'profit', label: () => t('Profit this month') },
  { key: 'lowStock', label: () => t('Low on stock') },
] as const;
export type HomeCard = (typeof HOME_CARDS)[number]['key'];

/** Hidden until switched on: the money-heavy figures. */
export const HIDDEN_BY_DEFAULT: HomeCard[] = ['payable', 'purchases', 'stock', 'profit'];
const KEY = 'home.cards';

export async function homeCardsShown(): Promise<Set<HomeCard>> {
  const saved = await getMeta<HomeCard[]>(KEY);
  return new Set(saved ?? HOME_CARDS.map((c) => c.key).filter((k) => !HIDDEN_BY_DEFAULT.includes(k)));
}

export async function setHomeCard(key: HomeCard, on: boolean): Promise<void> {
  const now = await homeCardsShown();
  if (on) now.add(key);
  else now.delete(key);
  await setMeta(KEY, [...now]);
}

export const useHomeCards = () => useLiveQuery(() => homeCardsShown(), []);
