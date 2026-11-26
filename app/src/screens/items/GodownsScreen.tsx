import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonAlert, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, closeCircle, swapHorizontalOutline } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, NumberField, SelectField, TextField } from '../../components/Fields';
import ItemPicker from '../../components/ItemPicker';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import type { Item } from '../../lib/db';
import { godownsOf, moveBetweenGodowns, placeName, SHOP, stockByPlace } from '../../lib/godowns';
import { t } from '../../lib/i18n';
import { newId, putRecord } from '../../lib/repo';
import { qtyText } from '../../lib/stock';

/** Godowns of this store: add / rename them (owner) and move goods between them and the shop. */
export default function GodownsScreen() {
  const { actor, settings, isOwner, perms } = useBusiness();
  const [alert] = useIonAlert();
  const [toast] = useIonToast();
  const godowns = godownsOf(settings);
  const places = [SHOP, ...godowns.map((g) => g.id)];
  const [from, setFrom] = useState<string>(SHOP);
  const [to, setTo] = useState<string>(godowns[0]?.id ?? SHOP);
  const [lines, setLines] = useState<{ item: Item; qty: number | null }[]>([]);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState('');
  const byPlace = useLiveQuery(() => stockByPlace(actor.businessId), [actor.businessId]);
  const canMove = perms.access !== 'readonly' && perms.access !== 'warehouse';

  const saveGodowns = (list: NonNullable<typeof settings.godowns>) => putRecord('settings', actor, { ...settings, godowns: list });
  const name = (header: string, value: string, onOk: (v: string) => void) =>
    void alert({
      header,
      inputs: [{ name: 'name', value, attributes: { maxlength: 40 } }],
      buttons: [{ text: t('Cancel'), role: 'cancel' }, { text: t('Save'), handler: (v: { name: string }) => (v.name.trim() ? onOk(v.name.trim()) : false) }],
    });

  return (
    <PageShell title={t('Godowns')} backHref="/tabs/items">
      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Places')}</IonLabel>
          {isOwner && (
            <IonButton onClick={() => name(t('New godown'), '', (n) => void saveGodowns([...(settings.godowns ?? []), { id: newId(), name: n }]))}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add')}
            </IonButton>
          )}
        </IonListHeader>
        <IonItem lines="full">
          <IonLabel>{t('Shop')}</IonLabel>
          <IonNote slot="end">{t('Default')}</IonNote>
        </IonItem>
        {godowns.map((g) => (
          <IonItem
            key={g.id}
            button={isOwner}
            detail={false}
            onClick={() =>
              isOwner &&
              name(t('Rename godown'), g.name, (n) => void saveGodowns((settings.godowns ?? []).map((x) => (x.id === g.id ? { ...x, name: n } : x))))
            }
          >
            <IonLabel>{g.name}</IonLabel>
            {isOwner && (
              <IonIcon
                slot="end"
                icon={closeCircle}
                color="medium"
                onClick={(e) => {
                  e.stopPropagation();
                  void alert({
                    message: t('Remove {name}? Move its goods out first; its history stays.', { name: g.name }),
                    buttons: [{ text: t('Cancel'), role: 'cancel' }, { text: t('Remove'), role: 'destructive', handler: () => void saveGodowns((settings.godowns ?? []).map((x) => (x.id === g.id ? { ...x, deleted: true } : x))) }],
                  });
                }}
              />
            )}
          </IonItem>
        ))}
        {godowns.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Add a godown to keep stock in more than one place: a back room, a warehouse.')}</IonNote>
          </IonItem>
        )}
      </IonList>

      {godowns.length > 0 && canMove && (
        <FormSection title={t('Move goods')}>
          <div className="field-row">
            <SelectField label={t('From')} value={from} options={places.map((p) => ({ value: p, label: placeName(settings, p) }))} onChange={setFrom} />
            <SelectField label={t('To')} value={to} options={places.map((p) => ({ value: p, label: placeName(settings, p) }))} onChange={setTo} />
          </div>
          {lines.map((l, i) => (
            <div key={l.item.id} className="po-line">
              <p className="po-line-name">
                {l.item.name} · {t('{qty} there', { qty: qtyText(byPlace?.get(l.item.id)?.get(from) ?? 0) })}
              </p>
              <div className="search-row">
                <NumberField label={t('Quantity')} value={l.qty} onChange={(qty) => setLines(lines.map((x, j) => (j === i ? { ...x, qty } : x)))} suffix={l.item.unit} min={0} />
                <IonButton fill="clear" color="medium" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t('Remove')}>
                  <IonIcon icon={closeCircle} slot="icon-only" />
                </IonButton>
              </div>
            </div>
          ))}
          <IonButton fill="outline" size="small" onClick={() => setPicking(true)}>
            <IonIcon icon={addOutline} slot="start" /> {t('Add item')}
          </IonButton>
          <TextField label={t('Note (optional)')} value={note} onChange={setNote} />
          <IonButton
            expand="block"
            disabled={from === to || !lines.some((l) => (l.qty ?? 0) > 0)}
            onClick={async () => {
              try {
                await moveBetweenGodowns(actor, from, to, lines.map((l) => ({ item: l.item, qty: l.qty ?? 0 })), note);
                setLines([]);
                setNote('');
                void toast({ message: t('Moved'), duration: 1500, position: 'top', color: 'success' });
              } catch (e) {
                void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
              }
            }}
          >
            <IonIcon icon={swapHorizontalOutline} slot="start" /> {t('Move')}
          </IonButton>
        </FormSection>
      )}
      <ItemPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        businessId={actor.businessId}
        onPick={(item) => {
          if (!lines.some((l) => l.item.id === item.id)) setLines([...lines, { item, qty: null }]);
          setPicking(false);
        }}
      />
    </PageShell>
  );
}
