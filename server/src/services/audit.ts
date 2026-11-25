import type { DB } from '../db/client';
import { auditLog } from '../db/schema';

/**
 * Sensitive actions, kept for the admin panel and support: staff paused or removed, payments
 * voided, bills cancelled, store details or prices changed, stores suspended. Never blocks the
 * action it records.
 */
export async function audit(db: DB, e: { businessId?: string | null; actorUserId?: string | null; action: string; detail?: Record<string, unknown> }): Promise<void> {
  try {
    await db.insert(auditLog).values({ businessId: e.businessId ?? null, actorUserId: e.actorUserId ?? null, action: e.action, detail: e.detail ?? null });
  } catch {
    // Recording must never break the request itself.
  }
}
