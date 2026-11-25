import { IonButton, IonFab, IonFabButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonNote, IonToggle, useIonRouter } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, pricetagsOutline, trashOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { FormSection, MoneyField, NumberField, SelectField, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import ItemPicker from '../../components/ItemPicker';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { flattenCategories, useCategories } from '../../lib/categories';
import { db, type Offer } from '../../lib/db';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';
import { describeOffer, offerRuns } from '../../lib/offers';
import { deleteRecord, newId, putRecord } from '../../lib/repo';
import { useForm } from '../../lib/useForm';

function useNames(businessId: string) {
  const items = useLiveQuery(() => db.items.where('businessId').equals(businessId).toArray(), [businessId]);
  const cats = flattenCategories(useCategories(businessId));
  return useMemo(() => {
    const im = new Map((items ?? []).map((i) => [i.id, i.name]));
    const cm = new Map(cats.map((c) => [c.cat.id, c.path]));
    return { item: (id: string) => im.get(id) ?? '?', cat: (id: string) => cm.get(id) ?? '?' };
  }, [items, cats]);
}

export function OffersScreen() {
  const { actor, isOwner } = useBusiness();
  const names = useNames(actor.businessId);
  const offers = useLiveQuery(() => db.offers.where('businessId').equals(actor.businessId).filter((o) => !o.deleted).toArray(), [actor.businessId]);
  return (
    <PageShell title={t('Offers')} backHref="/tabs/items" padded={false}>
      {offers && offers.length === 0 ? (
        <EmptyState icon={pricetagsOutline} title={t('No offers')} text={t('Festive % off a category, buy 2 get 1 free, or a combo price: bills apply them by themselves.')} />
      ) : (
        <IonList>
          {(offers ?? []).map((o) => (
            <IonItem key={o.id} routerLink={isOwner ? `/tabs/items/offers/${o.id}` : undefined} detail={false}>
              <IonLabel>
                <h2>{o.name}</h2>
                <p>
                  {describeOffer(o, names.item, names.cat)}
                  {o.from || o.to ? ` · ${o.from ? dateIN(o.from) : '…'} – ${o.to ? dateIN(o.to) : '…'}` : ''}
                </p>
              </IonLabel>
              <IonNote slot="end" className={offerRuns(o) ? 'text-success' : undefined}>
                {offerRuns(o) ? t('On') : t('Off')}
              </IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      {isOwner && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton routerLink="/tabs/items/offers/new" aria-label={t('New offer')}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}
    </PageShell>
  );
}

export function OfferEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor } = useBusiness();
  const router = useIonRouter();
  const names = useNames(actor.businessId);
  const cats = flattenCategories(useCategories(actor.businessId));
  const isNew = !id || id === 'new';
  const existing = useLiveQuery(() => (isNew ? undefined : db.offers.get(id!)), [id]);
  const initial = useMemo<Offer | undefined>(
    () =>
      isNew
        ? { id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', name: '', active: true, kind: 'percent', pct: 10, categoryId: null, buyQty: 2, getQty: 1, combo: [] }
        : existing,
    [isNew, existing, actor.businessId],
  );
  const { value: o, patch, save, saving } = useForm<Offer>(initial);
  const [picking, setPicking] = useState<'item' | 'combo' | null>(null);
  if (!o) return null;
  const valid =
    !!o.name.trim() &&
    (o.kind === 'percent' ? (o.pct ?? 0) > 0 : o.kind === 'amount' ? (o.amount ?? 0) > 0 : o.kind === 'buyget' ? !!o.itemId && (o.buyQty ?? 0) > 0 && (o.getQty ?? 0) > 0 : (o.combo?.length ?? 0) >= 2 && (o.comboPrice ?? 0) > 0);

  return (
    <FormPage title={isNew ? t('New offer') : t('Edit offer')} backHref="/tabs/items/offers" onSave={() => save(() => putRecord('offers', actor, { ...o, name: o.name.trim() }), { message: t('Offer saved'), back: true })} saving={saving} canSave={valid}>
      <FormSection>
        <TextField label={t('Name on the bill')} required value={o.name} onChange={(name) => patch({ name })} placeholder={t('Diwali 10% off')} />
        <IonItem lines="none">
          <IonToggle checked={o.active} onIonChange={(e) => patch({ active: e.detail.checked })}>
            {t('On')}
          </IonToggle>
        </IonItem>
        <SelectField
          label={t('Type')}
          value={o.kind}
          options={[
            { value: 'percent' as const, label: t('% off') },
            { value: 'amount' as const, label: t('₹ off') },
            { value: 'buyget' as const, label: t('Buy X get Y free') },
            { value: 'combo' as const, label: t('Combo price') },
          ]}
          onChange={(kind) => patch({ kind })}
        />
        <div className="field-row">
          <IonInput className="field" fill="outline" labelPlacement="floating" label={t('From')} type="date" value={o.from ?? ''} onIonInput={(e) => patch({ from: String(e.detail.value ?? '') || null })} />
          <IonInput className="field" fill="outline" labelPlacement="floating" label={t('To')} type="date" value={o.to ?? ''} onIonInput={(e) => patch({ to: String(e.detail.value ?? '') || null })} />
        </div>
      </FormSection>

      {o.kind === 'percent' && (
        <FormSection title={t('% off')}>
          <NumberField label={t('Discount %')} value={o.pct ?? null} onChange={(pct) => patch({ pct: pct ?? 0 })} min={0} max={100} suffix="%" />
          <SelectField
            label={t('On')}
            value={o.categoryId ?? ''}
            options={[{ value: '', label: t('Everything') }, ...cats.map((c) => ({ value: c.cat.id, label: c.path }))]}
            onChange={(categoryId) => patch({ categoryId: categoryId || null, itemId: null })}
          />
        </FormSection>
      )}

      {o.kind === 'amount' && (
        <FormSection title={t('₹ off')}>
          <MoneyField label={t('Amount off')} value={o.amount ?? null} onChange={(amount) => patch({ amount: amount ?? 0 })} />
          <SelectField
            label={t('On')}
            value={o.categoryId ?? ''}
            options={[{ value: '', label: t('The whole bill') }, ...cats.map((c) => ({ value: c.cat.id, label: c.path }))]}
            onChange={(categoryId) => patch({ categoryId: categoryId || null })}
          />
        </FormSection>
      )}

      <FormSection title={t('Conditions')}>
        <MoneyField label={t('Only on bills of at least')} value={o.minBill ?? null} onChange={(minBill) => patch({ minBill })} />
        <TextField label={t('Coupon code (optional)')} value={o.code ?? ''} onChange={(code) => patch({ code: code.trim().toUpperCase() || null })} autocapitalize="characters" helper={t('With a code, the offer applies only when the code is typed on the bill.')} />
        {o.code && <NumberField label={t('Most bills that can use it')} value={o.maxUses ?? null} onChange={(maxUses) => patch({ maxUses })} min={1} />}
      </FormSection>

      {o.kind === 'buyget' && (
        <FormSection title={t('Buy X get Y free')}>
          <IonButton expand="block" fill="outline" onClick={() => setPicking('item')}>
            {o.itemId ? names.item(o.itemId) : t('Pick the item')}
          </IonButton>
          <div className="field-row">
            <NumberField label={t('Buy')} value={o.buyQty ?? null} onChange={(buyQty) => patch({ buyQty: buyQty ?? 0 })} min={1} />
            <NumberField label={t('Get free')} value={o.getQty ?? null} onChange={(getQty) => patch({ getQty: getQty ?? 0 })} min={1} />
          </div>
        </FormSection>
      )}

      {o.kind === 'combo' && (
        <FormSection title={t('Combo price')} note={t('Bought together, these items cost the combo price.')}>
          {(o.combo ?? []).map((c, i) => (
            <div key={c.itemId} className="search-row">
              <IonLabel className="po-line-name">{names.item(c.itemId)}</IonLabel>
              <NumberField label={t('Quantity')} value={c.qty} onChange={(qty) => patch({ combo: (o.combo ?? []).map((x, j) => (j === i ? { ...x, qty: qty ?? 1 } : x)) })} min={1} />
              <IonButton fill="clear" color="danger" onClick={() => patch({ combo: (o.combo ?? []).filter((_, j) => j !== i) })} aria-label={t('Remove')}>
                <IonIcon icon={trashOutline} slot="icon-only" />
              </IonButton>
            </div>
          ))}
          <IonButton size="small" fill="outline" onClick={() => setPicking('combo')}>
            <IonIcon icon={add} slot="start" /> {t('Add item')}
          </IonButton>
          <MoneyField label={t('Combo price')} value={o.comboPrice ?? null} onChange={(comboPrice) => patch({ comboPrice: comboPrice ?? 0 })} />
        </FormSection>
      )}

      <ItemPicker
        isOpen={!!picking}
        onClose={() => setPicking(null)}
        businessId={actor.businessId}
        onPick={(it) => (picking === 'item' ? patch({ itemId: it.id }) : patch({ combo: [...(o.combo ?? []).filter((c) => c.itemId !== it.id), { itemId: it.id, qty: 1 }] }))}
      />
      {!isNew && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void deleteRecord('offers', actor, o.id).then(() => router.push('/tabs/items/offers', 'back', 'replace'))
          }
        >
          {t('Delete offer')}
        </IonButton>
      )}
    </FormPage>
  );
}
