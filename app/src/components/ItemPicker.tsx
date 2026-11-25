import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonModal, IonNote, IonSearchbar, IonTitle, IonToolbar } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import { db, type Item } from '../lib/db';
import { rupees } from '../lib/format';
import { t } from '../lib/i18n';
import { qtyText, stockLevels, tracksStock } from '../lib/stock';
import { sellable } from '../lib/pricing';

/** Pick a catalogue item (search by name, code or barcode); optionally a new name not in the catalogue. */
export default function ItemPicker({
  isOpen,
  onClose,
  businessId,
  onPick,
  onNew,
  showCost,
}: {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  onPick: (item: Item) => void;
  /** Offer "Add “text” as a new item". */
  onNew?: (name: string) => void;
  showCost?: boolean;
}) {
  const [q, setQ] = useState('');
  const items = useLiveQuery(() => (isOpen ? db.items.where('businessId').equals(businessId).filter(sellable).toArray() : []), [isOpen, businessId]);
  const stock = useLiveQuery(() => (isOpen ? stockLevels(businessId) : undefined), [isOpen, businessId]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? [])
      .filter((i) => !s || i.name.toLowerCase().includes(s) || i.code?.toLowerCase() === s || i.barcode === s)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100);
  }, [items, q]);

  const close = () => {
    setQ('');
    onClose();
  };

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Pick item')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={close}>{t('Close')}</IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name, code or barcode')} />
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList>
          {onNew && q.trim() && !list.some((i) => i.name.toLowerCase() === q.trim().toLowerCase()) && (
            <IonItem
              button
              onClick={() => {
                onNew(q.trim());
                close();
              }}
            >
              <IonIcon icon={addOutline} slot="start" />
              <IonLabel>{t('Add “{name}” as a new item', { name: q.trim() })}</IonLabel>
            </IonItem>
          )}
          {list.map((i) => (
            <IonItem
              key={i.id}
              button
              detail={false}
              onClick={() => {
                onPick(i);
                close();
              }}
            >
              <IonLabel>
                <h2>{i.name}</h2>
                <p>
                  {tracksStock(i) && stock ? t('Stock {qty}', { qty: qtyText(stock.get(i.id) ?? 0) }) + ' · ' : ''}
                  {i.unit}
                </p>
              </IonLabel>
              <IonNote slot="end">{showCost && i.purchasePrice ? rupees(i.purchasePrice) : rupees(i.rate)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonModal>
  );
}
