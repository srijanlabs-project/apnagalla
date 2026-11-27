
import Fold from '../../../components/Fold';

import { IonButton, IonIcon, IonLabel, IonSegment, IonSegmentButton } from '@ionic/react';
import { type ChargeInput } from '@invoice/shared';
import { addOutline, closeCircle } from 'ionicons/icons';

import { FormSection, MoneyField, NumberField, SelectField, TextField } from '../../../components/Fields';

import { t } from '../../../lib/i18n';
import { rupees } from '../../../lib/format';

import CouponField from '../../../components/CouponField';

import { sync } from '../../../lib/sync';

import type { EditorCtx } from './types';

/** Discount on the total, coupon and extra charges, folded into one line until used. */
export default function AdjustSection({ c }: { c: EditorCtx }) {
  const { doc, patch, locked, noTax, credit, totals, settings, actor, askTargetTotal, targetBefore, targetAfter, kind } = c;
  return (
    <>
        {/* ---------- discount & charges ---------- */}
        {!credit && (
        <Fold
          title={t('Discount, coupon or charges')}
          note={[totals.overallDiscount ? t('Discount {amount}', { amount: rupees(totals.overallDiscount) }) : null, doc.coupon ? t('Coupon {code}', { code: doc.coupon }) : null, totals.chargesTotal ? t('Charges {amount}', { amount: rupees(totals.chargesTotal) }) : null].filter(Boolean).join(' · ') || t('None')}
          open={!!(doc.overallDiscount?.value || doc.targetTotal != null || doc.coupon || doc.charges.length)}
        >
        <FormSection title={noTax ? t('Discount on total') : t('Discount on total (before tax)')}>
          {kind !== 'credit' && !locked && <CouponField businessId={actor.businessId} value={doc.coupon} date={doc.date} invoiceId={doc.id} onChange={(coupon) => patch({ coupon })} />}
          {doc.targetTotal != null ? (
            <div className="target-chip">
              <span>
                {targetBefore}
                <strong>{rupees(doc.targetTotal)}</strong>
                {targetAfter}
              </span>
              {!locked && <IonIcon icon={closeCircle} onClick={() => patch({ targetTotal: null })} aria-label={t('Remove final amount')} />}
            </div>
          ) : (
            <>
              <IonSegment value={doc.overallDiscount?.type ?? 'pct'} disabled={locked} onIonChange={sync((e) => patch({ overallDiscount: { type: e.detail.value as 'pct' | 'amount', value: 0 } }))}>
                <IonSegmentButton value="pct">
                  <IonLabel>%</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="amount">
                  <IonLabel>₹</IonLabel>
                </IonSegmentButton>
              </IonSegment>
              {(doc.overallDiscount?.type ?? 'pct') === 'pct' ? (
                <NumberField label={t('Discount %')} value={doc.overallDiscount?.value || null} onChange={(v) => patch({ overallDiscount: v ? { type: 'pct', value: v } : null })} min={0} max={100} suffix="%" disabled={locked} />
              ) : (
                <MoneyField label={t('Discount ₹')} value={doc.overallDiscount?.value || null} onChange={(v) => patch({ overallDiscount: v ? { type: 'amount', value: v } : null })} disabled={locked} />
              )}
            </>
          )}
          {!locked && doc.lines.length > 0 && (
            <IonButton size="small" fill="clear" onClick={askTargetTotal}>
              {t('Set final amount…')}
            </IonButton>
          )}
        </FormSection>

        <FormSection title={t('Additional charges')}>
          {doc.charges.map((c, i) => (
            <div key={i} className="charge-row">
              <TextField label={t('Charge')} value={c.label} onChange={(label) => patch((cur) => ({ charges: cur.charges.map((x, j) => (j === i ? { ...x, label } : x)) }))} disabled={locked} />
              <MoneyField label={t('Amount')} value={c.amount} onChange={(amount) => patch((cur) => ({ charges: cur.charges.map((x, j) => (j === i ? { ...x, amount: amount ?? 0 } : x)) }))} disabled={locked} />
              {!noTax && (
                <SelectField
                  label={t('Tax %')}
                  value={c.taxPct}
                  options={settings.taxRates.map((r) => ({ value: r, label: `${r}%` }))}
                  onChange={(taxPct) => patch((cur) => ({ charges: cur.charges.map((x, j) => (j === i ? { ...x, taxPct } : x)) }))}
                  disabled={locked}
                />
              )}
              {!locked && <IonIcon icon={closeCircle} className="charge-remove" onClick={() => patch((cur) => ({ charges: cur.charges.filter((_, j) => j !== i) }))} />}
            </div>
          ))}
          {!locked && (
            <IonButton size="small" fill="clear" onClick={() => patch({ charges: [...doc.charges, { label: 'Delivery', amount: 0, taxPct: 0 } as ChargeInput] })}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add charge (delivery, packing…)')}
            </IonButton>
          )}
        </FormSection>
        </Fold>
        )}

    </>
  );
}
