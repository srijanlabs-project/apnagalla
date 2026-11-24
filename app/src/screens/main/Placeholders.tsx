import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonRouterLink } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, clipboardOutline } from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { useSession } from '../../lib/session';

/** Home: quick actions + recent invoices. The full dashboard arrives in M4. */
export function HomeScreen() {
  const { me } = useSession();
  const { profile, actor } = useBusiness();
  const first = me?.user.name?.split(' ')[0];
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

  return (
    <PageShell title={profile.name}>
      <h2 className="greeting">Hi{first ? `, ${first}` : ''} 👋</h2>
      <div className="quick-actions">
        <IonButton expand="block" routerLink="/tabs/invoices/new">
          <IonIcon icon={addOutline} slot="start" /> New invoice
        </IonButton>
        <IonButton expand="block" fill="outline" routerLink="/tabs/estimates/new">
          <IonIcon icon={clipboardOutline} slot="start" /> New estimate
        </IonButton>
      </div>

      {recent && recent.length > 0 ? (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>Recent invoices</IonLabel>
            <IonButton routerLink="/tabs/invoices">See all</IonButton>
          </IonListHeader>
          {recent.map((inv) => (
            <IonItem key={inv.id} routerLink={`/tabs/invoices/${inv.id}`} detail={false}>
              <IonLabel>
                <h2>{inv.billTo?.name ?? 'No customer'}</h2>
                <p>
                  {inv.number || 'Draft'} · {dateIN(inv.date)}
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
            <IonCardSubtitle>Get started</IonCardSubtitle>
            <IonCardTitle>Set up in 3 steps</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <ol className="steps">
              <li>
                Add your logo, address and tax ID in <IonRouterLink routerLink="/tabs/more/business">Business profile</IonRouterLink>.
              </li>
              <li>
                Add bank / UPI details in <IonRouterLink routerLink="/tabs/more/payment">Payment details</IonRouterLink> to get paid faster.
              </li>
              <li>Create your first invoice and share it on WhatsApp.</li>
            </ol>
          </IonCardContent>
        </IonCard>
      )}
    </PageShell>
  );
}
