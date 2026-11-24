import cors from '@fastify/cors';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import {
  createBusinessBody,
  createInviteBody,
  otpRequestBody,
  otpVerifyBody,
  refreshBody,
  updateMeBody,
  type VerifyOtpResponse,
} from '@invoice/shared';
import { OtpService } from './auth/otp';
import { TokenService } from './auth/tokens';
import type { Database } from './db/client';
import type { Env } from './env';
import { HttpError, unauthorized } from './errors';
import { AccountService } from './services/accounts';
import { createOtpSender, type OtpSender } from './sms';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; sessionId: string };
  }
}

/** Origins that can always call the API: Capacitor Android WebView and the Vite dev server. */
const BUILTIN_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173'];

export interface BuildAppOptions {
  env: Env;
  database: Database;
  /** Tests inject a fake sender to capture codes. */
  otpSender?: OtpSender;
  logger?: boolean;
}

export async function buildApp({ env, database, otpSender, logger = true }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ? { redact: ['req.headers.authorization'] } : false,
    trustProxy: true, // Railway sits behind a proxy; needed for the real client IP
    bodyLimit: 1_000_000,
  });

  const db = database.db;
  const tokens = new TokenService(db, env.JWT_SECRET);
  const otp = new OtpService(db, otpSender ?? createOtpSender(env, app.log), env.JWT_SECRET, env.OTP_PROVIDER === 'console' ? env.OTP_FIXED_CODE : undefined);
  const accounts = new AccountService(db);

  const allowedOrigins = new Set([...BUILTIN_ORIGINS, ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)]);
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
    // Logout / account removal must take effect immediately, not when the 15-min JWT expires.
    if (!(await tokens.isSessionActive(claims.sessionId))) throw unauthorized();
    req.auth = claims;
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
    const { phone, code, deviceName } = parse(otpVerifyBody, req.body);
    await otp.verify(phone, code);
    const userId = await accounts.upsertUserByPhone(phone);
    const t = await tokens.createSession(userId, deviceName);
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
    const { phone, role } = parse(createInviteBody, req.body);
    return reply.status(201).send(await accounts.createInvite(req.params.businessId, uid(req), phone, role));
  });

  app.delete<{ Params: BizParams & { inviteId: string } }>('/v1/businesses/:businessId/invites/:inviteId', authed, async (req, reply) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    await accounts.revokeInvite(req.params.businessId, req.params.inviteId);
    return reply.status(204).send();
  });

  app.delete<{ Params: BizParams & { userId: string } }>('/v1/businesses/:businessId/members/:userId', authed, async (req, reply) => {
    await accounts.requireRole(uid(req), req.params.businessId, ['owner']);
    await accounts.removeMember(req.params.businessId, uid(req), req.params.userId);
    return reply.status(204).send();
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
