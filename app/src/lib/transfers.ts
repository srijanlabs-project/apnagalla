import { todayISO } from '@invoice/shared';
import { db, type Item, type StockMove } from './db';
import { t } from './i18n';
import { newId, PermissionError, putRecord, type Actor } from './repo';
import { tracksStock } from './stock';

/**
 * Moving stock between two stores of the same owner: the goods leave one store's stock and enter
 * the other's (two linked entries, one in each store). The item in the other store is found by
 * barcode, then by name; if it isn't there it is added with the same details.
 */

export interface TransferLine {
  itemId: string;
  qty: number;
}

async function itemIn(to: Actor, src: Item): Promise<Item> {
  const there = await db.items.where('businessId').equals(to.businessId).filter((i) => !i.deleted).toArray();
  const name = src.name.trim().toLowerCase();
  const match = (src.barcode ? there.find((i) => i.barcode === src.barcode) : undefined) ?? there.find((i) => i.name.trim().toLowerCase() === name);
  if (match) return match;
  const copy: Partial<Item> = { ...src, id: newId() };
  delete copy.createdAt;
  delete copy.categoryId;
  return putRecord('items', to, copy as Item);
}

export async function transferStock(
  from: Actor,
  to: { businessId: string; name: string; isOwner: boolean },
  fromName: string,
  lines: TransferLine[],
  opts: { note?: string; date?: string } = {},
): Promise<string> {
  if (from.role !== 'owner' || !to.isOwner) throw new PermissionError(t('Only the owner of both stores can move stock between them'));
  if (to.businessId === from.businessId) throw new Error(t('Pick the other store'));
  const toActor: Actor = { ...from, businessId: to.businessId, role: 'owner', seriesCode: '' };
  const transferId = newId();
  const date = opts.date ?? todayISO();
  const note = opts.note?.trim();
  let moved = 0;
  for (const l of lines) {
    const src = await db.items.get(l.itemId);
    if (!src || src.businessId !== from.businessId || !tracksStock(src) || !(l.qty > 0)) continue;
    const dst = await itemIn(toActor, src);
    const base = { kind: 'transfer' as const, reason: 'transfer' as const, date, byName: from.userName, transferId };
    await putRecord('stockMoves', from, {
      ...base,
      id: newId(),
      itemId: src.id,
      itemName: src.name,
      qty: -l.qty,
      note: t('To {store}', { store: to.name }) + (note ? ` · ${note}` : ''),
      otherBusinessId: to.businessId,
    } as StockMove);
    await putRecord('stockMoves', toActor, {
      ...base,
      id: newId(),
      itemId: dst.id,
      itemName: dst.name,
      qty: l.qty,
      note: t('From {store}', { store: fromName }) + (note ? ` · ${note}` : ''),
      otherBusinessId: from.businessId,
    } as StockMove);
    moved++;
  }
  if (!moved) throw new Error(t('Add items with a quantity'));
  return transferId;
}

export interface TransferSummary {
  transferId: string;
  date: string;
  out: boolean;
  otherBusinessId: string;
  lines: { name: string; qty: number }[];
  byName?: string;
}

/** This store's transfers, newest first. */
export async function transfersOf(businessId: string): Promise<TransferSummary[]> {
  const moves = await db.stockMoves.where('businessId').equals(businessId).filter((m) => m.kind === 'transfer' && !!m.transferId && !m.voidedAt && !m.deleted).toArray();
  const map = new Map<string, TransferSummary>();
  for (const m of moves) {
    let s = map.get(m.transferId!);
    if (!s) map.set(m.transferId!, (s = { transferId: m.transferId!, date: m.date, out: m.qty < 0, otherBusinessId: m.otherBusinessId ?? '', lines: [], byName: m.byName }));
    s.lines.push({ name: m.itemName, qty: Math.abs(m.qty) });
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}
