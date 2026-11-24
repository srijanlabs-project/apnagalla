import { Device } from '@capacitor/device';
import type { CreateBusinessBody, MeResponse, MembershipDto } from '@invoice/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api, loadTokens, saveTokens, subscribeSignedOut } from './api';
import { clearLocalData, pendingChangesCount } from './db';
import { CLIENT_KIND } from './platform';
import { returnAllNumbers, syncNow } from './syncEngine';
import { KEYS, kv } from './storage';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  /** The store this device is working in (may be paused — check `active`). */
  membership: MembershipDto | null;
  /** Why the server signed this device out (shown on the login screen), if known. */
  signOutReason: string | null;
  requestOtp(phone: string): Promise<{ resendAfterSeconds: number }>;
  verifyOtp(phone: string, code: string): Promise<void>;
  refreshMe(): Promise<void>;
  setName(name: string): Promise<void>;
  /** Creates a store and switches to it. */
  createBusiness(body: CreateBusinessBody): Promise<void>;
  switchBusiness(businessId: string): Promise<void>;
  acceptInvite(inviteId: string): Promise<void>;
  declineInvite(inviteId: string): Promise<void>;
  /** Returns the number of unsynced local changes that would be lost; pass force=true to log out anyway. */
  logout(force?: boolean): Promise<{ blockedByUnsynced: number } | void>;
}

const Ctx = createContext<SessionValue | null>(null);

async function deviceName(): Promise<string | undefined> {
  try {
    const info = await Device.getInfo();
    // In a browser the "model" is guessed from the user agent and is often wrong.
    if (CLIENT_KIND === 'web') return `Browser on ${info.operatingSystem === 'unknown' ? 'computer' : info.operatingSystem}`;
    return [info.manufacturer, info.model].filter(Boolean).join(' ') || info.platform;
  } catch {
    return undefined;
  }
}

/** Stored choice if still valid, else the first active store, else the first (paused) one. */
function pickMembership(me: MeResponse | null, preferredId: string | null): MembershipDto | null {
  const list = me?.memberships ?? [];
  return list.find((m) => m.businessId === preferredId) ?? list.find((m) => m.active !== false) ?? list[0] ?? null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMeState] = useState<MeResponse | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [signOutReason, setSignOutReason] = useState<string | null>(null);

  const setMe = useCallback(async (next: MeResponse | null) => {
    setMeState(next);
    if (next) await kv.set(KEYS.me, next);
    else await kv.remove(KEYS.me);
  }, []);

  const selectBusiness = useCallback(async (id: string | null) => {
    setCurrentId(id);
    if (id) await kv.set(KEYS.currentBusiness, id);
    else await kv.remove(KEYS.currentBusiness);
  }, []);

  const signOutLocally = useCallback(
    async (reason?: string) => {
      await saveTokens(null);
      await setMe(null);
      await selectBusiness(null);
      await clearLocalData();
      setSignOutReason(reason ?? null);
      setStatus('signedOut');
    },
    [setMe, selectBusiness],
  );

  const refreshMe = useCallback(async () => {
    try {
      await setMe(await api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await signOutLocally(e.code !== 'unauthorized' ? e.message : undefined);
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
        setCurrentId(await kv.get<string>(KEYS.currentBusiness));
        setStatus('signedIn');
        void refreshMe();
      } else {
        setStatus('signedOut');
      }
    })();
    return subscribeSignedOut((reason) => void signOutLocally(reason));
  }, [refreshMe, signOutLocally]);

  const membership = pickMembership(me, currentId);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      membership,
      signOutReason,
      requestOtp: (phone) => api.requestOtp(phone),
      async verifyOtp(phone, code) {
        const res = await api.verifyOtp(phone, code, CLIENT_KIND, await deviceName());
        await saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken, expiresIn: res.expiresIn });
        await setMe(res.me);
        setSignOutReason(null);
        setStatus('signedIn');
      },
      refreshMe,
      async setName(name) {
        await setMe(await api.updateMe(name));
      },
      async createBusiness(body) {
        const created = await api.createBusiness(body);
        await setMe(await api.me());
        await selectBusiness(created.id);
      },
      async switchBusiness(id) {
        await selectBusiness(id);
        void refreshMe();
      },
      async acceptInvite(id) {
        await setMe(await api.acceptInvite(id));
      },
      async declineInvite(id) {
        await setMe(await api.declineInvite(id));
      },
      async logout(force = false) {
        // Try to upload waiting changes first, so logging out loses nothing when online.
        if (!force && (await pendingChangesCount()) > 0) {
          await syncNow((me?.memberships ?? []).map((m) => m.businessId), membership?.businessId ?? null);
        }
        const unsynced = await pendingChangesCount();
        if (unsynced > 0 && !force) return { blockedByUnsynced: unsynced };
        // Unused numbers go back to the server so the series has no gaps.
        await returnAllNumbers((me?.memberships ?? []).map((m) => m.businessId));
        try {
          await api.logout();
        } catch {
          // Offline: the server session stays until it expires or is revoked; local data is still wiped.
        }
        await signOutLocally();
      },
    }),
    [status, me, membership, signOutReason, refreshMe, setMe, selectBusiness, signOutLocally],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
