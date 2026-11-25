import {
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonPage,
  IonSearchbar,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonAlert,
  useIonToast,
} from '@ionic/react';
import AdminBilling from './AdminBilling';
import { formatIndianMobile, type AdminStoreDto, type AuditEntryDto } from '@invoice/shared';
import { useCallback, useEffect, useState } from 'react';
import { TextField } from '../../components/Fields';
import { api, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/**
 * ApnaGalla's admin panel (web, /admin; only numbers in the server's ADMIN_PHONES): every store
 * with its owner and activity; create a store for an owner; suspend / reactivate; audit trail.
 */
export default function AdminScreen() {
  const [billing, setBilling] = useState(false);
  const [planFor, setPlanFor] = useState<AdminStoreDto | null>(null);
  const [planForm, setPlanForm] = useState({ planId: 'basic', days: 30 });
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ stores: AdminStoreDto[]; activeDevices: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', ownerPhone: '', city: '' });
  const [trail, setTrail] = useState<{ store: AdminStoreDto; entries: AuditEntryDto[] } | null>(null);
  const fail = useCallback((e: unknown) => void toast({ message: errorMessage(e), duration: 3000, color: 'danger' }), [toast]);

  const load = useCallback(() => {
    api
      .adminStores(q.trim() || undefined)
      .then(setData)
      .catch(fail);
  }, [q, fail]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  function suspend(s: AdminStoreDto) {
    void alert({
      header: t('Suspend {store}?', { store: s.name }),
      message: t('Everyone in this store is blocked at once, on every phone, until you reactivate it.'),
      inputs: [{ name: 'reason', placeholder: t('Reason (shown in the audit log)') }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Suspend'),
          role: 'destructive',
          handler: (v: { reason?: string }) => {
            if (!v.reason?.trim()) return false;
            void api.adminSuspend(s.id, v.reason.trim()).then(load).catch(fail);
            return true;
          },
        },
      ],
    });
  }

  async function create() {
    try {
      await api.adminCreateStore({ name: form.name.trim(), ownerPhone: form.ownerPhone, city: form.city.trim() || undefined });
      setCreating(false);
      setForm({ name: '', ownerPhone: '', city: '' });
      void toast({ message: t('Store created. The owner logs in with this number.'), duration: 2500, color: 'success' });
      load();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('ApnaGalla admin')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setCreating(true)}>{t('New store')}</IonButton>
            <IonButton onClick={() => setBilling(true)}>{t('Plans and codes')}</IonButton>
            <IonButton href="/">{t('Back to app')}</IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search store, phone or city')} />
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {!data ? (
          <div className="center-fill">
            <IonSpinner />
          </div>
        ) : (
          <>
            <p className="section-note ion-padding-horizontal">{t('{stores} stores · {devices} signed-in devices', { stores: data.stores.length, devices: data.activeDevices })}</p>
            <IonList>
              {data.stores.map((s) => (
                <IonItem key={s.id} lines="full">
                  <IonLabel>
                    <h2>
                      {s.name} {s.suspendedAt && <IonBadge color="danger">{t('Suspended')}</IonBadge>}
                    </h2>
                    <p>
                      {s.ownerName ?? t('Owner')} · {s.ownerPhone ? formatIndianMobile(s.ownerPhone) : '—'}
                      {s.city ? ` · ${s.city}` : ''}
                    </p>
                    <p>{t('{members} people · {bills} bills · last active {when}', { members: s.members, bills: s.bills, when: when(s.lastActivity) })}</p>
                    {s.suspendedReason && <p className="text-danger">{s.suspendedReason}</p>}
                  </IonLabel>
                  <IonButtons slot="end">
                    <IonButton size="small" onClick={() => setPlanFor(s)}>
                      {t('Plan')}
                    </IonButton>
                    <IonButton
                      size="small"
                      onClick={() =>
                        api
                          .adminAudit(s.id)
                          .then((r) => setTrail({ store: s, entries: r.entries }))
                          .catch(fail)
                      }
                    >
                      {t('Log')}
                    </IonButton>
                    {s.suspendedAt ? (
                      <IonButton size="small" color="success" onClick={() => void api.adminReactivate(s.id).then(load).catch(fail)}>
                        {t('Reactivate')}
                      </IonButton>
                    ) : (
                      <IonButton size="small" color="danger" onClick={() => suspend(s)}>
                        {t('Suspend')}
                      </IonButton>
                    )}
                  </IonButtons>
                </IonItem>
              ))}
            </IonList>
          </>
        )}

        <AdminBilling isOpen={billing} onClose={() => setBilling(false)} />
        <IonModal isOpen={!!planFor} onDidDismiss={() => setPlanFor(null)} initialBreakpoint={0.6} breakpoints={[0, 0.6, 1]}>
          <IonContent className="ion-padding">
            <h2>{planFor?.name}</h2>
            <p className="section-note">{t('For a store that paid another way (cash, bank). 0 days ends the paid period.')}</p>
            <TextField label={t('Plan id (free, basic, pro…)')} value={planForm.planId} onChange={(planId) => setPlanForm((f) => ({ ...f, planId: planId.trim().toLowerCase() }))} />
            <TextField label={t('Days from today')} inputmode="numeric" value={String(planForm.days)} onChange={(d) => setPlanForm((f) => ({ ...f, days: Number(d.replace(/\D/g, '')) || 0 }))} />
            <IonButton
              expand="block"
              disabled={!planForm.planId}
              onClick={() =>
                void api
                  .adminSetStorePlan(planFor!.id, planForm.planId, planForm.days)
                  .then((r) => toast({ message: t('{plan}: {state}, {n} days left', { plan: r.status.planName, state: r.status.state, n: r.status.daysLeft ?? 0 }), duration: 2500 }))
                  .then(() => setPlanFor(null))
                  .catch(fail)
              }
            >
              {t('Save')}
            </IonButton>
          </IonContent>
        </IonModal>
        <IonModal isOpen={creating} onDidDismiss={() => setCreating(false)}>
          <IonHeader>
            <IonToolbar>
              <IonButtons slot="start">
                <IonButton onClick={() => setCreating(false)}>{t('Cancel')}</IonButton>
              </IonButtons>
              <IonTitle>{t('New store')}</IonTitle>
              <IonButtons slot="end">
                <IonButton strong disabled={!form.name.trim() || form.ownerPhone.replace(/\D/g, '').length < 10} onClick={() => void create()}>
                  {t('Create')}
                </IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <TextField label={t('Store name')} required value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} />
            <TextField label={t('Owner mobile number')} type="tel" inputmode="tel" required value={form.ownerPhone} onChange={(ownerPhone) => setForm((f) => ({ ...f, ownerPhone }))} />
            <TextField label={t('City')} value={form.city} onChange={(city) => setForm((f) => ({ ...f, city }))} />
            <p className="section-note">{t('The owner logs in with this number (OTP) and finds the store ready.')}</p>
          </IonContent>
        </IonModal>

        <IonModal isOpen={!!trail} onDidDismiss={() => setTrail(null)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{trail?.store.name}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => setTrail(null)}>{t('Close')}</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent>
            <IonList>
              {trail?.entries.length === 0 && <IonNote className="ion-padding">{t('Nothing recorded yet.')}</IonNote>}
              {trail?.entries.map((e, i) => (
                <IonItem key={i} lines="full">
                  <IonLabel className="ion-text-wrap">
                    <h3>{e.action}</h3>
                    <p>
                      {when(e.at)} · {e.actorName ?? (e.actorPhone ? formatIndianMobile(e.actorPhone) : '—')}
                    </p>
                    {e.detail && (
                      <p>
                        {Object.entries(e.detail)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ')}
                      </p>
                    )}
                  </IonLabel>
                </IonItem>
              ))}
            </IonList>
          </IonContent>
        </IonModal>
      </IonContent>
    </IonPage>
  );
}
