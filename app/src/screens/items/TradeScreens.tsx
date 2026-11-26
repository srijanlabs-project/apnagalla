import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, useIonAlert, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, closeCircle } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { FormSection, MoneyField, NumberField } from '../../components/Fields';
import ItemPicker from '../../components/ItemPicker';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Item, type Recipe } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { oldMetalValue, produce, recipeCost, saveRecipe } from '../../lib/modules';
import { newId, putRecord } from '../../lib/repo';

/** Jewellery: the day's gold and silver rates, and the old gold calculator. */
export function JewelleryScreen() {
  const { settings, actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const j = settings.jewellery;
  const [gold, setGold] = useState<number | null>(j?.gold24 ?? null);
  const [silver, setSilver] = useState<number | null>(j?.silver999 ?? null);
  useEffect(() => {
    setGold(settings.jewellery?.gold24 ?? null);
    setSilver(settings.jewellery?.silver999 ?? null);
  }, [settings.jewellery]);
  const [metal, setMetal] = useState<'gold' | 'silver'>('gold');
  const [weight, setWeight] = useState<number | null>(null);
  const [purity, setPurity] = useState<number | null>(22);
  const [cut, setCut] = useState<number | null>(2);
  const rates = { gold24: gold ?? 0, silver999: silver ?? 0 };
  const value = weight && purity ? oldMetalValue(metal, weight, purity, cut ?? 0, rates) : 0;

  return (
    <PageShell title={t('Gold and silver rates')} backHref="/tabs/more">
      <FormSection title={t('Today’s rates')} note={j ? t('Last set {date}', { date: dateIN(j.date) }) : t('Set them each morning; jewellery prices on bills follow them.')}>
        <MoneyField label={t('Gold 24K, per gram')} value={gold} onChange={setGold} disabled={!isOwner} />
        <MoneyField label={t('Silver 999, per gram')} value={silver} onChange={setSilver} disabled={!isOwner} />
        {isOwner && (
          <IonButton
            expand="block"
            disabled={!gold && !silver}
            onClick={async () => {
              await putRecord('settings', actor, { ...settings, jewellery: { gold24: gold ?? 0, silver999: silver ?? 0, date: todayISO() } });
              void toast({ message: t('Saved'), duration: 1200, position: 'top', color: 'success' });
            }}
          >
            {t('Save rates')}
          </IonButton>
        )}
        {!!gold && <p className="section-note">{t('22K: {r22}/g · 18K: {r18}/g', { r22: rupees(Math.round((gold * 22) / 24)), r18: rupees(Math.round((gold * 18) / 24)) })}</p>}
      </FormSection>
      <FormSection title={t('Old gold / silver taken in')} note={t('Use the value on the bill with “Old item taken back”.')}>
        <IonSegment value={metal} onIonChange={(e) => (setMetal(e.detail.value as typeof metal), setPurity(e.detail.value === 'gold' ? 22 : 92.5))}>
          <IonSegmentButton value="gold">
            <IonLabel>{t('Gold')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="silver">
            <IonLabel>{t('Silver')}</IonLabel>
          </IonSegmentButton>
        </IonSegment>
        <div className="field-row">
          <NumberField label={t('Weight (g)')} value={weight} onChange={setWeight} min={0} />
          <NumberField label={metal === 'gold' ? t('Karat') : t('Purity %')} value={purity} onChange={setPurity} min={0} />
        </div>
        <NumberField label={t('Deduction %')} value={cut} onChange={setCut} min={0} max={50} />
        <h2>{rupees(value)}</h2>
      </FormSection>
    </PageShell>
  );
}

/** Bakery and sweets: recipes, and what was made today (stock in; raw material out). */
export function RecipesScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const recipes = useLiveQuery(async () => {
    const list = await db.recipes.where('businessId').equals(actor.businessId).filter((r) => !r.deleted).sortBy('itemName');
    return Promise.all(list.map(async (r) => ({ r, cost: await recipeCost(r) })));
  }, [actor.businessId]);
  const [draft, setDraft] = useState<Recipe | null>(null);
  const [picking, setPicking] = useState<'product' | 'input' | null>(null);

  const make = (r: Recipe) =>
    void alert({
      header: t('Made today: {item}', { item: r.itemName }),
      inputs: [{ name: 'qty', type: 'number', placeholder: t('How many'), min: 0 }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Save'),
          handler: (v: { qty: string }) =>
            void produce(actor, r, Number(v.qty) || 0)
              .then(({ used }) => {
                const short = used.filter((u) => u.short);
                void toast({ message: short.length ? t('Saved. Stock of {items} went below zero: enter the purchase.', { items: short.map((u) => u.name).join(', ') }) : t('Saved: stock updated'), duration: 3000, position: 'top', color: short.length ? 'warning' : 'success' });
              })
              .catch((e: Error) => toast({ message: e.message, duration: 2500, color: 'danger' })),
        },
      ],
    });

  return (
    <PageShell title={t('Recipes and making')} backHref="/tabs/items" padded={false}>
      <IonList>
        {(recipes ?? []).map(({ r, cost }) => (
          <IonItem key={r.id} lines="full">
            <IonLabel className="ion-text-wrap">
              <h3>{r.itemName}</h3>
              <p>
                {t('Makes {n}', { n: r.yieldQty })} · {r.inputs.map((i) => `${i.name} ${i.qty}`).join(', ')} · {t('cost {amount} each', { amount: rupees(cost) })}
              </p>
            </IonLabel>
            <IonButton slot="end" size="small" onClick={() => make(r)}>
              {t('Made today')}
            </IonButton>
            {isOwner && (
              <IonButton slot="end" size="small" fill="clear" onClick={() => setDraft(r)}>
                {t('Edit')}
              </IonButton>
            )}
          </IonItem>
        ))}
      </IonList>
      {isOwner && !draft && (
        <div className="ion-padding">
          <IonButton expand="block" fill="outline" onClick={() => setPicking('product')}>
            <IonIcon icon={addOutline} slot="start" /> {t('New recipe')}
          </IonButton>
        </div>
      )}
      {draft && (
        <div className="ion-padding">
          <FormSection title={draft.itemName}>
            <NumberField label={t('One batch makes')} value={draft.yieldQty} onChange={(yieldQty) => setDraft({ ...draft, yieldQty: yieldQty ?? 1 })} min={0} />
            {draft.inputs.map((i, k) => (
              <div key={i.itemId} className="search-row">
                <NumberField label={i.name} value={i.qty} onChange={(qty) => setDraft({ ...draft, inputs: draft.inputs.map((x, j) => (j === k ? { ...x, qty: qty ?? 0 } : x)) })} min={0} />
                <IonButton fill="clear" color="medium" onClick={() => setDraft({ ...draft, inputs: draft.inputs.filter((_, j) => j !== k) })} aria-label={t('Remove')}>
                  <IonIcon icon={closeCircle} slot="icon-only" />
                </IonButton>
              </div>
            ))}
            <IonButton size="small" fill="outline" onClick={() => setPicking('input')}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add raw material')}
            </IonButton>
            <div className="detail-actions">
              <IonButton
                onClick={async () => {
                  try {
                    await saveRecipe(actor, draft);
                    setDraft(null);
                  } catch (e) {
                    void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
                  }
                }}
              >
                {t('Save recipe')}
              </IonButton>
              <IonButton fill="clear" onClick={() => setDraft(null)}>
                {t('Cancel')}
              </IonButton>
            </div>
          </FormSection>
        </div>
      )}
      <IonNote className="ion-padding section-note">{t('Raw material is used at its unit (kg, litre…); the quantities are for one batch.')}</IonNote>
      <ItemPicker
        isOpen={!!picking}
        onClose={() => setPicking(null)}
        businessId={actor.businessId}
        onPick={(it: Item) => {
          if (picking === 'product') setDraft({ id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', itemId: it.id, itemName: it.name, yieldQty: 1, inputs: [] });
          else if (draft && !draft.inputs.some((i) => i.itemId === it.id)) setDraft({ ...draft, inputs: [...draft.inputs, { itemId: it.id, name: it.name, qty: 1 }] });
          setPicking(null);
        }}
      />
    </PageShell>
  );
}
