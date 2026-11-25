import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { DB } from '../db/client';
import { businesses, storeExports } from '../db/schema';
import { badRequest } from '../errors';
import { audit } from '../services/audit';
import { buildDailyExcel } from './dailyExcel';
import { CLOUD_PROVIDERS, authorizeUrl, cloudReady, emailReady, exchangeCode, seal, sendEmail, unseal, uploadToCloud, type CloudProvider, type DeliveryEnv } from './delivery';

export interface ExportSettingsDto {
  enabled: boolean;
  email: string | null;
  hour: number;
  provider: CloudProvider | null;
  accountLabel: string | null;
  lastSentDate: string | null;
  lastError: string | null;
  /** What the server can do (keys set). */
  available: { email: boolean; google: boolean; onedrive: boolean; dropbox: boolean };
}

/** India time: the date and hour now. */
export function indiaNow(now = new Date()): { date: string; hour: number } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

export class ExportService {
  constructor(
    private readonly db: DB,
    private readonly env: DeliveryEnv,
    private readonly secret: string,
    private readonly log: (m: string) => void = () => undefined,
  ) {}

  private available() {
    return { email: emailReady(this.env), google: cloudReady(this.env, 'google'), onedrive: cloudReady(this.env, 'onedrive'), dropbox: cloudReady(this.env, 'dropbox') };
  }

  async get(businessId: string): Promise<ExportSettingsDto> {
    const [row] = await this.db.select().from(storeExports).where(eq(storeExports.businessId, businessId)).limit(1);
    return {
      enabled: row?.enabled ?? false,
      email: row?.email ?? null,
      hour: row?.hour ?? 21,
      provider: (row?.tokenEnc ? row.provider : null) as CloudProvider | null,
      accountLabel: row?.accountLabel ?? null,
      lastSentDate: row?.lastSentDate ?? null,
      lastError: row?.lastError ?? null,
      available: this.available(),
    };
  }

  async update(businessId: string, input: { enabled: boolean; email: string | null; hour: number }): Promise<ExportSettingsDto> {
    if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) throw badRequest('export', 'Enter a valid email');
    if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw badRequest('export', 'Pick an hour from 0 to 23');
    await this.db
      .insert(storeExports)
      .values({ businessId, enabled: input.enabled, email: input.email || null, hour: input.hour })
      .onConflictDoUpdate({ target: storeExports.businessId, set: { enabled: input.enabled, email: input.email || null, hour: input.hour, updatedAt: new Date() } });
    return this.get(businessId);
  }

  /** Link to the provider's consent screen; `state` says which store and person asked. */
  async connectUrl(businessId: string, userId: string, provider: CloudProvider): Promise<string> {
    if (!CLOUD_PROVIDERS.includes(provider) || !cloudReady(this.env, provider)) throw badRequest('export', 'This storage is not set up on the server');
    const state = await new SignJWT({ b: businessId, u: userId, p: provider })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .setAudience('exports-connect')
      .sign(new TextEncoder().encode(this.secret));
    return authorizeUrl(this.env, provider, state);
  }

  /** The provider sends the person back here after they allow access. */
  async finishConnect(provider: CloudProvider, code: string, state: string): Promise<void> {
    const { payload } = await jwtVerify(state, new TextEncoder().encode(this.secret), { audience: 'exports-connect' });
    if (payload.p !== provider) throw badRequest('export', 'Wrong sign-in');
    const businessId = String(payload.b);
    const refresh = await exchangeCode(this.env, provider, code);
    const label = { google: 'Google Drive', onedrive: 'OneDrive', dropbox: 'Dropbox' }[provider];
    await this.db
      .insert(storeExports)
      .values({ businessId, provider, tokenEnc: seal(this.secret, refresh), accountLabel: label, folderId: null })
      .onConflictDoUpdate({ target: storeExports.businessId, set: { provider, tokenEnc: seal(this.secret, refresh), accountLabel: label, folderId: null, lastError: null, updatedAt: new Date() } });
    await audit(this.db, { businessId, actorUserId: String(payload.u), action: 'export.connected', detail: { provider } });
  }

  async disconnect(businessId: string): Promise<ExportSettingsDto> {
    await this.db.update(storeExports).set({ provider: null, tokenEnc: null, accountLabel: null, folderId: null, updatedAt: new Date() }).where(eq(storeExports.businessId, businessId));
    return this.get(businessId);
  }

  /** Builds the day's Excel and sends it everywhere set up. */
  async sendNow(businessId: string, date = indiaNow().date): Promise<void> {
    const [row] = await this.db.select().from(storeExports).where(eq(storeExports.businessId, businessId)).limit(1);
    const [store] = await this.db.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
    if (!row || !store) throw badRequest('export', 'Nothing to send to yet');
    const errors: string[] = [];
    const file = await buildDailyExcel(this.db, businessId, store.name, date);
    let sent = false;
    if (row.email && emailReady(this.env)) {
      try {
        await sendEmail(this.env, row.email, `ApnaGalla daily report — ${store.name} — ${date.split('-').reverse().join('/')}`, file.summary, file);
        sent = true;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (row.provider && row.tokenEnc && cloudReady(this.env, row.provider as CloudProvider)) {
      try {
        const r = await uploadToCloud(this.env, row.provider as CloudProvider, unseal(this.secret, row.tokenEnc), file, row.folderId);
        if (r.folderId && r.folderId !== row.folderId) await this.db.update(storeExports).set({ folderId: r.folderId }).where(eq(storeExports.businessId, businessId));
        sent = true;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    await this.db
      .update(storeExports)
      .set({ lastSentDate: sent ? date : row.lastSentDate, lastError: errors.join('; ') || (sent ? null : 'No email or storage set up'), updatedAt: new Date() })
      .where(eq(storeExports.businessId, businessId));
    if (!sent) throw badRequest('export', errors.join('; ') || 'Add an email or connect a storage first');
  }

  /** Called every few minutes: sends today's file for each store whose hour has come. */
  async runDue(now = new Date()): Promise<number> {
    const { date, hour } = indiaNow(now);
    const rows = await this.db.select().from(storeExports).where(eq(storeExports.enabled, true));
    let n = 0;
    for (const r of rows) {
      if (r.lastSentDate === date || hour < r.hour || (!r.email && !r.tokenEnc)) continue;
      try {
        await this.sendNow(r.businessId, date);
        n++;
      } catch (e) {
        this.log(`Nightly export for ${r.businessId} failed: ${(e as Error).message}`);
        // Mark the day tried, so a broken setting doesn't retry every few minutes all night.
        await this.db.update(storeExports).set({ lastSentDate: date }).where(eq(storeExports.businessId, r.businessId));
      }
    }
    return n;
  }
}
