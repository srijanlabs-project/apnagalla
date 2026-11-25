import { IonItem, IonLabel, IonList, IonNote, IonSearchbar } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';
import { SERIAL_KIND_TEXT, serialEvents, warrantyEnd } from '../../lib/serials';

/** Look up a serial / IMEI: when it came in, who bought it, and whether the warranty is on. */
export default function SerialSearchScreen() {
  const { actor } = useBusiness();
  const [q, setQ] = useState('');
  const all = useLiveQuery(() => serialEvents(actor.businessId), [actor.businessId]);
  const key = q.trim().toUpperCase();
  const found = key.length >= 3 && all ? [...all.entries()].filter(([s]) => s.includes(key)).slice(0, 20) : [];

  return (
    <PageShell title={t('Find serial / IMEI')} backHref="/tabs/items" padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Type at least 3 characters')} />
      {key.length >= 3 && found.length === 0 && <p className="ion-padding">{t('Not found in bills or purchases.')}</p>}
      {found.map(([serial, events]) => {
        const sale = [...events].reverse().find((e) => e.kind === 'sold');
        const end = sale?.warrantyMonths ? warrantyEnd(sale.date, sale.warrantyMonths) : null;
        return (
          <IonList inset key={serial}>
            <IonItem lines="full">
              <IonLabel>
                <h2>{serial}</h2>
                <p>{events[0]?.itemName}</p>
              </IonLabel>
              {end && (
                <IonNote slot="end" className={end >= todayISO() ? 'text-success' : 'text-danger'}>
                  {end >= todayISO() ? t('Warranty till {date}', { date: dateIN(end) }) : t('Warranty ended {date}', { date: dateIN(end) })}
                </IonNote>
              )}
            </IonItem>
            {events.map((e, i) => (
              <IonItem key={i} routerLink={e.href} detail={false}>
                <IonLabel>
                  <h3>{SERIAL_KIND_TEXT[e.kind]()}</h3>
                  <p>{[dateIN(e.date), e.party, e.ref].filter(Boolean).join(' · ')}</p>
                </IonLabel>
              </IonItem>
            ))}
          </IonList>
        );
      })}
    </PageShell>
  );
}
