import { IonButton, IonCard, IonCardContent, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/react';
import { formatIndianMobile } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { callOutline, createOutline, documentTextOutline, logoWhatsapp } from 'ionicons/icons';
import { useParams } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { addressLines, dateIN, rupees } from '../../lib/format';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { pendingAmount } from '../../lib/repo';

export default function CustomerDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor } = useBusiness();
  const c = useLiveQuery(() => db.customers.get(id!), [id]);
  const invoices = useLiveQuery(
    () =>
      db.invoices
        .where('billTo.customerId')
        .equals(id!)
        .filter((i) => !i.deleted && i.businessId === actor.businessId)
        .reverse()
        .sortBy('date'),
    [id, actor.businessId],
  );
  if (!c) return null;

  const saved = (invoices ?? []).filter((i) => i.status === 'saved');
  const billed = saved.reduce((a, i) => a + i.totals.grandTotal, 0) + (c.openingBalance ?? 0);
  const paid = saved.reduce((a, i) => a + i.payment.amountPaid, 0);
  const pending = saved.reduce((a, i) => a + pendingAmount(i), 0) + (c.openingBalance ?? 0);

  return (
    <PageShell title={c.name} backHref="/tabs/customers" padded={false}>
      <IonCard>
        <IonCardContent>
          {c.phone && <p>{formatIndianMobile(c.phone)}</p>}
          {c.email && <p>{c.email}</p>}
          {addressLines(c.billingAddress).map((l) => (
            <p key={l}>{l}</p>
          ))}
          <div className="detail-actions">
            {c.phone && (
              <>
                <IonButton size="small" fill="outline" href={`tel:${c.phone}`}>
                  <IonIcon icon={callOutline} slot="start" /> Call
                </IonButton>
                <IonButton size="small" fill="outline" href={`https://wa.me/${c.phone.replace('+', '')}`} target="_blank">
                  <IonIcon icon={logoWhatsapp} slot="start" /> WhatsApp
                </IonButton>
              </>
            )}
            <IonButton size="small" fill="outline" routerLink={`/tabs/customers/${c.id}/edit`}>
              <IonIcon icon={createOutline} slot="start" /> Edit
            </IonButton>
          </div>
        </IonCardContent>
      </IonCard>

      <div className="stat-grid three">
        <div className="mini-stat">
          <span>Billed</span>
          <strong>{rupees(billed)}</strong>
        </div>
        <div className="mini-stat">
          <span>Paid</span>
          <strong>{rupees(paid)}</strong>
        </div>
        <div className="mini-stat">
          <span>Pending</span>
          <strong className={pending > 0 ? 'text-danger' : ''}>{rupees(pending)}</strong>
        </div>
      </div>

      <IonList inset>
        <IonListHeader>
          <IonLabel>Invoices</IonLabel>
          {CAN_CREATE_INVOICES && <IonButton routerLink={`/tabs/invoices/new?customer=${c.id}`}>New invoice</IonButton>}
        </IonListHeader>
        {(invoices ?? []).length === 0 && (
          <IonItem lines="none">
            <IonIcon icon={documentTextOutline} slot="start" color="medium" />
            <IonNote>No invoices yet</IonNote>
          </IonItem>
        )}
        {(invoices ?? []).map((inv) => (
          <IonItem key={inv.id} routerLink={`/tabs/invoices/${inv.id}`} detail={false}>
            <IonLabel>
              <h2>{inv.number || 'Draft'}</h2>
              <p>{dateIN(inv.date)}</p>
            </IonLabel>
            <div slot="end" className="list-end">
              <strong>{rupees(inv.totals.grandTotal)}</strong>
              <StatusBadge invoice={inv} />
            </div>
          </IonItem>
        ))}
      </IonList>
    </PageShell>
  );
}
