import { and, eq, gt, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokens } from '@invoice/shared';
import type { DB } from '../db/client';
import { sessions } from '../db/schema';
import { unauthorized } from '../errors';
import { generateRefreshToken, hashToken } from './crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;

export interface AccessClaims {
  userId: string;
  sessionId: string;
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

  /** Creates a new device session (after OTP login). */
  async createSession(userId: string, deviceName?: string): Promise<AuthTokens> {
    const refreshToken = generateRefreshToken();
    const [row] = await this.db
      .insert(sessions)
      .values({
        userId,
        deviceName: deviceName ?? null,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      })
      .returning({ id: sessions.id });
    return {
      accessToken: await this.signAccess(userId, row!.id),
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Rotates the refresh token: the old one stops working immediately. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const now = new Date();
    const next = generateRefreshToken();
    const [row] = await this.db
      .update(sessions)
      .set({
        refreshTokenHash: hashToken(next),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      })
      .where(and(eq(sessions.refreshTokenHash, hashToken(refreshToken)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .returning({ id: sessions.id, userId: sessions.userId });
    if (!row) throw unauthorized();
    return { accessToken: await this.signAccess(row.userId, row.id), refreshToken: next, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  async isSessionActive(sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .limit(1);
    return !!row;
  }
}
