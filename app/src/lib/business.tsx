import { IonSpinner } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, type BankAccount, type BusinessProfile, type BusinessSettings, type UpiId } from './db';
import { defaultSettings, ensureBusinessRecords, type Actor } from './repo';
import { useSession } from './session';

interface BusinessValue {
  actor: Actor;
  isOwner: boolean;
  profile: BusinessProfile;
  settings: BusinessSettings;
  bankAccounts: BankAccount[];
  upiIds: UpiId[];
}

const Ctx = createContext<BusinessValue | null>(null);

/** Wraps the signed-in app: guarantees local profile/settings exist and exposes them live. */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const { me, membership } = useSession();
  const businessId = membership!.businessId;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    void ensureBusinessRecords(businessId, membership!.businessName).then(() => setReady(true));
  }, [businessId, membership]);

  const profile = useLiveQuery(() => db.profiles.get(businessId), [businessId]);
  const settings = useLiveQuery(() => db.settings.get(businessId), [businessId]);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.where('businessId').equals(businessId).filter((b) => !b.deleted).toArray(), [businessId]);
  const upiIds = useLiveQuery(() => db.upiIds.where('businessId').equals(businessId).filter((u) => !u.deleted).toArray(), [businessId]);

  const value = useMemo<BusinessValue | null>(() => {
    if (!ready || !profile || !me || !membership) return null;
    return {
      actor: { businessId, userId: me.user.id, userName: me.user.name ?? '', role: membership.role },
      isOwner: membership.role === 'owner',
      profile,
      // Merge so settings added in later versions always have a value.
      settings: { ...defaultSettings(businessId), ...settings, design: { ...defaultSettings(businessId).design, ...settings?.design } },
      bankAccounts: bankAccounts ?? [],
      upiIds: upiIds ?? [],
    };
  }, [ready, profile, settings, bankAccounts, upiIds, me, membership, businessId]);

  if (!value) {
    return (
      <div className="center-fill" style={{ height: '100vh' }}>
        <IonSpinner />
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBusiness(): BusinessValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBusiness must be used inside <BusinessProvider>');
  return v;
}
