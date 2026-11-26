import { db, type PriceLevel } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { levelLabel, priceFor, sellable } from './pricing';

/** A price list to share with customers (PDF or Excel), by category, at one price level. */
export async function priceListTable(businessId: string, opts: { level?: PriceLevel; onlineOnly?: boolean; storeName: string }): Promise<ExportTable> {
  const level = opts.level ?? 'retail';
  const [items, cats] = await Promise.all([db.items.where('businessId').equals(businessId).filter((i) => sellable(i) && (!opts.onlineOnly || !!i.online)).toArray(), db.categories.where('businessId').equals(businessId).toArray()]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const rows = items
    .map((i) => ({ cat: (i.categoryId && catName.get(i.categoryId)) || t('Other'), i }))
    .sort((a, b) => a.cat.localeCompare(b.cat) || a.i.name.localeCompare(b.i.name))
    .map(({ cat, i }) => [cat, i.name, i.unit, priceFor(i, level), i.mrp ?? null]);
  return {
    title: t('Price list'),
    subtitle: [opts.storeName, level === 'retail' ? '' : levelLabel(level)].filter(Boolean),
    columns: [{ label: t('Category') }, { label: t('Item') }, { label: t('Unit') }, { label: t('Price'), kind: 'money' }, { label: 'MRP', kind: 'money' }],
    rows,
    fileBase: `Price-list-${opts.storeName}`.replace(/[^\w-]+/g, '-'),
  };
}

/** Contacts from a .vcf file (the phone's Contacts app can export one): name and Indian mobile. */
export function parseVcf(text: string): { name: string; phone: string; email?: string }[] {
  const out: { name: string; phone: string; email?: string }[] = [];
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    const lines = card.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const get = (key: string) => lines.find((l) => l.toUpperCase().startsWith(key))?.split(':').slice(1).join(':').trim();
    const name = (get('FN') ?? get('N')?.split(';').filter(Boolean).reverse().join(' ') ?? '').replace(/\\,/g, ',').trim();
    const tels = lines.filter((l) => l.toUpperCase().startsWith('TEL')).map((l) => l.split(':').slice(1).join(':').replace(/[^\d+]/g, ''));
    const mobile = tels.map((p) => p.replace(/^(\+91|91|0)(?=[6-9]\d{9}$)/, '')).find((p) => /^[6-9]\d{9}$/.test(p));
    if (!name || !mobile) continue;
    const email = get('EMAIL');
    out.push({ name, phone: `+91${mobile}`, ...(email ? { email } : {}) });
  }
  return out;
}
