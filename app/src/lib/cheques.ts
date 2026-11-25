import { db, type PaymentEntry } from './db';
import { t } from './i18n';
import { putRecord, voidPayment, type Actor } from './repo';

/** Customer cheques: pending ones still to be deposited / cleared. One cheque may pay several bills. */
export interface ChequeGroup {
  key: string;
  entries: PaymentEntry[];
  amount: number;
  number: string;
  date: string;
  customerId?: string | null;
  status: 'pending' | 'cleared';
}

export async function cheques(businessId: string): Promise<ChequeGroup[]> {
  const pays = await db.payments.where('businessId').equals(businessId).filter((p) => p.mode === 'cheque' && p.kind === 'payment' && !p.voidedAt && !p.deleted && !!p.chequeStatus).toArray();
  const groups = new Map<string, ChequeGroup>();
  for (const p of pays) {
    const key = p.receiptId ?? p.id;
    const g = groups.get(key) ?? { key, entries: [], amount: 0, number: p.reference ?? '', date: p.date, customerId: p.customerId, status: 'cleared' as const };
    g.entries.push(p);
    g.amount += p.amount;
    if (p.chequeStatus === 'pending') g.status = 'pending';
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function markCleared(actor: Actor, g: ChequeGroup): Promise<void> {
  const at = new Date().toISOString();
  for (const p of g.entries) if (p.chequeStatus === 'pending') await putRecord('payments', actor, { ...p, chequeStatus: 'cleared', chequeClearedAt: at, chequeClearedByName: actor.userName });
}

/** Bounced: the owner voids the entries; the bills are pending again. */
export async function markBounced(actor: Actor, g: ChequeGroup, note?: string): Promise<void> {
  for (const p of g.entries) await voidPayment(actor, p.id, [t('Cheque bounced'), note].filter(Boolean).join(': '));
}
