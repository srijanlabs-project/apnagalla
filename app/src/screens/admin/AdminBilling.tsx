import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonTitle, IonToggle, IonToolbar, useIonToast } from '@ionic/react';
import type { PlanDto } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { MoneyField, NumberField, SelectField, TextField } from '../../components/Fields';
import { api } from '../../lib/api';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';

type Coupon = Awaited<ReturnType<typeof api.adminCoupons>>['coupons'][number];

/** ApnaGalla team: plans (names, prices before GST, limits) and coupon / partner codes. */
export default function AdminBilling({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [toast] = useIonToast();
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState({ code: '', kind: 'pct' as 'pct' | 'amount' | 'days', value: 10, partner: '', maxUses: null as number | null });
  const fail = (e: unknown) => void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });

  useEffect(() => {
    if (!isOpen) return;
    void api.adminPlans().then((r) => setPlans(r.plans)).catch(fail);
    void api.adminCoupons().then((r) => setCoupons(r.coupons)).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const patch = (id: string, p: Partial<PlanDto>) => setPlans((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const limit = (p: PlanDto, k: keyof PlanDto['limits'], label: string) => (
    <NumberField label={label} value={p.limits[k] ?? null} onChange={(n) => patch(p.id, { limits: { ...p.limits, [k]: n ?? undefined } })} min={0} helper={t('Empty = no limit')} />
  );

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Plans and codes')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Close')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p className="section-note">{t('Prices are before GST. Limits apply only when PLANS_ENFORCED is on in Railway.')}</p>
        {plans.map((p, i) => (
          <div key={p.id} className="admin-plan">
            <div className="field-row">
              <TextField label={`${t('Plan')} (${p.id})`} value={p.name} onChange={(name) => patch(p.id, { name })} />
              <IonToggle checked={p.active} onIonChange={(e) => patch(p.id, { active: e.detail.checked })}>
                {t('On')}
              </IonToggle>
            </div>
            <div className="field-row">
              <MoneyField label={t('Monthly')} value={p.priceMonthly || null} onChange={(v) => patch(p.id, { priceMonthly: v ?? 0 })} />
              <MoneyField label={t('Yearly')} value={p.priceYearly || null} onChange={(v) => patch(p.id, { priceYearly: v ?? 0 })} />
            </div>
            <div className="field-row">
              {limit(p, 'stores', t('Stores'))}
              {limit(p, 'staff', t('Staff'))}
            </div>
            <div className="field-row">
              {limit(p, 'billsPerMonth', t('Bills a month'))}
              {limit(p, 'scansPerDay', t('Bill scans a day'))}
            </div>
            <IonButton size="small" onClick={() => void api.adminSavePlan({ ...p, sort: i }).then((r) => (setPlans(r.plans), toast({ message: t('Saved'), duration: 1200 }))).catch(fail)}>
              {t('Save plan')}
            </IonButton>
          </div>
        ))}

        <IonList>
          <IonListHeader>
            <IonLabel>{t('Codes')}</IonLabel>
          </IonListHeader>
          {coupons.map((c) => (
            <IonItem key={c.code}>
              <IonLabel>
                <h3>{c.code}</h3>
                <p>
                  {c.kind === 'pct' ? `${c.value}%` : c.kind === 'amount' ? rupees(c.value) : t('{n} days', { n: c.value })}
                  {c.partner ? ` · ${c.partner}` : ''}
                </p>
              </IonLabel>
              <IonNote slot="end">{t('Used {n}', { n: c.used })}</IonNote>
            </IonItem>
          ))}
        </IonList>
        <div className="field-row">
          <TextField label={t('New code')} value={code.code} onChange={(v) => setCode((c) => ({ ...c, code: v.toUpperCase() }))} autocapitalize="characters" />
          <SelectField
            label={t('Gives')}
            value={code.kind}
            options={[
              { value: 'pct' as const, label: t('% off') },
              { value: 'amount' as const, label: t('₹ off') },
              { value: 'days' as const, label: t('Free days') },
            ]}
            onChange={(kind) => setCode((c) => ({ ...c, kind }))}
          />
        </div>
        <div className="field-row">
          {code.kind === 'amount' ? (
            <MoneyField label={t('Amount')} value={code.value} onChange={(v) => setCode((c) => ({ ...c, value: v ?? 0 }))} />
          ) : (
            <NumberField label={code.kind === 'pct' ? '%' : t('Days')} value={code.value} onChange={(v) => setCode((c) => ({ ...c, value: v ?? 0 }))} min={1} />
          )}
          <NumberField label={t('Most uses')} value={code.maxUses} onChange={(maxUses) => setCode((c) => ({ ...c, maxUses }))} min={1} />
        </div>
        <TextField label={t('Partner / distributor (optional)')} value={code.partner} onChange={(partner) => setCode((c) => ({ ...c, partner }))} />
        <IonButton
          expand="block"
          disabled={code.code.length < 3 || !code.value}
          onClick={() =>
            void api
              .adminCreateCoupon({ ...code, partner: code.partner || null })
              .then(() => api.adminCoupons())
              .then((r) => (setCoupons(r.coupons), setCode({ code: '', kind: 'pct', value: 10, partner: '', maxUses: null })))
              .catch(fail)
          }
        >
          {t('Add code')}
        </IonButton>
      </IonContent>
    </IonModal>
  );
}
