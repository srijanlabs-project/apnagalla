import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, closeCircle } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, NumberField, SelectField, TextField } from '../../components/Fields';
import ItemPicker from '../../components/ItemPicker';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { type Item } from '../../lib/db';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { stockLevels } from '../../lib/stock';
import { transferStock, transfersOf } from '../../lib/transfers';

/** Owner: send stock from this store to another of your stores. */
export default function TransferScreen() {
  const { me } = useSession();
  const { actor, profile, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const others = (me?.memberships ?? []).filter((m) => m.businessId !== actor.businessId && m.role === 'owner' && m.active);
  const [to, setTo] = useState(others[0]?.businessId ?? '');
  const [lines, setLines] = useState<{ item: Item; qty: number }[]>([]);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const levels = useLiveQuery(() => stockLevels(actor.businessId), [actor.businessId]);
  const history = useLiveQuery(() => transfersOf(actor.businessId), [actor.businessId]);
  const nameOf = (id: string) => (me?.memberships ?? []).find((m) => m.businessId === id)?.businessName ?? t('another store');
  if (!isOwner) return null;

  return (
    <PageShell title={t('Stock transfer')} backHref="/tabs/items">
      {others.length === 0 ? (
        <p className="ion-padding">{t('Add another store (More → Stores) to move stock between them.')}</p>
      ) : (
        <FormSection title={t('Send stock')}>
          <SelectField label={t('To store')} value={to} options={others.map((m) => ({ value: m.businessId, label: m.businessName }))} onChange={setTo} />
          <IonList>
            {lines.map((l, i) => (
              <IonItem key={l.item.id}>
                <IonLabel>
                  <h3>{l.item.name}</h3>
                  <p>{t('In stock {qty}', { qty: levels?.get(l.item.id) ?? 0 })}</p>
                </IonLabel>
                <div style={{ width: 110 }}>
                  <NumberField label={l.item.unit || t('Qty')} value={l.qty} min={0} onChange={(qty) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: qty ?? 0 } : x)))} />
                </div>
                <IonIcon icon={closeCircle} slot="end" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
              </IonItem>
            ))}
          </IonList>
          <IonButton fill="outline" onClick={() => setPicking(true)}>
            <IonIcon icon={add} slot="start" /> {t('Add item')}
          </IonButton>
          <TextField label={t('Note (vehicle, person…)')} value={note} onChange={setNote} />
          <IonButton
            expand="block"
            disabled={busy || !to || !lines.some((l) => l.qty > 0)}
            onClick={async () => {
              setBusy(true);
              try {
                await transferStock(actor, { businessId: to, name: nameOf(to), isOwner: true }, profile.name, lines.map((l) => ({ itemId: l.item.id, qty: l.qty })), { note });
                setLines([]);
                setNote('');
                void toast({ message: t('Stock sent to {store}', { store: nameOf(to) }), duration: 1800, color: 'success' });
              } catch (e) {
                void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Send to {store}', { store: to ? nameOf(to) : '' })}
          </IonButton>
          <p className="section-note">{t('The stock leaves this store and is added to the other one. Items missing there are added with the same details.')}</p>
        </FormSection>
      )}
      {history && history.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Transfers')}</IonLabel>
          </IonListHeader>
          {history.slice(0, 50).map((h) => (
            <IonItem key={h.transferId}>
              <IonLabel>
                <h3>{h.out ? t('To {store}', { store: nameOf(h.otherBusinessId) }) : t('From {store}', { store: nameOf(h.otherBusinessId) })}</h3>
                <p>{h.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}</p>
              </IonLabel>
              <IonNote slot="end">{dateIN(h.date)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      <ItemPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        businessId={actor.businessId}
        onPick={(item) => {
          setPicking(false);
          if (!lines.some((l) => l.item.id === item.id)) setLines([...lines, { item, qty: 1 }]);
        }}
      />
    </PageShell>
  );
}
