import { IonButton, IonCheckbox, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { t } from '../../lib/i18n';
import { isLow, qtyText, stockLevels, suggestedOrder } from '../../lib/stock';

/** Items at or below their low-stock level, to reorder from suppliers. */
export default function LowStockScreen() {
  const { actor, isOwner, settings } = useBusiness();
  const canOrder = isOwner || settings.staffSeeCost;
  const data = useLiveQuery(async () => {
    const [items, stock] = await Promise.all([db.items.where('businessId').equals(actor.businessId).toArray(), stockLevels(actor.businessId)]);
    return items
      .filter((i) => isLow(i, stock.get(i.id) ?? 0))
      .map((i) => ({ item: i, qty: stock.get(i.id) ?? 0 }))
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [actor.businessId]);
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const picked = useMemo(() => (data ?? []).filter((r) => !unpicked.has(r.item.id)), [data, unpicked]);
  if (!data) return null;

  // One order per supplier is made from the purchase-order screen; this passes the picked items.
  const orderHref = `/tabs/purchase-orders/new?items=${picked.map((r) => `${r.item.id}:${suggestedOrder(r.item, r.qty)}`).join(',')}`;

  return (
    <PageShell title={t('Low stock')} backHref="/tabs/items" padded={false}>
      {data.length === 0 ? (
        <EmptyState icon={checkmarkCircleOutline} title={t('Nothing is low')} text={t('Set “Low stock at” on items to see them here when they run low.')} />
      ) : (
        <IonList>
          {data.map(({ item, qty }) => (
            <IonItem key={item.id}>
              {canOrder && (
                <IonCheckbox
                  slot="start"
                  checked={!unpicked.has(item.id)}
                  onIonChange={(e) =>
                    setUnpicked((s) => {
                      const n = new Set(s);
                      if (e.detail.checked) n.delete(item.id);
                      else n.add(item.id);
                      return n;
                    })
                  }
                  aria-label={item.name}
                />
              )}
              <IonLabel>
                <h2>{item.name}</h2>
                <p>{t('Low at {low} · order {order} {unit}', { low: qtyText(item.lowStock ?? 0), order: qtyText(suggestedOrder(item, qty)), unit: item.unit })}</p>
              </IonLabel>
              <IonNote slot="end" className={qty <= 0 ? 'text-danger' : undefined}>
                {qtyText(qty)} {item.unit}
              </IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      {canOrder && picked.length > 0 && (
        <div className="ion-padding">
          <IonButton expand="block" routerLink={orderHref}>
            {t('Make purchase order ({count})', { count: picked.length })}
          </IonButton>
        </div>
      )}
    </PageShell>
  );
}
