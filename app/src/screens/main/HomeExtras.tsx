import { IonButton, IonItem, IonLabel, IonList, IonNote, useIonToast } from '@ionic/react';
import { addDaysISO, todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { ToggleRow } from '../../components/Fields';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import type { Customer } from '../../lib/db';
import { deliveriesFor, markDelivered } from '../../lib/deliveries';
import { dateIN, rupees } from '../../lib/format';
import { HOME_CARDS, setHomeCard, useHomeCards } from '../../lib/homeCards';
import { t } from '../../lib/i18n';
import { receivables, receiveKhataPayment } from '../../lib/khata';

/** More → Home screen: which figures this phone shows on Home. */
export function HomeCardsScreen() {
  const shown = useHomeCards();
  return (
    <PageShell title={t('Home screen')} backHref="/tabs/more">
      <p className="section-note">{t('Choose the boxes Home shows on this phone. Figures a login may not see stay hidden anyway.')}</p>
      {HOME_CARDS.map((c) => (
        <ToggleRow key={c.key} label={c.label()} checked={!!shown?.has(c.key)} onChange={(on) => void setHomeCard(c.key, on)} />
      ))}
    </PageShell>
  );
}

/** To collect: every customer who owes, with "Received" to take the money right here. */
export function ToCollectScreen() {
  const { actor, ledger } = useBusiness();
  const [toast] = useIonToast();
  const list = useLiveQuery(async () => (await receivables(actor.businessId)).filter((r) => r.balance > 0), [actor.businessId, ledger]);
  const [paying, setPaying] = useState<{ customer: Customer; balance: number } | null>(null);
  const total = (list ?? []).reduce((a, r) => a + r.balance, 0);
  return (
    <PageShell title={t('To collect')} backHref="/tabs/home" padded={false}>
      <p className="list-summary">{t('{count} customers · {amount}', { count: list?.length ?? 0, amount: rupees(total) })}</p>
      <IonList>
        {(list ?? []).map((r) => (
          <IonItem key={r.customer.id} lines="full" routerLink={`/tabs/customers/${r.customer.id}`} detail={false}>
            <IonLabel className="ion-text-wrap">
              <h3>{r.customer.name}</h3>
              <p className={r.overdue > 0 ? 'text-danger' : undefined}>
                {rupees(r.balance)}
                {r.overdue > 0 ? ` · ${t('{amount} overdue', { amount: rupees(r.overdue) })}` : ''}
              </p>
            </IonLabel>
            <IonButton slot="end" size="small" color="success" onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPaying({ customer: r.customer, balance: r.balance });
              }}
            >
              {t('Received')}
            </IonButton>
          </IonItem>
        ))}
      </IonList>
      {list && list.length === 0 && <IonNote className="ion-padding">{t('Nobody owes the store anything.')}</IonNote>}
      <MoneyEntrySheet
        isOpen={!!paying}
        onClose={() => setPaying(null)}
        title={paying ? t('Received from {name}', { name: paying.customer.name }) : ''}
        amount={paying?.balance}
        saveLabel={t('Received')}
        onSave={async (m) => {
          await receiveKhataPayment(actor, paying!.customer, m);
          void toast({ message: t('Saved: oldest bills marked paid first'), duration: 1800, position: 'top', color: 'success' });
        }}
      />
    </PageShell>
  );
}

/** Urgent deliveries: anything late or due in the next 48 hours, the soonest first. */
export function UrgentDeliveriesScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const until = addDaysISO(todayISO(), 2);
  const list = useLiveQuery(async () => (await deliveriesFor(actor)).filter((d) => d.doc.deliveryDate! <= until), [actor, until]);
  return (
    <PageShell title={t('Urgent deliveries')} backHref="/tabs/home" padded={false}>
      <p className="list-summary">{t('Late and due in the next 48 hours, soonest first')}</p>
      <IonList>
        {(list ?? []).map(({ kind, doc, when }) => (
          <IonItem key={doc.id} lines="full" routerLink={`/tabs/${kind === 'invoice' ? 'invoices' : 'estimates'}/${doc.id}`} detail={false}>
            <IonLabel className="ion-text-wrap">
              <h3>{doc.billTo?.name ?? t('No customer')}</h3>
              <p>
                <span className={when === 'overdue' ? 'text-danger' : undefined}>{when === 'overdue' ? t('Late · {date}', { date: dateIN(doc.deliveryDate!) }) : dateIN(doc.deliveryDate!)}</span>
                {doc.deliverySlot ? ` · ${doc.deliverySlot}` : ''}
                {doc.number ? ` · ${doc.number}` : ''}
                {doc.deliveryAssignee ? ` · ${doc.deliveryAssignee.name}` : ''}
              </p>
            </IonLabel>
            <IonButton
              slot="end"
              size="small"
              fill="outline"
              color="success"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void markDelivered(actor, kind, doc.id)
                  .then(() => toast({ message: t('Marked delivered'), duration: 1200, position: 'top', color: 'success' }))
                  .catch((err: Error) => toast({ message: err.message, duration: 2500, color: 'danger' }));
              }}
            >
              {t('Mark delivered')}
            </IonButton>
          </IonItem>
        ))}
      </IonList>
      {list && list.length === 0 && <IonNote className="ion-padding">{t('No deliveries due in the next 48 hours.')}</IonNote>}
    </PageShell>
  );
}
