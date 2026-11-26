import { todayISO } from '@invoice/shared';
import { db, type BusinessSettings, type DocLine, type Item, type Recipe, type StockMove } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { newId, PermissionError, putRecord, type Actor } from './repo';
import { stockLevels } from './stock';

/** R11 modules for particular trades: jewellery, bakery and sweets (recipes), pharmacy. */

/* ---------- jewellery ---------- */

export interface JewelLine {
  metal: 'gold' | 'silver';
  /** Grams. */
  weight: number;
  /** Karat for gold (24, 22, 18…); purity % for silver (e.g. 92.5). */
  purity: number;
  /** Making: % of metal value, or ₹ per gram (paise). */
  making: number;
  makingType: 'pct' | 'perGram';
  /** Wastage % added to the weight charged. */
  wastagePct: number;
  /** Stones and other charges (paise). */
  stones: number;
}

export const jewelleryOf = (s: Pick<BusinessSettings, 'jewellery'>) => s.jewellery ?? null;

/** Fine-metal fraction of a purity: 22K → 22/24; silver 92.5 → 0.925. */
export const fineness = (j: Pick<JewelLine, 'metal' | 'purity'>) => (j.metal === 'gold' ? j.purity / 24 : j.purity / 100);

/** Price of one piece before GST: metal (weight + wastage, at the day's rate for its purity) + making + stones. */
export function jewelPrice(j: JewelLine, rates: { gold24: number; silver999: number }): { metal: number; making: number; total: number } {
  const perGramFine = j.metal === 'gold' ? rates.gold24 : rates.silver999;
  const weight = j.weight * (1 + j.wastagePct / 100);
  const metal = Math.round(weight * fineness(j) * perGramFine);
  const making = Math.round(j.makingType === 'pct' ? (metal * j.making) / 100 : j.weight * j.making);
  return { metal, making, total: metal + making + Math.round(j.stones) };
}

/** Old gold / silver taken in: weight × fineness × the day's rate, less a deduction %. */
export function oldMetalValue(metal: 'gold' | 'silver', weight: number, purity: number, deductionPct: number, rates: { gold24: number; silver999: number }): number {
  const fine = weight * fineness({ metal, purity });
  return Math.round(fine * (metal === 'gold' ? rates.gold24 : rates.silver999) * (1 - deductionPct / 100));
}

/** "Gold 22K 10.250 g · wastage 8% · making 12%" printed under the line. */
export function jewelText(l: Pick<DocLine, 'jewel'>): string {
  const j = l.jewel;
  if (!j) return '';
  const purity = j.metal === 'gold' ? `${j.purity}K` : `${j.purity}%`;
  return [`${j.metal === 'gold' ? 'Gold' : 'Silver'} ${purity} ${j.weight.toFixed(3)} g`, j.wastagePct ? `wastage ${j.wastagePct}%` : '', j.making ? (j.makingType === 'pct' ? `making ${j.making}%` : `making ₹${(j.making / 100).toFixed(2)}/g`) : '', j.stones ? `stones ₹${(j.stones / 100).toFixed(2)}` : '']
    .filter(Boolean)
    .join(' · ');
}

/* ---------- bakery and sweets ---------- */

export async function saveRecipe(actor: Actor, r: Omit<Recipe, 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>): Promise<Recipe> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can do this'));
  if (!(r.yieldQty > 0) || !r.inputs.length) throw new Error(t('A recipe needs what it makes and what goes in'));
  return putRecord('recipes', actor, r as Recipe);
}

/** Made today: the finished goods come into stock and the raw material used goes out (by the recipe). */
export async function produce(actor: Actor, recipe: Recipe, qty: number, date = todayISO()): Promise<{ used: { name: string; qty: number; short: boolean }[] }> {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
  if (!(qty > 0)) throw new Error(t('Enter how many were made'));
  const levels = await stockLevels(actor.businessId);
  const factor = qty / recipe.yieldQty;
  const batch = newId();
  const used: { name: string; qty: number; short: boolean }[] = [];
  await putRecord('stockMoves', actor, { id: newId(), itemId: recipe.itemId, itemName: recipe.itemName, qty: Math.round(qty * 1000) / 1000, kind: 'adjust', reason: 'production', note: t('Made {n}', { n: qty }), date, byName: actor.userName, transferId: batch } as StockMove);
  for (const i of recipe.inputs) {
    const q = Math.round(i.qty * factor * 1000) / 1000;
    used.push({ name: i.name, qty: q, short: (levels.get(i.itemId) ?? 0) < q });
    await putRecord('stockMoves', actor, { id: newId(), itemId: i.itemId, itemName: i.name, qty: -q, kind: 'adjust', reason: 'production', note: t('Used for {item}', { item: recipe.itemName }), date, byName: actor.userName, transferId: batch } as StockMove);
  }
  return { used };
}

/** Cost of one unit made by the recipe (raw material at purchase price). */
export async function recipeCost(r: Recipe): Promise<number> {
  const items = await db.items.bulkGet(r.inputs.map((i) => i.itemId));
  return Math.round(r.inputs.reduce((a, i, k) => a + i.qty * (items[k]?.purchasePrice ?? 0), 0) / r.yieldQty);
}

/* ---------- pharmacy ---------- */

export const SCHEDULES: NonNullable<Item['schedule']>[] = ['H', 'H1', 'X'];

/** Bills selling a scheduled drug need the prescription details. */
export async function needsPrescription(lines: DocLine[]): Promise<boolean> {
  const ids = lines.map((l) => l.itemId).filter((x): x is string => !!x);
  if (!ids.length) return false;
  return (await db.items.bulkGet(ids)).some((i) => !!i?.schedule);
}

/** Schedule H1 (and H, X) register: every sale of a scheduled drug with patient, doctor and batch. */
export async function scheduleRegister(businessId: string, from: string, to: string): Promise<ExportTable> {
  const [bills, items] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && i.date >= from && i.date <= to).toArray(),
    db.items.where('businessId').equals(businessId).filter((i) => !!i.schedule).toArray(),
  ]);
  const sched = new Map(items.map((i) => [i.id, i.schedule!]));
  const rows: (string | number)[][] = [];
  for (const b of bills.sort((a, c) => (a.date + a.number).localeCompare(c.date + c.number)))
    for (const l of b.lines) {
      if (!l.itemId || !sched.has(l.itemId)) continue;
      rows.push([b.date, b.number, sched.get(l.itemId)!, l.name, l.batch ?? '', l.qty, b.rx?.patient || b.billTo?.name || '', b.rx?.doctor ?? '', b.rx?.number ?? '']);
    }
  return {
    title: t('Schedule H / H1 register'),
    subtitle: [`${from.split('-').reverse().join('/')} – ${to.split('-').reverse().join('/')}`],
    landscape: true,
    columns: [{ label: t('Date'), kind: 'date' }, { label: t('Bill') }, { label: t('Schedule') }, { label: t('Drug') }, { label: t('Batch') }, { label: t('Qty'), kind: 'qty' }, { label: t('Patient') }, { label: t('Doctor') }, { label: t('Prescription no.') }],
    rows,
    fileBase: `Schedule-register-${from}-${to}`,
  };
}
