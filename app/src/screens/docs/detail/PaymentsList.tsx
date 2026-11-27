import { IonButton, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonAlert } from '@ionic/react';
import { useState } from 'react';
import { useBusiness } from '../../../lib/business';
import { dateIN, rupees } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { modeLabel, type moneyOf } from '../../../lib/ledger';
import { receiptFor, shareReceipt } from '../../../lib/pdf/receipt';
import { voidPayment } from '../../../lib/repo';

/** Money on the bill: each payment or refund, its receipt, and (owner) void. Voided entries stay folded away. */
export default function PaymentsList({ money, fail }: { money: ReturnType<typeof moneyOf>; fail: (e: unknown) => void }) {
  const { actor, isOwner } = useBusiness();
  const [alert] = useIonAlert();
  const [showVoided, setShowVoided] = useState(false);
  if (!money.entries.length) return null;
  const voided = money.entries.filter((e) => e.voidedAt).length;
  return (
    <IonList inset>
      <IonListHeader>
        <IonLabel>{t('Payments')}</IonLabel>
      </IonListHeader>
      {money.entries
        .filter((e) => showVoided || !e.voidedAt)
        .map((e) => (
          <IonItem key={e.id} lines="full">
            <IonLabel className={e.voidedAt ? 'voided' : undefined}>
              <h3>
                {e.kind === 'refund' ? t('Refund') : t('Received')} · {modeLabel(e.mode)}
                {e.reference ? ` · ${e.reference}` : ''}
              </h3>
              <p>
                {dateIN(e.date)}
                {e.receivedByName ? ` · ${e.receivedByName}` : ''}
                {e.note ? ` · ${e.note}` : ''}
              </p>
              {e.cashGot ? <p>{t('Got {got} · {back} given back', { got: rupees(e.cashGot), back: rupees(e.cashGot - e.amount) })}</p> : null}
              {e.voidedAt && (
                <p className="text-danger">
                  {e.voidedByName ? t('Voided by {name}: {reason}', { name: e.voidedByName, reason: e.voidReason ?? '' }) : t('Voided: {reason}', { reason: e.voidReason ?? '' })}
                </p>
              )}
            </IonLabel>
            <IonNote slot="end" className={e.voidedAt ? 'voided' : e.kind === 'refund' ? 'text-danger' : undefined}>
              {e.kind === 'refund' ? '−' : ''}
              {rupees(e.amount)}
            </IonNote>
            {!e.voidedAt && e.kind === 'payment' && e.mode !== 'advance' && e.mode !== 'creditnote' && (
              <IonButton slot="end" fill="clear" size="small" onClick={() => void receiptFor(e.id).then((d) => d && shareReceipt(d)).catch(fail)}>
                {t('Receipt')}
              </IonButton>
            )}
            {isOwner && !e.voidedAt && (
              <IonButton
                slot="end"
                fill="clear"
                size="small"
                color="medium"
                onClick={() =>
                  void alert({
                    header: t('Void {amount} {mode}?', { amount: rupees(e.amount), mode: modeLabel(e.mode) }),
                    message: t('Use this for a mistake. The entry stays in the history, crossed out.'),
                    inputs: [{ name: 'reason', placeholder: t('Reason') }],
                    buttons: [
                      { text: t('Keep'), role: 'cancel' },
                      { text: t('Void'), role: 'destructive', handler: (v: { reason?: string }) => void voidPayment(actor, e.id, v.reason ?? '').catch(fail) },
                    ],
                  })
                }
              >
                {t('Void')}
              </IonButton>
            )}
          </IonItem>
        ))}
      {voided > 0 && (
        <IonButton fill="clear" size="small" color="medium" onClick={() => setShowVoided(!showVoided)}>
          {showVoided ? t('Hide voided entries') : t('Show voided entries ({n})', { n: voided })}
        </IonButton>
      )}
    </IonList>
  );
}
