import { IonSpinner } from '@ionic/react';
import { DEFAULT_STAFF_PERMISSIONS } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db, type BankAccount, type BusinessProfile, type BusinessSettings, type UpiId } from './db';
import { INDIAN_STATES } from './format';
import { scheduleDeliveryAlerts } from './deliveries';
import { buildLedger, type Ledger } from './ledger';
import { convertLegacyPayments, ensureBusinessRecords, withDefaults, type Actor } from './repo';
import { useSession } from './session';
import { useSyncTriggers } from './useSync';

/** What this person may do here (the owner: everything). */
export interface Perms {
  seeCost: boolean;
  maxDiscountPct: number;
  viewReports: boolean;
  editItems: boolean;
  deleteRecords: boolean;
}

interface BusinessValue {
  actor: Actor;
  isOwner: boolean;
  perms: Perms;
  profile: BusinessProfile;
  settings: BusinessSettings;
  bankAccounts: BankAccount[];
  upiIds: UpiId[];
  /** Payments and credit notes of every bill, kept live: use moneyOf(invoice, ledger). */
  ledger: Ledger;
}

const Ctx = createContext<BusinessValue | null>(null);

/** Wraps the signed-in app: guarantees local profile/settings exist and exposes them live. */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const { me, membership } = useSession();
  const businessId = membership!.businessId;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const m = membership!;
    // Match the sign-up state to our list so the State picker shows it.
    const state = INDIAN_STATES.find((s) => s.toLowerCase() === m.businessState?.trim().toLowerCase());
    const address = { city: m.businessCity?.trim() || undefined, state };
    void ensureBusinessRecords(businessId, m.businessName, address).then(() => setReady(true));
  }, [businessId, membership]);

  const activeStores = (me?.memberships ?? []).filter((m) => m.active !== false).map((m) => m.businessId);
  useSyncTriggers(activeStores, businessId);

  const profile = useLiveQuery(() => db.profiles.get(businessId), [businessId]);
  const settings = useLiveQuery(() => db.settings.get(businessId), [businessId]);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.where('businessId').equals(businessId).filter((b) => !b.deleted).toArray(), [businessId]);
  const upiIds = useLiveQuery(() => db.upiIds.where('businessId').equals(businessId).filter((u) => !u.deleted).toArray(), [businessId]);
  const ledger = useLiveQuery(
    async () => buildLedger(await db.payments.where('businessId').equals(businessId).toArray(), await db.creditNotes.where('businessId').equals(businessId).toArray()),
    [businessId],
  );

  // Stable while the person and store stay the same, so screens can safely depend on it.
  const userId = me?.user.id;
  const userName = me?.user.name ?? '';
  const role = membership?.role;
  const seriesCode = membership?.seriesCode ?? '';
  const actor = useMemo<Actor | null>(
    () => (userId && role ? { businessId, userId, userName, role, seriesCode } : null),
    [businessId, userId, userName, role, seriesCode],
  );

  const value = useMemo<BusinessValue | null>(() => {
    if (!ready || !profile || !actor || !membership || !ledger) return null;
    const merged = withDefaults(businessId, settings);
    const p = membership.permissions ?? {};
    const perms: Perms =
      membership.role === 'owner'
        ? { seeCost: true, maxDiscountPct: 100, viewReports: true, editItems: true, deleteRecords: true }
        : {
            seeCost: p.seeCost ?? merged.staffSeeCost,
            maxDiscountPct: p.maxDiscountPct ?? DEFAULT_STAFF_PERMISSIONS.maxDiscountPct,
            viewReports: p.viewReports ?? DEFAULT_STAFF_PERMISSIONS.viewReports,
            editItems: p.editItems ?? DEFAULT_STAFF_PERMISSIONS.editItems,
            deleteRecords: p.deleteRecords ?? DEFAULT_STAFF_PERMISSIONS.deleteRecords,
          };
    return {
      actor: { ...actor, maxDiscountPct: perms.maxDiscountPct },
      ledger,
      perms,
      isOwner: membership.role === 'owner',
      profile,
      // Merge so settings added in later versions always have a value.
      settings: merged,
      bankAccounts: bankAccounts ?? [],
      upiIds: upiIds ?? [],
    };
  }, [ready, profile, settings, bankAccounts, upiIds, ledger, actor, membership, businessId]);

  // Re-plan delivery alerts whenever a delivery date, assignment or the alert time changes.
  const deliveryKey = useLiveQuery(
    async () =>
      (await db.invoices.where('businessId').equals(businessId).toArray())
        .concat(await db.estimates.where('businessId').equals(businessId).toArray() as never[])
        .filter((d) => d.deliveryDate)
        .map((d) => `${d.id}:${d.deliveryDate}:${d.deliveryAssignee?.userId ?? ''}:${d.deliveredAt ?? ''}:${d.status}`)
        .sort()
        .join('|'),
    [businessId],
  );
  const alertTime = value?.settings.deliveryAlertTime;
  useEffect(() => {
    if (actor && deliveryKey !== undefined && alertTime) void scheduleDeliveryAlerts(actor, alertTime).catch(() => undefined);
  }, [actor, deliveryKey, alertTime]);

  // Bills from before payment entries: turn their paid amount into an entry (once, same id everywhere).
  const actorForConvert = value?.actor;
  useEffect(() => {
    if (actorForConvert) void convertLegacyPayments(actorForConvert).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorForConvert?.businessId, actorForConvert?.userId]);

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
