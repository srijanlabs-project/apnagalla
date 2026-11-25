import { createHash } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import {
  createBusinessBody,
  createInviteBody,
  otpRequestBody,
  otpVerifyBody,
  refreshBody,
  reserveNumbersBody,
  returnNumbersBody,
  setSeriesCodeBody,
  couponBody,
  payPlanBody,
  planBody,
  staffPermissionsBody,
  syncPushBody,
  updateMeBody,
  type ReserveNumbersResponse,
  type SyncPushResponse,
  type VerifyOtpResponse,
  type GstinInfo,
  adminCreateStoreBody,
  suspendStoreBody,
  normalizeIndianMobile,
} from '@invoice/shared';
import { OtpService } from './auth/otp';
import { AdminService } from './services/admin';
import { audit } from './services/audit';
import { GstLookupService, createGstProvider, type GstProvider } from './gst/lookup';
import { TokenService, type AuthContext } from './auth/tokens';
import type { Database } from './db/client';
import type { Env } from './env';
import { HttpError, badRequest, forbidden, tooMany, unauthorized } from './errors';
import { ExportService } from './exports/exportService';
import { BillingService } from './billing/billing';
import { CLOUD_PROVIDERS, type CloudProvider } from './exports/delivery';
import { ScanError, billScannerFromEnv, type BillScanner, type ScannedBill } from './scan/billScanner';
import { AccountService } from './services/accounts';
import { SyncService } from './services/sync';
import { createOtpSender, type OtpSender } from './sms';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Origins that can always call the API: Capacitor Android WebView and the Vite dev server. */
/** The Android app's own origins (Capacitor WebView). */
const APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];
/** Local development only. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];


declare module 'fastify' {
  interface FastifyInstance {
    /** Registered routes (method + URL pattern). */
    routeList: { method: string; url: string }[];
  }
}

export interface BuildAppOptions {
  env: Env;
  database: Database;
  /** Tests inject a fake sender to capture codes. */
  otpSender?: OtpSender;
  /** Tests inject a fake GST data provider. */
  gstProvider?: GstProvider | null;
  /** Tests inject a fake bill scanner. */
  billScanner?: BillScanner | null;
  logger?: boolean;
}

export async function buildApp({ env, database, otpSender, gstProvider, billScanner, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { redact: ['req.headers.authorization'] } : false,
    trustProxy: true, // Railway sits behind a proxy; needed for the real client IP
    bodyLimit: 1_000_000,
  });

  // Every route, so tests can check that none of them leaks another store's data.
  const routes: { method: string; url: string }[] = [];
  app.decorate('routeList', routes);
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') routes.push({ method: m, url: r.url });
  });

  const db = database.db;
  const tokens = new TokenService(db, env.JWT_SECRET);
  const otp = new OtpService(db, otpSender ?? createOtpSender(env, app.log), env.JWT_SECRET, env.OTP_PROVIDER === 'console' ? env.OTP_FIXED_CODE : undefined);
  const adminPhones = new Set(
    env.ADMIN_PHONES.split(',')
      .map((p) => normalizeIndianMobile(p.trim()))
      .filter((p): p is string => !!p),
  );
  const accounts = new AccountService(db, adminPhones);
  const admin = new AdminService(db);
  const syncService = new SyncService(db);

  const allowedOrigins = new Set([
    ...APP_ORIGINS,
    ...(env.NODE_ENV === 'production' ? [] : DEV_ORIGINS),
    ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  ]);
  // Standard protective headers (no-sniff, HSTS, frame denial…); the API serves JSON only.
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(rateLimit, {
    // Signed-in requests count per login (many phones share one mobile-network IP); others per IP.
    // OTP has its own stricter limits.
    max: env.RATE_LIMIT_PER_MINUTE,
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth?.startsWith('Bearer ') ? `t:${createHash('sha256').update(auth).digest('base64url').slice(0, 22)}` : `ip:${req.ip}`;
    },
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/health',
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: 'rate_limited', message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.` }),
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', message: err.issues[0]?.message ?? 'Invalid input' });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).headers(err.headers).send({ error: err.code, message: err.message });
    }
    // Postgres unique violation that slipped past a pre-check (race between two requests).
    if ((err as { code?: string }).code === '23505') {
      return reply.status(409).send({ error: 'conflict', message: 'This was already done. Refresh and try again.' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited', message: (err as Error).message });
    if (status && status < 500) {
      return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Something went wrong. Please try again.' });
  });

  const parse = <T extends ZodType>(schema: T, data: unknown) => schema.parse(data ?? {}) as ReturnType<T['parse']>;

  async function requireAuth(req: FastifyRequest) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const claims = await tokens.verifyAccess(header.slice(7));
    // Logout / sign-out elsewhere must take effect immediately, not when the 15-min JWT expires.
    req.auth = await tokens.requireActiveSession(claims);
  }
  const authed = { preHandler: requireAuth };
  const uid = (req: FastifyRequest) => req.auth!.userId;
  type BizParams = { businessId: string };

  /* ---------- health ---------- */
  app.get('/health', async () => {
    await db.execute(sql`select 1`);
    return { ok: true, db: database.kind };
  });

  /* ---------- auth ---------- */
  app.post('/v1/auth/otp/request', async (req) => {
    const { phone } = parse(otpRequestBody, req.body);
    try {
      return await otp.request(phone, req.ip ?? null);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      req.log.error(e, 'OTP send failed');
      throw new HttpError(502, 'sms_failed', 'Could not send the code right now. Please try again.');
    }
  });

  app.post('/v1/auth/otp/verify', async (req): Promise<VerifyOtpResponse> => {
    const { phone, code, deviceName, client } = parse(otpVerifyBody, req.body);
    await otp.verify(phone, code);
    const userId = await accounts.upsertUserByPhone(phone);
    const t = await tokens.createSession(userId, deviceName, client);
    return { ...t, me: await accounts.getMe(userId) };
  });

  app.post('/v1/auth/refresh', async (req) => {
    const { refreshToken } = parse(refreshBody, req.body);
    return tokens.refresh(refreshToken);
  });

  app.post('/v1/auth/logout', authed, async (req, reply) => {
    await tokens.revokeSession(req.auth!.sessionId);
    return reply.status(204).send();
  });

  /* ---------- me ---------- */
  app.get('/v1/me', authed, async (req) => accounts.getMe(uid(req)));

  app.patch('/v1/me', authed, async (req) => {
    const { name } = parse(updateMeBody, req.body);
    await accounts.updateName(uid(req), name);
    return accounts.getMe(uid(req));
  });

  /* ---------- my devices ---------- */
  app.get('/v1/me/sessions', authed, async (req) => tokens.listSessions(uid(req), req.auth!.sessionId));

  app.delete<{ Params: { sessionId: string } }>('/v1/me/sessions/:sessionId', authed, async (req, reply) => {
    await tokens.revokeOwnSession(uid(req), req.params.sessionId, req.auth!.sessionId);
    return reply.status(204).send();
  });

  /* ---------- businesses ---------- */
  app.post('/v1/businesses', authed, async (req, reply) => {
    const body = parse(createBusinessBody, req.body);
    const business = await accounts.createBusiness(uid(req), body);
    return reply.status(201).send(business);
  });

  app.get<{ Params: BizParams }>('/v1/businesses/:businessId', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId);
    return accounts.getBusiness(req.params.businessId);
  });

  app.get<{ Params: BizParams }>('/v1/businesses/:businessId/team', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    return accounts.getTeam(req.params.businessId);
  });

  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/invites', authed, async (req, reply) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    await billing.checkStaff(req.params.businessId);
    const { phone, role } = parse(createInviteBody, req.body);
    const invite = await accounts.createInvite(req.params.businessId, uid(req), phone, role);
    await audit(db, { businessId: req.params.businessId, actorUserId: uid(req), action: 'team.invited', detail: { phone, role } });
    return reply.status(201).send(invite);
  });

  app.delete<{ Params: BizParams & { inviteId: string } }>('/v1/businesses/:businessId/invites/:inviteId', authed, async (req, reply) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    await accounts.revokeInvite(req.params.businessId, req.params.inviteId);
    return reply.status(204).send();
  });

  app.delete<{ Params: BizParams & { userId: string } }>('/v1/businesses/:businessId/members/:userId', authed, async (req, reply) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    await accounts.removeMember(req.params.businessId, uid(req), req.params.userId);
    await audit(db, { businessId: req.params.businessId, actorUserId: uid(req), action: 'team.removed', detail: { userId: req.params.userId } });
    return reply.status(204).send();
  });

  app.post<{ Params: BizParams & { userId: string } }>('/v1/businesses/:businessId/members/:userId/series-code', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    const { code } = parse(setSeriesCodeBody, req.body);
    await accounts.setSeriesCode(req.params.businessId, req.params.userId, code);
    await audit(db, { businessId: req.params.businessId, actorUserId: uid(req), action: 'team.series_code', detail: { userId: req.params.userId, code } });
    return accounts.getTeam(req.params.businessId);
  });

  app.post<{ Params: BizParams & { userId: string } }>('/v1/businesses/:businessId/members/:userId/permissions', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    const permissions = parse(staffPermissionsBody, req.body);
    await accounts.setPermissions(req.params.businessId, req.params.userId, permissions);
    await audit(db, { businessId: req.params.businessId, actorUserId: uid(req), action: 'team.permissions', detail: { userId: req.params.userId, ...permissions } });
    return accounts.getTeam(req.params.businessId);
  });

  for (const [action, active] of [['deactivate', false], ['activate', true]] as const) {
    app.post<{ Params: BizParams & { userId: string } }>(`/v1/businesses/:businessId/members/:userId/${action}`, authed, async (req) => {
      await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
      await accounts.setMemberActive(req.params.businessId, uid(req), req.params.userId, active);
      await audit(db, { businessId: req.params.businessId, actorUserId: uid(req), action: active ? 'team.reactivated' : 'team.paused', detail: { userId: req.params.userId } });
      return accounts.getTeam(req.params.businessId);
    });
  }

  /* ---------- admin panel (ApnaGalla staff; web only) ---------- */
  async function requireAdmin(req: FastifyRequest) {
    await requireAuth(req);
    if (req.auth!.client !== 'web') throw forbidden('The admin panel works on the web only', 'admin_web_only');
    if (!(await accounts.isAdmin(uid(req)))) throw forbidden('Admins only', 'not_admin');
  }
  const adminOnly = { preHandler: requireAdmin };

  app.get<{ Querystring: { q?: string } }>('/v1/admin/stores', adminOnly, async (req) => ({ stores: await admin.listStores(req.query.q), activeDevices: await admin.activeSessions() }));
  app.post('/v1/admin/stores', adminOnly, async (req, reply) => reply.status(201).send(await admin.createStore(uid(req), parse(adminCreateStoreBody, req.body))));
  app.post<{ Params: BizParams }>('/v1/admin/stores/:businessId/suspend', adminOnly, async (req, reply) => {
    await admin.setSuspended(uid(req), req.params.businessId, true, parse(suspendStoreBody, req.body).reason);
    return reply.status(204).send();
  });
  app.post<{ Params: BizParams }>('/v1/admin/stores/:businessId/reactivate', adminOnly, async (req, reply) => {
    await admin.setSuspended(uid(req), req.params.businessId, false);
    return reply.status(204).send();
  });
  app.get<{ Params: BizParams }>('/v1/admin/stores/:businessId/audit', adminOnly, async (req) => ({ entries: await admin.auditTrail(req.params.businessId) }));

  /** May this staff member see costs and purchases? Their own setting, else the store's. */
  const seesCost = async (businessId: string, userId: string) => {
    const p = await accounts.permissionsOf(businessId, userId);
    // The warehouse never sees cost prices or purchases.
    if (p?.access === 'warehouse') return false;
    return p?.seeCost ?? (await syncService.staffSeeCost(businessId));
  };

  /* ---------- sync ---------- */
  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/sync/push', { ...authed, bodyLimit: 8_000_000 }, async (req): Promise<SyncPushResponse> => {
    const role = await accounts.requireRole(uid(req), req.params.businessId);
    const { changes } = parse(syncPushBody, req.body);
    if (!(await billing.writable(req.params.businessId))) throw new HttpError(402, 'plan_expired', 'Your ApnaGalla plan has ended. The owner can renew it in More → Plan.');
    const seriesCode = await accounts.seriesCodeOf(req.params.businessId, uid(req));
    const hideCost = role === 'staff' && !(await seesCost(req.params.businessId, uid(req)));
    const billsLeft = changes.some((c) => c.table === 'invoices') ? await billing.billsLeft(req.params.businessId) : undefined;
    const perms = role === 'staff' ? await accounts.permissionsOf(req.params.businessId, uid(req)) : null;
    const settings = await syncService.settingsData(req.params.businessId);
    const lock = { afterDays: typeof settings?.lockBillsAfterDays === 'number' ? settings.lockBillsAfterDays : null, until: typeof settings?.booksClosedUntil === 'string' ? settings.booksClosedUntil : null };
    const results = await syncService.push(
      { businessId: req.params.businessId, userId: uid(req), role, client: req.auth!.client, seriesCode, hideCost, billsLeft, access: perms?.access ?? 'full', cancelBills: perms?.cancelBills === true, lock },
      changes,
    );
    return { results };
  });

  app.get<{ Params: BizParams; Querystring: { since?: string; schema?: string } }>('/v1/businesses/:businessId/sync/pull', authed, async (req) => {
    const role = await accounts.requireRole(uid(req), req.params.businessId);
    const since = Math.max(0, Number.parseInt(req.query.since ?? '0', 10) || 0);
    const schema = Number.parseInt(req.query.schema ?? '1', 10) || 1;
    const hideCost = role === 'staff' && !(await seesCost(req.params.businessId, uid(req)));
    return syncService.pull(req.params.businessId, since, undefined, { hideCost, schema });
  });

  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/numbers/reserve', authed, async (req): Promise<ReserveNumbersResponse> => {
    await accounts.requireRole(uid(req), req.params.businessId);
    const body = parse(reserveNumbersBody, req.body);
    if (body.kind !== 'estimate' && req.auth!.client === 'web') throw forbidden('Invoices, bills and credit notes are made in the phone app');
    return { numbers: await syncService.reserveNumbers(req.params.businessId, body) };
  });

  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/numbers/return', authed, async (req, reply) => {
    await accounts.requireRole(uid(req), req.params.businessId);
    await syncService.returnNumbers(req.params.businessId, parse(returnNumbersBody, req.body));
    return reply.status(204).send();
  });

  /* ---------- GSTIN lookup ---------- */
  const gst = new GstLookupService(db, gstProvider === undefined ? createGstProvider(env, (m) => app.log.warn(m)) : gstProvider, env.GST_LOOKUPS_PER_DAY);
  app.get<{ Params: BizParams & { gstin: string } }>('/v1/businesses/:businessId/gstin/:gstin', authed, async (req): Promise<{ found: boolean; info: GstinInfo | null }> => {
    await accounts.requireRole(uid(req), req.params.businessId);
    const info = await gst.lookup(req.params.businessId, req.params.gstin);
    return { found: !!info, info };
  });

  /* ---------- bill scanning ---------- */
  const scanner = billScanner === undefined ? billScannerFromEnv(env) : billScanner;
  app.get('/v1/features', authed, async () => ({ scanBill: !!scanner }));

  app.post<{ Params: BizParams; Body: { image?: string; mediaType?: string; kind?: string } }>(
    '/v1/businesses/:businessId/scan-bill',
    { ...authed, bodyLimit: 12_000_000 },
    async (req): Promise<{ bill: ScannedBill }> => {
      const role = await accounts.requireRole(uid(req), req.params.businessId);
      const scanKind = req.body?.kind === 'sale' ? 'sale' : 'purchase';
      if (scanKind === 'purchase' && role === 'staff' && !(await seesCost(req.params.businessId, uid(req)))) throw forbidden('Only the owner handles purchases in this store');
      if (!scanner) throw badRequest('scan_off', 'Bill scanning is not set up yet');
      const mediaType = req.body?.mediaType;
      if (!req.body?.image || (mediaType !== 'image/jpeg' && mediaType !== 'image/png' && mediaType !== 'image/webp')) throw badRequest('bad_image', 'Send a JPEG, PNG or WebP photo');
      // Each scan costs money: a daily cap per store.
      const counted = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from audit_log where business_id = ${req.params.businessId} and action = 'bill.scanned' and at > now() - interval '1 day'`,
      );
      if (Number(counted.rows[0]?.n ?? 0) >= (await billing.scansPerDay(req.params.businessId, env.SCAN_PER_DAY))) throw tooMany('Today’s bill scans are used up. Enter the bill by hand or try tomorrow.', 3600);
      try {
        const bill = await scanner.scan({ mediaType, base64: req.body.image }, scanKind);
        await audit(db, { businessId: req.params.businessId, actorUserId: uid(req), action: 'bill.scanned', detail: { lines: bill.lines.length, provider: scanner.name, kind: scanKind } });
        return { bill };
      } catch (e) {
        if (e instanceof ScanError) throw badRequest('scan_failed', e.message);
        app.log.error(e, 'bill scan failed');
        throw new HttpError(502, 'scan_failed', 'The bill could not be read right now. Try again, or enter it by hand.');
      }
    },
  );

  /* ---------- nightly Excel ---------- */
  const exportsService = new ExportService(db, env, env.JWT_SECRET, (m) => app.log.warn(m));
  const ownerOnly = async (req: FastifyRequest<{ Params: BizParams }>) => {
    if ((await accounts.requireRole(uid(req), req.params.businessId)) !== 'owner') throw forbidden('Only the owner can change this');
  };
  app.get<{ Params: BizParams }>('/v1/businesses/:businessId/exports', authed, async (req) => {
    await ownerOnly(req);
    return exportsService.get(req.params.businessId);
  });
  app.put<{ Params: BizParams; Body: { enabled?: boolean; email?: string | null; hour?: number } }>('/v1/businesses/:businessId/exports', authed, async (req) => {
    await ownerOnly(req);
    return exportsService.update(req.params.businessId, { enabled: req.body?.enabled !== false, email: req.body?.email?.trim() || null, hour: Number(req.body?.hour ?? 21) });
  });
  app.post<{ Params: BizParams & { provider: string } }>('/v1/businesses/:businessId/exports/connect/:provider', authed, async (req) => {
    await ownerOnly(req);
    if (!CLOUD_PROVIDERS.includes(req.params.provider as CloudProvider)) throw badRequest('export', 'Unknown storage');
    return { url: await exportsService.connectUrl(req.params.businessId, uid(req), req.params.provider as CloudProvider) };
  });
  app.delete<{ Params: BizParams }>('/v1/businesses/:businessId/exports/connect', authed, async (req) => {
    await ownerOnly(req);
    return exportsService.disconnect(req.params.businessId);
  });
  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/exports/send-now', authed, async (req) => {
    await ownerOnly(req);
    await exportsService.sendNow(req.params.businessId);
    return exportsService.get(req.params.businessId);
  });
  // The cloud provider sends the owner's browser back here after they allow access.
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>('/v1/exports/callback/:provider', async (req, reply) => {
    const page = (title: string, text: string) =>
      reply
        .type('text/html; charset=utf-8')
        .send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:sans-serif;padding:24px;max-width:480px;margin:auto"><h2>${title}</h2><p>${text}</p></body>`);
    const provider = req.params.provider as CloudProvider;
    if (!CLOUD_PROVIDERS.includes(provider) || !req.query.code || !req.query.state) return page('Not connected', 'The sign-in was cancelled. You can close this page and try again in ApnaGalla.');
    try {
      await exportsService.finishConnect(provider, req.query.code, req.query.state);
      return page('Connected', 'ApnaGalla will save the daily Excel in an “ApnaGalla” folder. You can close this page.');
    } catch (e) {
      app.log.warn(`export connect failed: ${(e as Error).message}`);
      return page('Not connected', 'Something went wrong. Please close this page and try again in ApnaGalla.');
    }
  });
  if (env.EXPORT_SCHEDULER && env.NODE_ENV !== 'test') {
    const timer = setInterval(() => void exportsService.runDue().catch((e) => app.log.error(e, 'nightly export run failed')), 5 * 60_000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  /* ---------- plans and billing ---------- */
  const billing = new BillingService(db, env);
  await billing.seedPlans();
  app.get<{ Params: BizParams }>('/v1/businesses/:businessId/billing', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId);
    return { status: await billing.status(req.params.businessId), plans: await billing.listPlans() };
  });
  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/billing/quote', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    const b = parse(payPlanBody, req.body);
    return billing.quote(req.params.businessId, b.planId, b.period, b.code);
  });
  app.post<{ Params: BizParams }>('/v1/businesses/:businessId/billing/pay', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    const b = parse(payPlanBody, req.body);
    return billing.createPaymentLink(req.params.businessId, uid(req), b.planId, b.period, b.code);
  });
  app.get<{ Params: BizParams }>('/v1/businesses/:businessId/billing/invoices', authed, async (req) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    return { invoices: await billing.invoices(req.params.businessId) };
  });
  // Razorpay's webhook: the signature is over the raw body, so this route reads it as text.
  await app.register(async (raw) => {
    raw.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    raw.post('/v1/billing/razorpay-webhook', async (req) => ({ result: await billing.webhook(String(req.body ?? ''), req.headers['x-razorpay-signature'] as string | undefined) }));
  });
  app.get('/v1/admin/plans', adminOnly, async () => ({ plans: await billing.listPlans(true) }));
  app.put('/v1/admin/plans', adminOnly, async (req) => {
    await billing.upsertPlan(parse(planBody, req.body));
    return { plans: await billing.listPlans(true) };
  });
  app.get('/v1/admin/coupons', adminOnly, async () => ({ coupons: await billing.listCoupons() }));
  app.post('/v1/admin/coupons', adminOnly, async (req) => {
    await billing.createCoupon(parse(couponBody, req.body));
    return { coupons: await billing.listCoupons() };
  });
  app.get<{ Params: BizParams }>('/v1/admin/stores/:businessId/billing', adminOnly, async (req) => ({ status: await billing.status(req.params.businessId) }));
  app.post<{ Params: BizParams; Body: { planId?: string; days?: number } }>('/v1/admin/stores/:businessId/plan', adminOnly, async (req) => {
    await billing.setPlan(uid(req), req.params.businessId, String(req.body?.planId ?? ''), Number(req.body?.days ?? 0));
    return { status: await billing.status(req.params.businessId) };
  });

  /* ---------- invites (as the invited user) ---------- */
  app.post<{ Params: { inviteId: string } }>('/v1/invites/:inviteId/accept', authed, async (req) => {
    await accounts.acceptInvite(uid(req), req.params.inviteId);
    return accounts.getMe(uid(req));
  });

  app.post<{ Params: { inviteId: string } }>('/v1/invites/:inviteId/decline', authed, async (req) => {
    await accounts.declineInvite(uid(req), req.params.inviteId);
    return accounts.getMe(uid(req));
  });

  return app;
}
