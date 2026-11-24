import { and, count, eq, gte } from 'drizzle-orm';
import { checkGstin, type GstinInfo } from '@invoice/shared';
import type { DB } from '../db/client';
import { gstinCache, gstinLookups } from '../db/schema';
import type { Env } from '../env';
import { HttpError, badRequest, tooMany } from '../errors';
import { gstzenProvider } from './gstzen';

/**
 * A GST data provider. The client's API plugs in here (see createGstProvider); tests use a fake.
 * Returns null when the GSTIN is not found.
 */
export interface GstProvider {
  name: string;
  lookup(gstin: string): Promise<Omit<GstinInfo, 'checkedAt'> | null>;
}

/** The configured provider, or null when GST_API_PROVIDER is not set. */
export function createGstProvider(env: Env, warn?: (msg: string) => void): GstProvider | null {
  if (!env.GST_API_PROVIDER) return null;
  if (env.GST_API_PROVIDER === 'gstzen') {
    if (!env.GST_API_KEY) throw new Error('GST_API_PROVIDER=gstzen needs GST_API_KEY');
    return gstzenProvider({
      url: env.GST_API_URL ?? 'https://my.gstzen.in/api/gstin-validator/',
      key: env.GST_API_KEY,
      apiVersion: env.GST_API_VERSION,
      timeoutMs: env.GST_API_TIMEOUT_MS,
      warn,
    });
  }
  throw new Error(`GST_API_PROVIDER "${env.GST_API_PROVIDER}" is not supported (use gstzen)`);
}

const CACHE_DAYS = 30;

export class GstLookupService {
  constructor(
    private readonly db: DB,
    private readonly provider: GstProvider | null,
    private readonly perDay: number,
  ) {}

  get configured(): boolean {
    return !!this.provider;
  }

  /** Checks the GSTIN offline, then the 30-day cache, then the provider (counted against the store's daily limit). */
  async lookup(businessId: string, raw: string): Promise<GstinInfo | null> {
    const check = checkGstin(raw);
    if (!check.ok) throw badRequest('invalid_gstin', check.message);
    const gstin = check.gstin;

    const [cached] = await this.db.select().from(gstinCache).where(eq(gstinCache.gstin, gstin)).limit(1);
    if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_DAYS * 86_400_000) return cached.data as unknown as GstinInfo;

    if (!this.provider) throw new HttpError(503, 'gst_lookup_not_setup', 'GST lookup is not set up yet. The GSTIN format was checked.');
    const since = new Date(Date.now() - 86_400_000);
    const [{ n }] = (await this.db
      .select({ n: count() })
      .from(gstinLookups)
      .where(and(eq(gstinLookups.businessId, businessId), gte(gstinLookups.at, since)))) as [{ n: number }];
    if (n >= this.perDay) throw tooMany(`Daily limit of ${this.perDay} GSTIN checks reached. Try again tomorrow.`, 3600);

    await this.db.insert(gstinLookups).values({ businessId, gstin });
    const found = await this.provider.lookup(gstin);
    if (!found) return null;
    const info: GstinInfo = { ...found, gstin, checkedAt: new Date().toISOString() };
    await this.db
      .insert(gstinCache)
      .values({ gstin, data: info as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: gstinCache.gstin, set: { data: info as unknown as Record<string, unknown>, fetchedAt: new Date() } });
    return info;
  }
}
