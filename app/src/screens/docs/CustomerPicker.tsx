import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonSearchbar, IonTitle, IonToolbar, useIonToast } from '@ionic/react';
import { formatIndianMobile } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { personAddOutline, walkOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import { useBusiness } from '../../lib/business';
import { db, type Customer, type PartySnapshot } from '../../lib/db';
import { t } from '../../lib/i18n';
import { CustomerForm, blankCustomer, saveCustomer, validateCustomer } from '../customers/CustomerEditScreen';

export function snapshotOf(c: Customer): PartySnapshot {
  return { customerId: c.id, name: c.name, phone: c.phone, email: c.email, address: c.billingAddress, taxId: c.taxId };
}

export const WALK_IN: PartySnapshot = { customerId: null, name: 'Walk-in customer', address: {} };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (party: PartySnapshot, customer: Customer | null) => void;
}

/** Search existing customers, add one inline, or bill a walk-in customer. */
export default function CustomerPicker({ isOpen, onClose, onPick }: Props) {
  const { actor } = useBusiness();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<Customer | null>(null);
  const [toast] = useIonToast();
  const customers = useLiveQuery(
    () =>
      db.customers
        .where('[businessId+name]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .filter((c) => !c.deleted)
        .toArray(),
    [actor.businessId],
  );
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? (customers ?? []).filter((c) => c.name.toLowerCase().includes(s) || (c.phone ?? '').includes(s)) : customers ?? [];
  }, [customers, q]);

  const close = () => {
    setCreating(null);
    setQ('');
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={() => (creating ? setCreating(null) : close())}>{creating ? t('Back') : t('Cancel')}</IonButton>
          </IonButtons>
          <IonTitle>{creating ? t('New customer') : t('Select customer')}</IonTitle>
          {creating && (
            <IonButtons slot="end">
              <IonButton
                strong
                disabled={!!validateCustomer(creating)}
                onClick={async () => {
                  try {
                    const saved = await saveCustomer(actor, creating);
                    onPick(snapshotOf(saved), saved);
                    close();
                  } catch (e) {
                    void toast({ message: e instanceof Error ? e.message : t('Could not save'), duration: 2000, color: 'danger' });
                  }
                }}
              >
                {t('Save')}
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
        {!creating && (
          <IonToolbar>
            <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name or phone')} />
          </IonToolbar>
        )}
      </IonHeader>
      <IonContent className={creating ? 'ion-padding' : undefined}>
        {creating ? (
          <CustomerForm value={creating} update={(fn) => setCreating((cur) => cur && fn(cur))} />
        ) : (
          <IonList>
            <IonItem button detail={false} onClick={() => setCreating(blankCustomer(actor, q.trim()))}>
              <IonIcon icon={personAddOutline} slot="start" color="primary" />
              <IonLabel color="primary">{q.trim() ? t('Add "{name}" as new customer', { name: q.trim() }) : t('Add new customer')}</IonLabel>
            </IonItem>
            <IonItem
              button
              detail={false}
              onClick={() => {
                onPick(WALK_IN, null);
                close();
              }}
            >
              <IonIcon icon={walkOutline} slot="start" />
              <IonLabel>{t('Walk-in / cash customer')}</IonLabel>
            </IonItem>
            {filtered.map((c) => (
              <IonItem
                key={c.id}
                button
                detail={false}
                onClick={() => {
                  onPick(snapshotOf(c), c);
                  close();
                }}
              >
                <IonLabel>
                  <h2>{c.name}</h2>
                  <p>{c.phone ? formatIndianMobile(c.phone) : c.billingAddress.city ?? ''}</p>
                </IonLabel>
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
    </IonModal>
  );
}
