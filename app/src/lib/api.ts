import type {
  ApiErrorBody,
  AuthTokens,
  BusinessDto,
  ClientKind,
  CreateBusinessBody,
  CreateInviteBody,
  InviteDto,
  MeResponse,
  ReserveNumbersBody,
  ReturnNumbersBody,
  AdminCreateStoreBody,
  AdminStoreDto,
  AuditEntryDto,
  GstinInfo,
  ReserveNumbersResponse,
  SessionDto,
  SyncPullResponse,
  SyncPushBody,
  SyncPushResponse,
  TeamResponse,
  VerifyOtpResponse,
} from '@invoice/shared';
import { API_URL } from '../config';
import { t } from './i18n';
import { secure } from './secureStore';
import { KEYS } from './storage';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The request never reached the server (offline, DNS, server down). */
export class NetworkError extends Error {
  constructor() {
    super(t("Can't reach the server. Check your internet connection."));
  }
}

/** Receives the server's reason (e.g. "You logged in on another phone…") when known. */
type Listener = (reason?: string) => void;
let tokens: AuthTokens | null = null;
let refreshing: Promise<AuthTokens | null> | null = null;
const onSignedOut = new Set<Listener>();

export async function loadTokens(): Promise<AuthTokens | null> {
  tokens = await secure.get<AuthTokens>(KEYS.tokens);
  return tokens;
}

/** Tokens are kept in encrypted storage on the phone (see secureStore.ts). */
export async function saveTokens(t: AuthTokens | null) {
  tokens = t;
  if (t) await secure.set(KEYS.tokens, t);
  else await secure.remove(KEYS.tokens);
}

/** Called when the server rejects our refresh token (session revoked / expired). */
export function subscribeSignedOut(fn: Listener): () => void {
  onSignedOut.add(fn);
  return () => onSignedOut.delete(fn);
}

async function rawFetch(path: string, init: RequestInit & { auth?: boolean; timeoutMs?: number }): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.auth !== false && tokens) headers.set('authorization', `Bearer ${tokens.accessToken}`);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  } catch {
    throw new NetworkError();
  }
}

/** One refresh at a time, even if many requests hit 401 together. */
async function refreshTokens(): Promise<AuthTokens | null> {
  if (!tokens) return null;
  refreshing ??= (async () => {
    try {
      const res = await rawFetch('/v1/auth/refresh', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ refreshToken: tokens!.refreshToken }),
      });
      if (res.status === 401) {
        const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null;
        const reason = body?.error && body.error !== 'unauthorized' ? body.message : undefined;
        await saveTokens(null);
        onSignedOut.forEach((fn) => fn(reason));
        return null;
      }
      if (!res.ok) return null;
      const next = (await res.json()) as AuthTokens;
      await saveTokens(next);
      return next;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const init = { method, auth: opts.auth, timeoutMs: opts.timeoutMs, body: body === undefined ? undefined : JSON.stringify(body) };
  let res = await rawFetch(path, init);
  if (res.status === 401 && opts.auth !== false && tokens) {
    const refreshed = await refreshTokens();
    if (!refreshed) throw new ApiError(401, 'unauthorized', t('Please log in again'));
    res = await rawFetch(path, init);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.error ?? 'error', err.message ?? t('Request failed ({status})', { status: res.status }));
  }
  return data as T;
}

export const api = {
  requestOtp: (phone: string) =>
    request<{ resendAfterSeconds: number; expiresInSeconds: number }>('POST', '/v1/auth/otp/request', { phone }, { auth: false }),
  verifyOtp: (phone: string, code: string, client: ClientKind, deviceName?: string) =>
    request<VerifyOtpResponse>('POST', '/v1/auth/otp/verify', { phone, code, deviceName, client }, { auth: false }),
  logout: () => request<void>('POST', '/v1/auth/logout'),

  me: () => request<MeResponse>('GET', '/v1/me'),
  updateMe: (name: string) => request<MeResponse>('PATCH', '/v1/me', { name }),
  sessions: () => request<SessionDto[]>('GET', '/v1/me/sessions'),
  signOutDevice: (sessionId: string) => request<void>('DELETE', `/v1/me/sessions/${sessionId}`),

  createBusiness: (body: CreateBusinessBody) => request<BusinessDto>('POST', '/v1/businesses', body),
  getBusiness: (id: string) => request<BusinessDto>('GET', `/v1/businesses/${id}`),
  team: (id: string) => request<TeamResponse>('GET', `/v1/businesses/${id}/team`),
  invite: (id: string, body: CreateInviteBody) => request<InviteDto>('POST', `/v1/businesses/${id}/invites`, body),
  revokeInvite: (id: string, inviteId: string) => request<void>('DELETE', `/v1/businesses/${id}/invites/${inviteId}`),
  removeMember: (id: string, userId: string) => request<void>('DELETE', `/v1/businesses/${id}/members/${userId}`),
  setMemberActive: (id: string, userId: string, active: boolean) =>
    request<TeamResponse>('POST', `/v1/businesses/${id}/members/${userId}/${active ? 'activate' : 'deactivate'}`),

  syncPush: (id: string, body: SyncPushBody) => request<SyncPushResponse>('POST', `/v1/businesses/${id}/sync/push`, body),
  syncPull: (id: string, since: number) => request<SyncPullResponse>('GET', `/v1/businesses/${id}/sync/pull?since=${since}`),
  reserveNumbers: (id: string, body: ReserveNumbersBody, timeoutMs?: number) =>
    request<ReserveNumbersResponse>('POST', `/v1/businesses/${id}/numbers/reserve`, body, { timeoutMs }),
  returnNumbers: (id: string, body: ReturnNumbersBody) => request<void>('POST', `/v1/businesses/${id}/numbers/return`, body),
  gstinLookup: (id: string, gstin: string) => request<{ found: boolean; info: GstinInfo | null }>('GET', `/v1/businesses/${id}/gstin/${encodeURIComponent(gstin)}`, undefined, { timeoutMs: 15_000 }),
  adminStores: (q?: string) => request<{ stores: AdminStoreDto[]; activeDevices: number }>('GET', `/v1/admin/stores${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminCreateStore: (body: AdminCreateStoreBody) => request<{ id: string }>('POST', '/v1/admin/stores', body),
  adminSuspend: (id: string, reason: string) => request<void>('POST', `/v1/admin/stores/${id}/suspend`, { reason }),
  adminReactivate: (id: string) => request<void>('POST', `/v1/admin/stores/${id}/reactivate`),
  adminAudit: (id: string) => request<{ entries: AuditEntryDto[] }>('GET', `/v1/admin/stores/${id}/audit`),
  setSeriesCode: (id: string, userId: string, code: string) => request<TeamResponse>('POST', `/v1/businesses/${id}/members/${userId}/series-code`, { code }),

  acceptInvite: (inviteId: string) => request<MeResponse>('POST', `/v1/invites/${inviteId}/accept`),
  declineInvite: (inviteId: string) => request<MeResponse>('POST', `/v1/invites/${inviteId}/decline`),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError || e instanceof NetworkError) return e.message;
  return t('Something went wrong. Please try again.');
}
