import { IonButton, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, useIonAlert } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { cheques, markBounced, markCleared } from '../../lib/cheques';
import { db } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';

/** Customer cheques: pending until marked cleared; a bounced one is voided by the owner. */
export default function ChequesScreen() {
  const { actor, isOwner } = useBusiness();
  const [alert] = useIonAlert();
  const [tab, setTab] = useState<'pending' | 'cleared'>('pending');
  const list = useLiveQuery(() => cheques(actor.businessId), [actor.businessId]);
  const names = useLiveQuery(async () => new Map((await db.customers.where('businessId').equals(actor.businessId).toArray()).map((c) => [c.id, c.name])), [actor.businessId]);
  const shown = (list ?? []).filter((g) => g.status === tab);
  const total = shown.reduce((a, g) => a + g.amount, 0);

  return (
    <PageShell title={t('Cheques')} backHref="/tabs/more" padded={false}>
      <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as 'pending' | 'cleared')}>
        <IonSegmentButton value="pending">
          <IonLabel>{t('Pending')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="cleared">
          <IonLabel>{t('Cleared')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      <IonList inset>
        <IonListHeader>
          <IonLabel>{t('{count} cheques · {amount}', { count: shown.length, amount: rupees(total) })}</IonLabel>
        </IonListHeader>
        {shown.map((g) => (
          <IonItem key={g.key} lines="full">
            <IonLabel>
              <h2>{(g.customerId && names?.get(g.customerId)) || t('Customer')}</h2>
              <p>
                {t('Cheque {number}', { number: g.number || '—' })} · {dateIN(g.date)}
              </p>
            </IonLabel>
            <div slot="end" className="list-end">
              <IonNote className="amount-note">{rupees(g.amount)}</IonNote>
              {g.status === 'pending' && (
                <div>
                  <IonButton size="small" fill="outline" color="success" onClick={() => void markCleared(actor, g)}>
                    {t('Cleared')}
                  </IonButton>
                  {isOwner && (
                    <IonButton
                      size="small"
                      fill="clear"
                      color="danger"
                      onClick={() =>
                        void alert({
                          header: t('Cheque bounced?'),
                          message: t('The payment is taken off; the bill is pending again.'),
                          inputs: [{ name: 'note', placeholder: t('Note (optional)') }],
                          buttons: [
                            { text: t('Cancel'), role: 'cancel' },
                            { text: t('Bounced'), role: 'destructive', handler: (v: { note?: string }) => void markBounced(actor, g, v.note) },
                          ],
                        })
                      }
                    >
                      {t('Bounced')}
                    </IonButton>
                  )}
                </div>
              )}
            </div>
          </IonItem>
        ))}
      </IonList>
    </PageShell>
  );
}
