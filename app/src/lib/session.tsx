import { Device } from '@capacitor/device';
import type { CreateBusinessBody, MeResponse, MembershipDto } from '@invoice/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, loadTokens, saveTokens, subscribeSignedOut } from './api';
import { clearLocalData, pendingChangesCount } from './db';
import { KEYS, kv } from './storage';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  /** The active business (phase 1: at most one). */
  membership: MembershipDto | null;
  requestOtp(phone: string): Promise<{ resendAfterSeconds: number }>;
  verifyOtp(phone: string, code: string): Promise<void>;
  refreshMe(): Promise<void>;
  setName(name: string): Promise<void>;
  createBusiness(body: CreateBusinessBody): Promise<void>;
  acceptInvite(inviteId: string): Promise<void>;
  declineInvite(inviteId: string): Promise<void>;
  /** Returns the number of unsynced local changes that would be lost; pass force=true to log out anyway. */
  logout(force?: boolean): Promise<{ blockedByUnsynced: number } | void>;
}

const Ctx = createContext<SessionValue | null>(null);

async function deviceName(): Promise<string | undefined> {
  try {
    const info = await Device.getInfo();
    return [info.manufacturer, info.model].filter(Boolean).join(' ') || info.platform;
  } catch {
    return undefined;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMeState] = useState<MeResponse | null>(null);

  const setMe = useCallback(async (next: MeResponse | null) => {
    setMeState(next);
    if (next) await kv.set(KEYS.me, next);
    else await kv.remove(KEYS.me);
  }, []);

  const signOutLocally = useCallback(async () => {
    await saveTokens(null);
    await setMe(null);
    await clearLocalData();
    setStatus('signedOut');
  }, [setMe]);

  const refreshMe = useCallback(async () => {
    try {
      await setMe(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await signOutLocally();
      // Offline / server error: keep the cached profile so the app keeps working.
    }
  }, [setMe, signOutLocally]);

  // Boot: open instantly from the cached profile (works offline), then refresh in the background.
  useEffect(() => {
    void (async () => {
      const tokens = await loadTokens();
      const cached = await kv.get<MeResponse>(KEYS.me);
      if (tokens && cached) {
        setMeState(cached);
        setStatus('signedIn');
        void refreshMe();
      } else {
        setStatus('signedOut');
      }
    })();
    return subscribeSignedOut(() => void signOutLocally());
  }, [refreshMe, signOutLocally]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      membership: me?.memberships[0] ?? null,
      requestOtp: (phone) => api.requestOtp(phone),
      async verifyOtp(phone, code) {
        const res = await api.verifyOtp(phone, code, await deviceName());
        await saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken, expiresIn: res.expiresIn });
        await setMe(res.me);
        setStatus('signedIn');
      },
      refreshMe,
      async setName(name) {
        await setMe(await api.updateMe(name));
      },
      async createBusiness(body) {
        await api.createBusiness(body);
        await setMe(await api.me());
      },
      async acceptInvite(id) {
        await setMe(await api.acceptInvite(id));
      },
      async declineInvite(id) {
        await setMe(await api.declineInvite(id));
      },
      async logout(force = false) {
        const unsynced = await pendingChangesCount();
        if (unsynced > 0 && !force) return { blockedByUnsynced: unsynced };
        try {
          await api.logout();
        } catch {
          // Offline: the server session stays until it expires or is revoked; local data is still wiped.
        }
        await signOutLocally();
      },
    }),
    [status, me, refreshMe, setMe, signOutLocally],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
