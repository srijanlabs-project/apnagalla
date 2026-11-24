import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonRouterLink, useIonRouter } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, cartOutline, clipboardOutline } from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { deliveriesFor, markDelivered } from '../../lib/deliveries';
import { t } from '../../lib/i18n';
import { CAN_CREATE_INVOICES, webInvoiceNote } from '../../lib/platform';
import { useSession } from '../../lib/session';

/** Home: quick actions + recent invoices. The full dashboard arrives in M4. */
export function HomeScreen() {
  const { me } = useSession();
  const { profile, actor } = useBusiness();
  const first = me?.user.name?.split(' ')[0];
  const router = useIonRouter();
  // Overdue, today and tomorrow (later ones only get the phone alert).
  const deliveries = useLiveQuery(async () => (await deliveriesFor(actor)).filter((d) => d.when !== 'later'), [actor]);
  const recent = useLiveQuery(
    () =>
      db.invoices
        .where('[businessId+date]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .reverse()
        .filter((i) => !i.deleted)
        .limit(5)
        .toArray(),
    [actor.businessId],
  );

  const [step1Before, step1After] = t('Add your logo, address and tax ID in {link}.').split('{link}');
  const [step2Before, step2After] = t('Add bank / UPI details in {link} to get paid faster.').split('{link}');

  return (
    <PageShell title={profile.name} titleLink="/tabs/more/stores">
      <h2 className="greeting">{first ? t('Hi, {name}', { name: first }) : t('Hi')} 👋</h2>
      <div className="quick-actions">
        {CAN_CREATE_INVOICES && (
          <IonButton expand="block" size="large" routerLink="/tabs/sale">
            <IonIcon icon={cartOutline} slot="start" /> {t('New sale')}
          </IonButton>
        )}
        {CAN_CREATE_INVOICES && (
          <IonButton expand="block" fill="outline" routerLink="/tabs/invoices/new">
            <IonIcon icon={addOutline} slot="start" /> {t('New invoice')}
          </IonButton>
        )}
        <IonButton expand="block" fill="outline" routerLink="/tabs/estimates/new">
          <IonIcon icon={clipboardOutline} slot="start" /> {t('New estimate')}
        </IonButton>
      </div>
      {!CAN_CREATE_INVOICES && <p className="section-note">{webInvoiceNote()}</p>}

      {deliveries && deliveries.length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Deliveries')}</IonLabel>
          </IonListHeader>
          {deliveries.map(({ kind, doc, when }) => (
            <IonItem key={doc.id} detail={false}>
              <IonLabel onClick={() => router.push(`/tabs/${kind === 'invoice' ? 'invoices' : 'estimates'}/${doc.id}`)}>
                <h2>{doc.billTo?.name ?? t('No customer')}</h2>
                <p>
                  <span className={when === 'overdue' ? 'text-danger' : undefined}>{when === 'overdue' ? t('Overdue · {date}', { date: dateIN(doc.deliveryDate!) }) : when === 'today' ? t('Today') : t('Tomorrow')}</span>
                  {doc.number ? ` · ${doc.number}` : ''}
                  {doc.deliveryAssignee ? ` · ${doc.deliveryAssignee.name}` : ''}
                </p>
              </IonLabel>
              <IonButton slot="end" size="small" fill="outline" color="success" onClick={() => void markDelivered(actor, kind, doc.id)}>
                {t('Delivered')}
              </IonButton>
            </IonItem>
          ))}
        </IonList>
      )}

      {recent && recent.length > 0 ? (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Recent invoices')}</IonLabel>
            <IonButton routerLink="/tabs/invoices">{t('See all')}</IonButton>
          </IonListHeader>
          {recent.map((inv) => (
            <IonItem key={inv.id} routerLink={`/tabs/invoices/${inv.id}`} detail={false}>
              <IonLabel>
                <h2>{inv.billTo?.name ?? t('No customer')}</h2>
                <p>
                  {inv.number || t('Draft')} · {dateIN(inv.date)}
                </p>
              </IonLabel>
              <div slot="end" className="list-end">
                <strong>{rupees(inv.totals.grandTotal)}</strong>
                <StatusBadge invoice={inv} />
              </div>
            </IonItem>
          ))}
        </IonList>
      ) : (
        <IonCard>
          <IonCardHeader>
            <IonCardSubtitle>{t('Get started')}</IonCardSubtitle>
            <IonCardTitle>{t('Set up in 3 steps')}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <ol className="steps">
              <li>
                {step1Before}
                <IonRouterLink routerLink="/tabs/more/business">{t('Business profile')}</IonRouterLink>
                {step1After}
              </li>
              <li>
                {step2Before}
                <IonRouterLink routerLink="/tabs/more/payment">{t('Payment details')}</IonRouterLink>
                {step2After}
              </li>
              <li>{t('Create your first invoice and share it on WhatsApp.')}</li>
            </ol>
          </IonCardContent>
        </IonCard>
      )}
    </PageShell>
  );
}
