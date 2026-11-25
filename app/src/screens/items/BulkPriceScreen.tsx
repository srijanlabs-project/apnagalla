import { IonButton, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, useIonAlert, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { flattenCategories, useCategories, withDescendants } from '../../lib/categories';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { applyBulkPrices, bulkPrices } from '../../lib/pricing';

/** Owner: raise or lower a category's selling prices at once, with a preview. */
export default function BulkPriceScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const cats = useCategories(actor.businessId);
  const flat = flattenCategories(cats);
  const items = useLiveQuery(() => db.items.where('businessId').equals(actor.businessId).toArray(), [actor.businessId]);
  const [catId, setCatId] = useState('');
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [kind, setKind] = useState<'pct' | 'amount'>('pct');
  const [pct, setPct] = useState<number | null>(5);
  const [amount, setAmount] = useState<number | null>(null);
  const [roundTo, setRoundTo] = useState<0 | 1 | 5 | 10>(1);

  const preview = useMemo(() => {
    const size = kind === 'pct' ? (pct ?? 0) : (amount ?? 0);
    if (!size) return [];
    return bulkPrices(items ?? [], { categoryIds: catId ? withDescendants(catId, cats) : null, by: dir === 'up' ? size : -size, kind, roundTo }).sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [items, catId, dir, kind, pct, amount, roundTo, cats]);

  if (!isOwner) {
    return (
      <PageShell title={t('Change prices')} backHref="/tabs/items">
        <p>{t('Only the owner can change prices.')}</p>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('Change prices')} backHref="/tabs/items">
      <FormSection>
        <SelectField label={t('Items')} value={catId} options={[{ value: '', label: t('All items') }, ...flat.map((c) => ({ value: c.cat.id, label: c.path }))]} onChange={setCatId} />
        <IonSegment value={dir} onIonChange={(e) => setDir(e.detail.value as 'up' | 'down')}>
          <IonSegmentButton value="up">
            <IonLabel>{t('Raise')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="down">
            <IonLabel>{t('Lower')}</IonLabel>
          </IonSegmentButton>
        </IonSegment>
        <IonSegment value={kind} onIonChange={(e) => setKind(e.detail.value as 'pct' | 'amount')}>
          <IonSegmentButton value="pct">
            <IonLabel>%</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="amount">
            <IonLabel>₹</IonLabel>
          </IonSegmentButton>
        </IonSegment>
        <div className="field-row">
          {kind === 'pct' ? <NumberField label={t('By %')} value={pct} onChange={setPct} min={0} max={100} suffix="%" /> : <MoneyField label={t('By ₹')} value={amount} onChange={setAmount} />}
          <SelectField
            label={t('Round to')}
            value={roundTo}
            options={[
              { value: 0 as const, label: t('Exact') },
              { value: 1 as const, label: '₹1' },
              { value: 5 as const, label: '₹5' },
              { value: 10 as const, label: '₹10' },
            ]}
            onChange={setRoundTo}
          />
        </div>
        <IonButton
          expand="block"
          disabled={!preview.length}
          onClick={() =>
            void alert({
              header: t('Change {count} prices?', { count: preview.length }),
              message: t('Old prices are kept in each item’s price history.'),
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                {
                  text: t('Change'),
                  handler: () => void applyBulkPrices(actor, preview).then((n) => toast({ message: t('{count} prices changed', { count: n }), duration: 2000, position: 'top', color: 'success' })),
                },
              ],
            })
          }
        >
          {t('Change {count} prices', { count: preview.length })}
        </IonButton>
      </FormSection>
      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Preview')}</IonLabel>
        </IonListHeader>
        {preview.slice(0, 200).map(({ item, to }) => (
          <IonItem key={item.id}>
            <IonLabel>{item.name}</IonLabel>
            <IonNote slot="end">
              {rupees(item.rate)} → <strong>{rupees(to)}</strong>
            </IonNote>
          </IonItem>
        ))}
      </IonList>
    </PageShell>
  );
}
