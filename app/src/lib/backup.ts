import { SYNC_TABLES, type SyncTable } from '@invoice/shared';
import { db } from './db';
import { t } from './i18n';
import { PermissionError, putRecord, type Actor } from './repo';

/**
 * R10 full backup and restore. "Back up now" writes every record of the store (bills, customers,
 * items, stock, money, settings… photos included) into one file the owner keeps: share it to
 * Google Drive, WhatsApp to yourself, or save it. "Restore" reads such a file back into the same
 * store: it brings back anything missing or deleted here and anything newer in the file; it never
 * removes or overwrites newer work. The server keeps everything too; this is the owner's own copy.
 */

export interface BackupFile {
  app: 'ApnaGalla';
  version: 1;
  businessId: string;
  storeName: string;
  at: string;
  tables: Partial<Record<SyncTable, Record<string, unknown>[]>>;
}

export async function makeBackup(businessId: string, storeName: string): Promise<BackupFile> {
  const tables: BackupFile['tables'] = {};
  for (const name of SYNC_TABLES) {
    const tbl = db.table(name);
    // Profile and settings are keyed by the store's id; the rest are indexed by businessId.
    const rows = (tbl.schema.idxByName.businessId ? await tbl.where('businessId').equals(businessId).toArray() : await tbl.filter((r: { businessId?: string; id?: string }) => r.businessId === businessId || r.id === businessId).toArray()) as Record<string, unknown>[];
    if (rows.length) tables[name] = rows;
  }
  return { app: 'ApnaGalla', version: 1, businessId, storeName, at: new Date().toISOString(), tables };
}

export const backupFileName = (storeName: string, at = new Date()) => `ApnaGalla-${storeName.replace(/[^\w-]+/g, '-')}-${at.toISOString().slice(0, 10)}.json`;

export function readBackup(text: string): BackupFile {
  const b = JSON.parse(text) as BackupFile;
  if (b?.app !== 'ApnaGalla' || b.version !== 1 || typeof b.businessId !== 'string' || !b.tables) throw new Error(t('That isn’t an ApnaGalla backup file'));
  return b;
}

/** What a restore would do: per table, records it brings back. */
export async function restorePlan(b: BackupFile): Promise<{ table: SyncTable; rows: Record<string, unknown>[] }[]> {
  const out: { table: SyncTable; rows: Record<string, unknown>[] }[] = [];
  for (const name of SYNC_TABLES) {
    const rows = b.tables[name] ?? [];
    const take: Record<string, unknown>[] = [];
    for (const r of rows) {
      const here = (await db.table(name).get(r.id as string)) as Record<string, unknown> | undefined;
      const missing = !here;
      const deletedHere = here?.deleted === true && r.deleted !== true;
      const newer = !!here && String(r.updatedAt ?? '') > String(here.updatedAt ?? '');
      if (missing || deletedHere || newer) take.push(r);
    }
    if (take.length) out.push({ table: name, rows: take });
  }
  return out;
}

/** Restores into the same store (owner). Returns how many records came back. */
export async function restoreBackup(actor: Actor, b: BackupFile): Promise<number> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can do this'));
  if (b.businessId !== actor.businessId) throw new Error(t('This backup is of another store ({name})', { name: b.storeName }));
  let n = 0;
  for (const { table, rows } of await restorePlan(b)) {
    for (const r of rows) {
      await putRecord(table, actor, { ...(r as { id: string }), businessId: actor.businessId, deleted: r.deleted === true });
      n++;
    }
  }
  return n;
}
