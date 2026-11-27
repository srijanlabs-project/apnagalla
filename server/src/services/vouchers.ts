import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { syncRecords } from '../db/schema';

type Data = Record<string, unknown>;

export interface VoucherState {
  code: string;
  amount: number;
  left: number;
  uses: number;
  singleUse: boolean;
  validTill: string | null;
}

/**
 * What is left on a gift voucher, worked out on the server from every phone's synced payments.
 * Vouchers are paid with only while online, so this is the one place that sees all uses.
 */
export async function voucherState(db: DB, businessId: string, rawCode: string, exceptPaymentId?: string): Promise<VoucherState | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;
  const [v] = await db
    .select({ data: syncRecords.data })
    .from(syncRecords)
    .where(and(eq(syncRecords.businessId, businessId), eq(syncRecords.tableName, 'vouchers'), eq(syncRecords.deleted, false), sql`upper(${syncRecords.data}->>'code') = ${code}`))
    .limit(1);
  const voucher = v?.data as Data | undefined;
  if (!voucher || voucher.voidedAt) return null;
  const pays = await db
    .select({ id: syncRecords.id, data: syncRecords.data })
    .from(syncRecords)
    .where(
      and(
        eq(syncRecords.businessId, businessId),
        eq(syncRecords.tableName, 'payments'),
        eq(syncRecords.deleted, false),
        sql`${syncRecords.data}->>'mode' = 'voucher'`,
        sql`upper(${syncRecords.data}->>'reference') = ${code}`,
      ),
    );
  const live = pays.filter((p) => p.id !== exceptPaymentId && !(p.data as Data).voidedAt);
  const used = live.reduce((a, p) => a + ((p.data as Data).kind === 'refund' ? -1 : 1) * Number((p.data as Data).amount ?? 0), 0);
  const uses = live.filter((p) => (p.data as Data).kind !== 'refund').length;
  const amount = Number(voucher.amount ?? 0);
  const singleUse = voucher.singleUse === true;
  return { code, amount, left: singleUse && uses > 0 ? 0 : Math.max(0, amount - used), uses, singleUse, validTill: typeof voucher.validTill === 'string' ? voucher.validTill : null };
}

/** A new voucher payment that would take more than is left (or reuse a one-use voucher) is refused. */
export async function voucherPaymentProblem(db: DB, businessId: string, payment: Data, paymentId: string, today: string): Promise<string | null> {
  if (payment.mode !== 'voucher' || payment.kind === 'refund' || payment.voidedAt || payment.deleted) return null;
  const s = await voucherState(db, businessId, String(payment.reference ?? ''), paymentId);
  if (!s) return 'No gift voucher with this code';
  if (s.validTill && s.validTill < today) return 'This voucher has expired';
  if (s.singleUse && s.uses > 0) return 'This voucher was for one use and is already used';
  if (Number(payment.amount ?? 0) > s.left) return `Only ₹${(s.left / 100).toFixed(2)} is left on this voucher`;
  return null;
}
