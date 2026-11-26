import { IonButton, IonIcon, useIonToast } from '@ionic/react';
import { addOutline, closeCircle } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { FormSection, MoneyField, NumberField, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { loyaltyOf, type LoyaltySettings } from '../../lib/loyalty';
import { putRecord } from '../../lib/repo';

/** Owner: loyalty points rules and membership levels. */
export default function LoyaltyScreen() {
  const { settings, actor, isOwner } = useBusiness();
  const [l, setL] = useState<LoyaltySettings>(loyaltyOf(settings));
  const [toast] = useIonToast();
  useEffect(() => setL(loyaltyOf(settings)), [settings]);
  const patch = (p: Partial<LoyaltySettings>) => setL((x) => ({ ...x, ...p }));
  const ro = !isOwner;
  const example = l.spendPerPoint > 0 ? Math.floor(100000 / l.spendPerPoint) : 0;

  return (
    <FormPage
      title={t('Loyalty points')}
      backHref="/tabs/more"
      onSave={
        isOwner
          ? async () => {
              await putRecord('settings', actor, { ...settings, loyalty: l });
              void toast({ message: t('Saved'), duration: 1200, color: 'success' });
            }
          : undefined
      }
    >
      <FormSection note={t('Named customers earn points on every bill and use them to pay later bills. Walk-in customers don’t earn.')}>
        <ToggleRow label={t('Give loyalty points')} checked={l.enabled} onChange={(enabled) => patch({ enabled })} disabled={ro} />
        <MoneyField label={t('Spend for 1 point')} value={l.spendPerPoint} onChange={(v) => patch({ spendPerPoint: Math.max(100, v ?? 10000) })} disabled={ro} />
        <MoneyField label={t('1 point is worth')} value={l.pointValue} onChange={(v) => patch({ pointValue: Math.max(1, v ?? 100) })} disabled={ro} />
        <NumberField label={t('Fewest points to use at once')} value={l.minRedeem} onChange={(n) => patch({ minRedeem: Math.max(1, Math.round(n ?? 50)) })} min={1} disabled={ro} />
        <p className="section-note">
          {t('Example: a bill of {bill} earns {points} points, worth {worth}.', { bill: rupees(100000), points: example, worth: rupees(example * l.pointValue) })}
        </p>
      </FormSection>

      <FormSection title={t('Membership levels')} note={t('By what the customer spent in the last 12 months. A higher level earns more points per rupee (1.5 = one and a half times).')}>
        {l.tiers.map((tier, i) => (
          <div key={i} className="po-line">
            <div className="search-row">
              <TextField label={t('Level name')} value={tier.name} onChange={(name) => patch({ tiers: l.tiers.map((x, j) => (j === i ? { ...x, name } : x)) })} disabled={ro} />
              {!ro && (
                <IonButton fill="clear" color="medium" onClick={() => patch({ tiers: l.tiers.filter((_, j) => j !== i) })} aria-label={t('Remove')}>
                  <IonIcon icon={closeCircle} slot="icon-only" />
                </IonButton>
              )}
            </div>
            <div className="field-row">
              <MoneyField label={t('Spent in a year')} value={tier.minYearSpend} onChange={(v) => patch({ tiers: l.tiers.map((x, j) => (j === i ? { ...x, minYearSpend: v ?? 0 } : x)) })} disabled={ro} />
              <NumberField label={t('Points ×')} value={tier.multiplier} onChange={(n) => patch({ tiers: l.tiers.map((x, j) => (j === i ? { ...x, multiplier: Math.max(0, n ?? 1) } : x)) })} min={0} disabled={ro} />
            </div>
          </div>
        ))}
        {!ro && (
          <IonButton size="small" fill="outline" onClick={() => patch({ tiers: [...l.tiers, { name: '', minYearSpend: 0, multiplier: 1 }] })}>
            <IonIcon icon={addOutline} slot="start" /> {t('Add level')}
          </IonButton>
        )}
      </FormSection>
    </FormPage>
  );
}
