import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokens, ClientKind, SessionDto } from '@invoice/shared';
import type { DB } from '../db/client';
import { sessions } from '../db/schema';
import { notFound, unauthorized } from '../errors';
import { generateRefreshToken, hashToken } from './crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;

export type RevokeReason = 'logout' | 'signed_in_elsewhere' | 'signed_out_remotely';

/** Messages the app shows when a session was ended somewhere else. */
const REVOKED_MESSAGES: Record<string, string> = {
  signed_in_elsewhere: 'You logged in on another phone, so this phone was signed out.',
  signed_out_remotely: 'This device was signed out from another device.',
};

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

export interface AuthContext extends AccessClaims {
  client: ClientKind;
}

export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly db: DB,
    secret: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  private async signAccess(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (!payload.sub || typeof payload.sid !== 'string') throw new Error('bad claims');
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw unauthorized('Session expired');
    }
  }

  /**
   * Creates a new device session (after OTP login). A phone login ends the user's other phone
   * sessions: one phone at a time per login. Web sessions are not limited.
   */
  async createSession(userId: string, deviceName: string | undefined, client: ClientKind): Promise<AuthTokens> {
    const refreshToken = generateRefreshToken();
    const row = await this.db.transaction(async (tx) => {
      if (client === 'mobile') {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), revokedReason: 'signed_in_elsewhere' })
          .where(and(eq(sessions.userId, userId), eq(sessions.client, 'mobile'), isNull(sessions.revokedAt)));
      }
      const [created] = await tx
        .insert(sessions)
        .values({
          userId,
          deviceName: deviceName ?? null,
          client,
          refreshTokenHash: hashToken(refreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        })
        .returning({ id: sessions.id });
      return created!;
    });
    return {
      accessToken: await this.signAccess(userId, row.id),
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Rotates the refresh token: the old one stops working immediately. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const now = new Date();
    const next = generateRefreshToken();
    const hash = hashToken(refreshToken);
    const [row] = await this.db
      .update(sessions)
      .set({
        refreshTokenHash: hashToken(next),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      })
      .where(and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .returning({ id: sessions.id, userId: sessions.userId });
    if (!row) {
      const [ended] = await this.db.select({ reason: sessions.revokedReason }).from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
      throw this.revokedError(ended?.reason);
    }
    return { accessToken: await this.signAccess(row.userId, row.id), refreshToken: next, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async revokeSession(sessionId: string, reason: RevokeReason = 'logout'): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Resolves the session behind an access token; throws 401 (with the reason) if it was ended. */
  async requireActiveSession(claims: AccessClaims): Promise<AuthContext> {
    const [row] = await this.db
      .select({ client: sessions.client, revokedAt: sessions.revokedAt, reason: sessions.revokedReason })
      .from(sessions)
      .where(eq(sessions.id, claims.sessionId))
      .limit(1);
    if (!row || row.revokedAt) throw this.revokedError(row?.reason);
    return { ...claims, client: row.client };
  }

  async listSessions(userId: string, currentSessionId: string): Promise<SessionDto[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      client: s.client,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  /** Signs out one of the user's other devices. */
  async revokeOwnSession(userId: string, sessionId: string, currentSessionId: string): Promise<void> {
    if (sessionId === currentSessionId) {
      await this.revokeSession(sessionId, 'logout');
      return;
    }
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'signed_out_remotely' })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, currentSessionId)))
      .returning({ id: sessions.id });
    if (res.length === 0) throw notFound('Device not found');
  }

  private revokedError(reason: string | null | undefined) {
    const message = reason ? REVOKED_MESSAGES[reason] : undefined;
    return message ? unauthorized(message, reason!) : unauthorized();
  }
}
