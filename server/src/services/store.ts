import { calculateInvoice } from '@invoice/shared';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client';
import { syncRecords } from '../db/schema';
import { HttpError } from '../errors';

/**
 * R9 online store. A store that switches it on gets a public page at /s/<slug> with the items it
 * marked "show online" and their prices. A customer picks items and sends an order with name,
 * phone and address; the order is written into the store's data as a draft sales order (marked
 * online), so it reaches the store's phones with the next sync. No payment is taken online.
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const onlineOrderBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^(\+91)?[6-9]\d{9}$/),
  address: z.string().trim().max(300).optional().default(''),
  note: z.string().trim().max(300).optional().default(''),
  lines: z
    .array(z.object({ itemId: z.string().min(1).max(64), qty: z.number().positive().max(10_000) }))
    .min(1)
    .max(60),
});

type Data = Record<string, unknown>;

export interface StoreItem {
  id: string;
  name: string;
  unit: string;
  rate: number;
  mrp?: number;
  photo?: string | null;
  category?: string;
  description?: string;
}

export interface StorePage {
  businessId: string;
  name: string;
  phone?: string;
  address?: string;
  note?: string;
  minOrder?: number;
  items: StoreItem[];
}

const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export class OnlineStoreService {
  constructor(private readonly db: DB) {}

  private async storeOf(slug: string): Promise<{ businessId: string; settings: Data } | null> {
    if (!SLUG_RE.test(slug)) return null;
    const rows = await this.db
      .select({ businessId: syncRecords.businessId, data: syncRecords.data })
      .from(syncRecords)
      .where(and(eq(syncRecords.tableName, 'settings'), eq(syncRecords.deleted, false), sql`${syncRecords.data}->'onlineStore'->>'slug' = ${slug}`, sql`${syncRecords.data}->'onlineStore'->>'enabled' = 'true'`))
      .limit(1);
    return rows[0] ? { businessId: rows[0].businessId, settings: rows[0].data } : null;
  }

  private async records(businessId: string, table: string): Promise<Data[]> {
    const rows = await this.db
      .select({ data: syncRecords.data })
      .from(syncRecords)
      .where(and(eq(syncRecords.businessId, businessId), eq(syncRecords.tableName, table), eq(syncRecords.deleted, false)));
    return rows.map((r) => r.data);
  }

  /** Is this name free for the store (or already its own)? */
  async slugFree(slug: string, businessId: string): Promise<boolean> {
    if (!SLUG_RE.test(slug)) return false;
    const rows = await this.db
      .select({ businessId: syncRecords.businessId })
      .from(syncRecords)
      .where(and(eq(syncRecords.tableName, 'settings'), eq(syncRecords.deleted, false), sql`${syncRecords.data}->'onlineStore'->>'slug' = ${slug}`));
    return rows.every((r) => r.businessId === businessId);
  }

  async page(slug: string): Promise<StorePage | null> {
    const store = await this.storeOf(slug);
    if (!store) return null;
    const [profiles, items, cats] = await Promise.all([this.records(store.businessId, 'profiles'), this.records(store.businessId, 'items'), this.records(store.businessId, 'categories')]);
    const p = profiles[0] ?? {};
    const catName = new Map(cats.map((c) => [String(c.id), String(c.name ?? '')]));
    const os = (store.settings.onlineStore ?? {}) as Data;
    const addr = (p.address ?? {}) as Data;
    return {
      businessId: store.businessId,
      name: String(p.name ?? ''),
      phone: typeof p.phone === 'string' ? p.phone : undefined,
      address: [addr.line1, addr.line2, addr.city].filter((x) => typeof x === 'string' && x).join(', ') || undefined,
      note: typeof os.note === 'string' ? os.note : undefined,
      minOrder: typeof os.minOrder === 'number' ? os.minOrder : undefined,
      items: items
        .filter((i) => i.online === true && !i.hasVariants && (i.pricing ?? 'unit') === 'unit' && Number(i.rate) > 0)
        .map((i) => ({
          id: String(i.id),
          name: String(i.name),
          unit: String(i.unit ?? ''),
          rate: Number(i.rate),
          mrp: typeof i.mrp === 'number' ? i.mrp : undefined,
          photo: typeof i.photo === 'string' ? i.photo : null,
          category: i.categoryId ? catName.get(String(i.categoryId)) : undefined,
          description: typeof i.description === 'string' ? i.description : undefined,
        }))
        .sort((a, b) => (a.category ?? '~').localeCompare(b.category ?? '~') || a.name.localeCompare(b.name)),
    };
  }

  /** A customer's order becomes a draft sales order in the store's data. */
  async placeOrder(slug: string, body: z.infer<typeof onlineOrderBody>): Promise<{ orderId: string; total: number }> {
    const store = await this.storeOf(slug);
    if (!store) throw new HttpError(404, 'not_found', 'This store is not taking orders online');
    const items = new Map((await this.records(store.businessId, 'items')).filter((i) => i.online === true).map((i) => [String(i.id), i]));
    const lines = body.lines
      .map((l) => ({ l, it: items.get(l.itemId) }))
      .filter((x): x is { l: (typeof body.lines)[number]; it: Data } => !!x.it)
      .map(({ l, it }) => ({
        id: randomUUID(),
        itemId: String(it.id),
        name: String(it.name),
        qty: Math.round(l.qty * 1000) / 1000,
        unit: String(it.unit ?? ''),
        rate: Number(it.rate),
        rateIncludesTax: it.rateIncludesTax === true,
        taxPct: Number(it.taxPct ?? 0),
        hsn: typeof it.hsn === 'string' ? it.hsn : undefined,
        discount: null,
        mrp: typeof it.mrp === 'number' ? it.mrp : undefined,
      }));
    if (!lines.length) throw new HttpError(400, 'empty_order', 'None of these items can be ordered now');
    const settings = store.settings;
    const totals = calculateInvoice({ lines, charges: [], roundOff: settings.roundOff !== false });
    const os = (settings.onlineStore ?? {}) as Data;
    if (typeof os.minOrder === 'number' && totals.grandTotal < os.minOrder) throw new HttpError(400, 'min_order', 'The order is below the store’s minimum');
    const phone = body.phone.startsWith('+91') ? body.phone : `+91${body.phone}`;
    const now = new Date();
    const id = randomUUID();
    const data: Data = {
      id,
      businessId: store.businessId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      updatedBy: '',
      number: '',
      date: todayIST(),
      taxMode: settings.defaultTaxMode ?? undefined,
      placeOfSupply: null,
      billTo: { customerId: null, name: body.name, phone, address: { line1: body.address } },
      shipTo: null,
      lines,
      overallDiscount: null,
      targetTotal: null,
      charges: [],
      roundOff: settings.roundOff !== false,
      totals,
      notes: body.note,
      terms: '',
      customFields: [],
      status: 'draft',
      order: true,
      online: true,
      createdBy: '',
      history: [{ at: now.toISOString(), by: '', byName: body.name, action: 'created', detail: 'online order' }],
    };
    await this.db.insert(syncRecords).values({ businessId: store.businessId, tableName: 'estimates', id, data, updatedAt: now, updatedBy: null, deleted: false, seq: sql`nextval('sync_seq')` });
    return { orderId: id, total: totals.grandTotal };
  }
}
