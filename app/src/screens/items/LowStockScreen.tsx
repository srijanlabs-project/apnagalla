import { IonButton, IonCheckbox, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { t } from '../../lib/i18n';
import { daysLeft, isLow, orderFor, qtyText, salesSpeed, stockLevels, suggestedOrder, tracksStock } from '../../lib/stock';

/** Items at or below their low-stock level, to reorder from suppliers. */
export default function LowStockScreen() {
  const { actor, isOwner, settings } = useBusiness();
  const canOrder = isOwner || settings.staffSeeCost;
  const data = useLiveQuery(async () => {
    const [items, stock, speed] = await Promise.all([db.items.where('businessId').equals(actor.businessId).toArray(), stockLevels(actor.businessId), salesSpeed(actor.businessId)]);
    // Low by the set level, or running out within a week at the last 30 days' sales.
    return items
      .map((i) => {
        const qty = stock.get(i.id) ?? 0;
        const perDay = speed.get(i.id);
        const days = daysLeft(qty, perDay);
        const order = Math.max(isLow(i, qty) ? suggestedOrder(i, qty) : 0, perDay ? orderFor(qty, perDay) : 0);
        return { item: i, qty, days, order };
      })
      .filter((r) => tracksStock(r.item) && (isLow(r.item, r.qty) || (r.days != null && r.days <= 7)))
      .sort((a, b) => (a.days ?? 999) - (b.days ?? 999) || a.item.name.localeCompare(b.item.name));
  }, [actor.businessId]);
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const picked = useMemo(() => (data ?? []).filter((r) => !unpicked.has(r.item.id)), [data, unpicked]);
  if (!data) return null;

  // One order per supplier is made from the purchase-order screen; this passes the picked items.
  const orderHref = `/tabs/purchase-orders/new?items=${picked.map((r) => `${r.item.id}:${r.order || suggestedOrder(r.item, r.qty)}`).join(',')}`;

  return (
    <PageShell title={t('Low stock')} backHref="/tabs/items" padded={false}>
      {data.length === 0 ? (
        <EmptyState icon={checkmarkCircleOutline} title={t('Nothing is low')} text={t('Items show here when they reach their “Low stock at” level or will run out within a week at the current sales.')} />
      ) : (
        <IonList>
          {data.map(({ item, qty, days, order }) => (
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
                <p>
                  {days != null ? t('About {days} days left', { days }) + ' · ' : ''}
                  {t('order {order} {unit}', { order: qtyText(order || suggestedOrder(item, qty)), unit: item.unit })}
                </p>
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
