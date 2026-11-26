import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { logoWhatsapp, saveOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import { MoneyField, NumberField, SelectField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Item } from '../../lib/db';
import { rateCardText, saveRates, saveWastage } from '../../lib/fresh';
import { t } from '../../lib/i18n';
import { sellable } from '../../lib/pricing';

function useItemList(businessId: string) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const items = useLiveQuery(() => db.items.where('businessId').equals(businessId).filter(sellable).toArray(), [businessId]);
  const cats = useLiveQuery(() => db.categories.where('businessId').equals(businessId).filter((c) => !c.deleted).sortBy('name'), [businessId]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter((i) => (!cat || i.categoryId === cat) && (!s || i.name.toLowerCase().includes(s))).sort((a, b) => a.name.localeCompare(b.name));
  }, [items, q, cat]);
  const filters = (
    <>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search items')} />
      {(cats ?? []).length > 0 && (
        <div className="ion-padding-horizontal">
          <SelectField label={t('Category')} value={cat} options={[{ value: '', label: t('All categories') }, ...(cats ?? []).map((c) => ({ value: c.id, label: c.name }))]} onChange={setCat} />
        </div>
      )}
    </>
  );
  return { list, filters };
}

/** Today's rates: every price in one list each morning, then a rate card on WhatsApp. */
export function RatesScreen() {
  const { actor, profile } = useBusiness();
  const [toast] = useIonToast();
  const { list, filters } = useItemList(actor.businessId);
  const [rates, setRates] = useState<Record<string, number>>({});
  const changed = Object.keys(rates).length;
  const effective = (i: Item) => rates[i.id] ?? i.rate;

  return (
    <PageShell title={t('Today’s rates')} backHref="/tabs/items" padded={false}>
      {filters}
      <IonList>
        {list.map((i) => (
          <IonItem key={i.id} lines="full">
            <IonLabel>
              <h3>{i.name}</h3>
              <p>{t('per {unit}', { unit: i.unit })}</p>
            </IonLabel>
            <div slot="end" style={{ width: 130 }}>
              <MoneyField label={t('Price')} value={effective(i)} onChange={(v) => setRates((r) => (v && v !== i.rate ? { ...r, [i.id]: v } : Object.fromEntries(Object.entries(r).filter(([k]) => k !== i.id))))} />
            </div>
          </IonItem>
        ))}
      </IonList>
      <div className="ion-padding detail-actions">
        <IonButton
          disabled={!changed}
          onClick={async () => {
            const n = await saveRates(actor, list.filter((i) => rates[i.id]).map((i) => ({ item: i, rate: rates[i.id]! })));
            setRates({});
            void toast({ message: t('{n} prices updated', { n }), duration: 1500, position: 'top', color: 'success' });
          }}
        >
          <IonIcon icon={saveOutline} slot="start" /> {t('Save {n} prices', { n: changed })}
        </IonButton>
        <IonButton fill="outline" color="success" href={`https://wa.me/?text=${encodeURIComponent(rateCardText(profile.name, list.map((i) => ({ ...i, rate: effective(i) }))))}`} target="_blank">
          <IonIcon icon={logoWhatsapp} slot="start" /> {t('Send rate card')}
        </IonButton>
      </div>
    </PageShell>
  );
}

/** End of day: what was thrown away or spoilt, item by item. */
export function WastageScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const { list, filters } = useItemList(actor.businessId);
  const [qty, setQty] = useState<Record<string, number>>({});
  const n = Object.values(qty).filter((v) => v > 0).length;
  return (
    <PageShell title={t('Wastage today')} backHref="/tabs/items" padded={false}>
      <p className="section-note ion-padding-horizontal">{t('Enter what was thrown away or spoilt today. It comes off stock; Reports → Wastage shows the cost and the margin after it.')}</p>
      {filters}
      <IonList>
        {list.map((i) => (
          <IonItem key={i.id} lines="full">
            <IonLabel>{i.name}</IonLabel>
            <div slot="end" style={{ width: 120 }}>
              <NumberField label={i.unit} value={qty[i.id] ?? null} onChange={(v) => setQty((q) => ({ ...q, [i.id]: v ?? 0 }))} min={0} />
            </div>
          </IonItem>
        ))}
      </IonList>
      <div className="ion-padding">
        <IonButton
          expand="block"
          disabled={!n}
          onClick={async () => {
            const saved = await saveWastage(actor, list.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ item: i, qty: qty[i.id]! })));
            setQty({});
            void toast({ message: t('Wastage saved for {n} items', { n: saved }), duration: 1500, position: 'top', color: 'success' });
          }}
        >
          {t('Save wastage')}
        </IonButton>
      </div>
    </PageShell>
  );
}
