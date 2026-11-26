import { IonButton, IonIcon } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, closeCircle } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, MoneyField } from '../../components/Fields';
import ItemPicker from '../../components/ItemPicker';
import { useBusiness } from '../../lib/business';
import { db, type Customer } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { priceFor } from '../../lib/pricing';

/** The customer's own price for some items (owner). Bills for them use it before the type's price. */
export default function CustomerPrices({ c, patch }: { c: Customer; patch: (p: Partial<Customer>) => void }) {
  const { actor, isOwner } = useBusiness();
  const [picking, setPicking] = useState(false);
  const ids = Object.keys(c.itemPrices ?? {});
  const items = useLiveQuery(async () => (ids.length ? (await db.items.bulkGet(ids)).filter((i) => !!i) : []), [ids.join(',')]);
  const set = (id: string, v: number | null) => {
    const next = { ...(c.itemPrices ?? {}) };
    if (v == null) delete next[id];
    else next[id] = v;
    patch({ itemPrices: next });
  };
  return (
    <FormSection title={t('Own prices for this customer')} note={t('A price here is used on this customer’s bills instead of the item’s price (per {unit}).', { unit: t('base unit') })}>
      {(items ?? []).map((it) => (
        <div key={it!.id} className="po-line">
          <p className="po-line-name">
            {it!.name} · {t('usual {amount}', { amount: rupees(priceFor(it!, c.priceLevel)) })}
          </p>
          <div className="search-row">
            <MoneyField label={t('Price per {unit}', { unit: it!.unit })} value={c.itemPrices?.[it!.id] ?? null} onChange={(v) => set(it!.id, v ?? 0)} disabled={!isOwner} />
            {isOwner && (
              <IonButton fill="clear" color="medium" onClick={() => set(it!.id, null)} aria-label={t('Remove')}>
                <IonIcon icon={closeCircle} slot="icon-only" />
              </IonButton>
            )}
          </div>
        </div>
      ))}
      {isOwner && (
        <IonButton size="small" fill="outline" onClick={() => setPicking(true)}>
          <IonIcon icon={addOutline} slot="start" /> {t('Add an item price')}
        </IonButton>
      )}
      <ItemPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        businessId={actor.businessId}
        onPick={(it) => {
          set(it.id, c.itemPrices?.[it.id] ?? priceFor(it, c.priceLevel));
          setPicking(false);
        }}
      />
    </FormSection>
  );
}
