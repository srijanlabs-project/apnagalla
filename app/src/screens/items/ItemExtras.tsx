import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, trashOutline } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, MoneyField, NumberField, TextField } from '../../components/Fields';
import { useBusiness } from '../../lib/business';
import { db, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { applyToVariants, createVariants, variantsOf } from '../../lib/pricing';
import { qtyText, stockEvents, stockLevels } from '../../lib/stock';

/** Wholesale and special prices (per base unit). */
export function PriceLevelsSection({ it, patch, disabled }: { it: Item; patch: (p: Partial<Item>) => void; disabled?: boolean }) {
  if (it.pricing && it.pricing !== 'unit') return null;
  return (
    <FormSection title={t('Prices for customer types')} note={t('Wholesale and special customers get these prices. Empty = the normal price.')}>
      <div className="field-row">
        <MoneyField label={t('Wholesale price')} value={it.prices?.wholesale ?? null} onChange={(wholesale) => patch({ prices: { ...it.prices, wholesale } })} disabled={disabled} />
        <MoneyField label={t('Special price')} value={it.prices?.special ?? null} onChange={(special) => patch({ prices: { ...it.prices, special } })} disabled={disabled} />
      </div>
    </FormSection>
  );
}

/** Other units: 1 box = 12 pcs, with its own price if wanted. Stock is kept in the base unit. */
export function UnitsSection({ it, patch, disabled }: { it: Item; patch: (p: Partial<Item>) => void; disabled?: boolean }) {
  if (it.pricing && it.pricing !== 'unit') return null;
  const units = it.altUnits ?? [];
  const set = (i: number, p: Partial<(typeof units)[number]>) => patch({ altUnits: units.map((u, j) => (j === i ? { ...u, ...p } : u)) });
  return (
    <FormSection title={t('Other units')} note={t('For things bought or sold in boxes, dozens or cartons. Stock is counted in {unit}.', { unit: it.unit })}>
      {units.map((u, i) => (
        <div key={i} className="search-row">
          <TextField label={t('Unit')} value={u.unit} onChange={(unit) => set(i, { unit: unit.trim().slice(0, 10) })} disabled={disabled} />
          <NumberField label={t('= how many {unit}', { unit: it.unit })} value={u.factor || null} onChange={(factor) => set(i, { factor: factor ?? 0 })} min={0} disabled={disabled} />
          <MoneyField label={t('Price (optional)')} value={u.rate ?? null} onChange={(rate) => set(i, { rate })} disabled={disabled} />
          {!disabled && (
            <IonButton fill="clear" color="danger" onClick={() => patch({ altUnits: units.filter((_, j) => j !== i) })} aria-label={t('Remove')}>
              <IonIcon icon={trashOutline} slot="icon-only" />
            </IonButton>
          )}
        </div>
      ))}
      {!disabled && (
        <IonButton size="small" fill="outline" onClick={() => patch({ altUnits: [...units, { unit: 'box', factor: 12 }] })}>
          <IonIcon icon={addOutline} slot="start" /> {t('Add a unit')}
        </IonButton>
      )}
    </FormSection>
  );
}

/** Sizes and colours: shows the variants of a group, or turns an item into one. */
export function VariantsSection({ it, saved }: { it: Item; saved: boolean }) {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [sizes, setSizes] = useState('');
  const [colours, setColours] = useState('');
  const [open, setOpen] = useState(false);
  const variants = useLiveQuery(() => (it.hasVariants ? variantsOf(it.id) : Promise.resolve([] as Item[])), [it.id, it.hasVariants]);
  const stock = useLiveQuery(() => stockLevels(actor.businessId), [actor.businessId]);
  // An item that already has stock records can't become a group (its stock would be lost).
  const hasHistory = useLiveQuery(async () => ((await stockEvents(actor.businessId)).get(it.id)?.length ?? 0) > 0, [actor.businessId, it.id]);
  const parent = useLiveQuery(async () => (it.variantOf ? db.items.get(it.variantOf) : undefined), [it.variantOf]);

  if (!saved || (it.pricing && it.pricing !== 'unit')) return null;
  if (it.variantOf) {
    return (
      <FormSection>
        <IonItem routerLink={`/tabs/items/${it.variantOf}`} detail lines="none">
          <IonLabel>{t('Variant of {name}', { name: parent?.name ?? '' })}</IonLabel>
        </IonItem>
      </FormSection>
    );
  }
  if (!isOwner || (!it.hasVariants && hasHistory)) return null;

  const make = async () => {
    const made = await createVariants(
      actor,
      it,
      sizes.split(/[,/]/),
      colours.split(/[,/]/),
    );
    setSizes('');
    setColours('');
    setOpen(false);
    void toast({ message: t('{count} variants added', { count: made.length }), duration: 1500, position: 'top', color: 'success' });
  };

  return (
    <FormSection title={t('Sizes and colours')}>
      {it.hasVariants && (
        <>
          <IonList className="flush-list">
            {(variants ?? []).map((v) => (
              <IonItem key={v.id} routerLink={`/tabs/items/${v.id}`} detail={false}>
                <IonLabel>{v.variantLabel ?? v.name}</IonLabel>
                <IonNote slot="end" className="amount-note">
                  {rupees(v.rate)}
                  <span className="stock-qty">{t('Stock {qty}', { qty: qtyText(stock?.get(v.id) ?? 0) })}</span>
                </IonNote>
              </IonItem>
            ))}
          </IonList>
          <IonButton
            size="small"
            fill="clear"
            onClick={() => void applyToVariants(actor, it).then((n) => toast({ message: t('Price and tax copied to {count} variants', { count: n }), duration: 1500, position: 'top' }))}
          >
            {t('Copy price and tax to all variants')}
          </IonButton>
        </>
      )}
      {open ? (
        <>
          <TextField label={t('Sizes (comma separated)')} value={sizes} onChange={setSizes} placeholder="S, M, L, XL" />
          <TextField label={t('Colours (comma separated)')} value={colours} onChange={setColours} placeholder="Red, Blue" />
          <IonButton expand="block" disabled={!sizes.trim() && !colours.trim()} onClick={() => void make()}>
            {t('Make variants')}
          </IonButton>
        </>
      ) : (
        <IonButton size="small" fill="outline" onClick={() => setOpen(true)}>
          <IonIcon icon={addOutline} slot="start" /> {it.hasVariants ? t('Add sizes / colours') : t('This item comes in sizes / colours')}
        </IonButton>
      )}
      {!it.hasVariants && <p className="section-note">{t('Each size and colour becomes its own item with its own stock, barcode and price.')}</p>}
    </FormSection>
  );
}
