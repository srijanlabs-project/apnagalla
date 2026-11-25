import {
  CATALOG_PAGE,
  catalogId,
  type catalogAliasImportBody,
  type CatalogAliasDto,
  type catalogImportBody,
  type CatalogImportResult,
  type CatalogItemDto,
  type CatalogPage,
  type CatalogSection,
  type CatalogSectionStat,
} from '@invoice/shared';
import { and, asc, count, eq, gt, ilike, max, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DB } from '../db/client';
import { catalogAliases, catalogItems } from '../db/schema';

type Row = typeof catalogItems.$inferSelect;
const nextSeq = () => sql`nextval('catalog_seq')`;

const toDto = (r: Row): CatalogItemDto => ({
  id: r.id,
  section: r.section as CatalogSection,
  category: r.category,
  item: r.item,
  brand: r.brand,
  size: r.size,
  sizeUnit: r.sizeUnit,
  sellUnit: r.sellUnit,
  hsn: r.hsn,
  gstPct: r.gstPct,
  otherNames: r.otherNames ?? [],
  ...(r.deleted ? { deleted: true } : {}),
  seq: Number(r.seq),
});

type Content = Pick<Row, 'category' | 'item' | 'brand' | 'size' | 'sizeUnit' | 'sellUnit' | 'hsn' | 'gstPct' | 'otherNames' | 'notes' | 'deleted'>;
/** What can change on a product (rows that are the same are skipped, so phones download less). */
const content = (r: Content) =>
  JSON.stringify([r.category, r.item, r.brand ?? null, r.size ?? null, r.sizeUnit ?? null, r.sellUnit, r.hsn ?? null, r.gstPct ?? null, r.otherNames ?? [], r.notes ?? null, !!r.deleted]);

/** The shared product list: download for phones, upload and download for the ApnaGalla team. */
export class CatalogService {
  constructor(private readonly db: DB) {}

  /** Changes in a section after `since` (removed rows included, so phones drop them). */
  async page(section: CatalogSection, since: number, limit = CATALOG_PAGE): Promise<CatalogPage<CatalogItemDto>> {
    const rows = await this.db
      .select()
      .from(catalogItems)
      .where(and(eq(catalogItems.section, section), gt(catalogItems.seq, since)))
      .orderBy(asc(catalogItems.seq))
      .limit(limit);
    return { rows: rows.map(toDto), cursor: rows.length ? Number(rows.at(-1)!.seq) : since, more: rows.length === limit };
  }

  async aliasPage(since: number, limit = CATALOG_PAGE): Promise<CatalogPage<CatalogAliasDto>> {
    const rows = await this.db.select().from(catalogAliases).where(gt(catalogAliases.seq, since)).orderBy(asc(catalogAliases.seq)).limit(limit);
    return {
      rows: rows.map((r) => ({ word: r.word, means: r.means, ...(r.deleted ? { deleted: true } : {}), seq: Number(r.seq) })),
      cursor: rows.length ? Number(rows.at(-1)!.seq) : since,
      more: rows.length === limit,
    };
  }

  async stats(): Promise<CatalogSectionStat[]> {
    const rows = await this.db
      .select({ section: catalogItems.section, n: count(), at: max(catalogItems.updatedAt) })
      .from(catalogItems)
      .where(eq(catalogItems.deleted, false))
      .groupBy(catalogItems.section);
    return rows.map((r) => ({ section: r.section as CatalogSection, items: Number(r.n), updatedAt: r.at ? new Date(r.at).toISOString() : null }));
  }

  /** Admin view: search a section (or the whole section for the Excel download). */
  async list(section: CatalogSection, q?: string, limit = 200): Promise<(CatalogItemDto & { notes: string | null })[]> {
    const like = q?.trim() ? `%${q.trim()}%` : null;
    const rows = await this.db
      .select()
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.section, section),
          eq(catalogItems.deleted, false),
          like ? or(ilike(catalogItems.item, like), ilike(catalogItems.brand, like), ilike(catalogItems.category, like)) : undefined,
        ),
      )
      .orderBy(asc(catalogItems.category), asc(catalogItems.item), asc(catalogItems.brand), asc(catalogItems.size))
      .limit(limit);
    return rows.map((r) => ({ ...toDto(r), notes: r.notes }));
  }

  /** Adds and updates rows by product (section + item + brand + pack); `replace` removes the rest. */
  async import(input: z.output<typeof catalogImportBody>): Promise<CatalogImportResult> {
    return this.db.transaction(async (tx) => {
      const existing = new Map((await tx.select().from(catalogItems).where(eq(catalogItems.section, input.section))).map((r) => [r.id, r]));
      const seen = new Set<string>();
      const res: CatalogImportResult = { added: 0, updated: 0, unchanged: 0, removed: 0 };
      for (const r of input.rows) {
        const next: Content = {
          category: r.category,
          item: r.item,
          brand: r.brand?.trim() || null,
          size: r.size ?? null,
          sizeUnit: r.size ? r.sizeUnit?.trim() || null : null,
          sellUnit: r.sellUnit,
          hsn: r.hsn ?? null,
          gstPct: r.gstPct ?? null,
          otherNames: [...new Set(r.otherNames.map((n) => n.trim()).filter(Boolean))],
          notes: r.notes?.trim() || null,
          deleted: false,
        };
        const id = catalogId(input.section, next);
        if (seen.has(id)) continue;
        seen.add(id);
        const old = existing.get(id);
        if (old && content(old) === content(next)) {
          res.unchanged++;
          continue;
        }
        await tx
          .insert(catalogItems)
          .values({ id, section: input.section, ...next, seq: nextSeq() })
          .onConflictDoUpdate({ target: catalogItems.id, set: { ...next, seq: nextSeq(), updatedAt: new Date() } });
        if (old && !old.deleted) res.updated++;
        else res.added++;
      }
      if (input.replace) {
        for (const old of existing.values()) {
          if (seen.has(old.id) || old.deleted) continue;
          await tx.update(catalogItems).set({ deleted: true, seq: nextSeq(), updatedAt: new Date() }).where(eq(catalogItems.id, old.id));
          res.removed++;
        }
      }
      return res;
    });
  }

  async importAliases(input: z.output<typeof catalogAliasImportBody>): Promise<CatalogImportResult> {
    return this.db.transaction(async (tx) => {
      const existing = new Map((await tx.select().from(catalogAliases)).map((r) => [r.word, r]));
      const seen = new Set<string>();
      const res: CatalogImportResult = { added: 0, updated: 0, unchanged: 0, removed: 0 };
      for (const r of input.rows) {
        const word = r.word.trim().toLowerCase();
        if (seen.has(word)) continue;
        seen.add(word);
        const old = existing.get(word);
        if (old && !old.deleted && old.means === r.means) {
          res.unchanged++;
          continue;
        }
        await tx
          .insert(catalogAliases)
          .values({ word, means: r.means, seq: nextSeq() })
          .onConflictDoUpdate({ target: catalogAliases.word, set: { means: r.means, deleted: false, seq: nextSeq() } });
        if (old && !old.deleted) res.updated++;
        else res.added++;
      }
      if (input.replace) {
        for (const old of existing.values()) {
          if (seen.has(old.word) || old.deleted) continue;
          await tx.update(catalogAliases).set({ deleted: true, seq: nextSeq() }).where(eq(catalogAliases.word, old.word));
          res.removed++;
        }
      }
      return res;
    });
  }

  async allAliases(): Promise<{ word: string; means: string }[]> {
    return this.db.select({ word: catalogAliases.word, means: catalogAliases.means }).from(catalogAliases).where(eq(catalogAliases.deleted, false)).orderBy(asc(catalogAliases.word));
  }
}
