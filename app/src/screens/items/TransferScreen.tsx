import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, closeCircle } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, NumberField, SelectField, TextField } from '../../components/Fields';
import ItemPicker from '../../components/ItemPicker';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Item } from '../../lib/db';
import { dateIN } from '../../lib/format';
import { godownsOf, moveBetweenGodowns, placeName, SHOP, stockByPlace } from '../../lib/godowns';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { qtyText } from '../../lib/stock';
import { transferStock, transfersOf } from '../../lib/transfers';

/** A place stock can be: a store (its shop counter or one of its godowns). Key "storeId|godownId". */
interface Place {
  key: string;
  businessId: string;
  godownId: string;
  label: string;
}

/**
 * Moving stock: from this store's shop or a godown, to another place of this store or to any other
 * store you own (its shop or one of its godowns). Inside one store it is a godown move (the store's
 * total doesn't change); to another store, the stock leaves this store and is added there.
 */
export default function TransferScreen() {
  const { me } = useSession();
  const { actor, profile, settings, isOwner, perms } = useBusiness();
  const [toast] = useIonToast();
  const owned = (me?.memberships ?? []).filter((m) => m.role === 'owner' && m.active);
  const others = owned.filter((m) => m.businessId !== actor.businessId);
  const here: Place[] = [SHOP, ...godownsOf(settings).map((g) => g.id)].map((g) => ({ key: `${actor.businessId}|${g}`, businessId: actor.businessId, godownId: g, label: placeName(settings, g) }));
  // Other stores' godowns come from their settings on this phone (an owner's phone keeps all their stores).
  const away = useLiveQuery(async () => {
    const out: Place[] = [];
    for (const m of others) {
      const s = await db.settings.get(m.businessId);
      out.push({ key: `${m.businessId}|`, businessId: m.businessId, godownId: '', label: m.businessName });
      for (const g of godownsOf(s ?? {})) out.push({ key: `${m.businessId}|${g.id}`, businessId: m.businessId, godownId: g.id, label: `${m.businessName} · ${g.name}` });
    }
    return out;
  }, [others.map((m) => m.businessId).join(',')]);
  const [from, setFrom] = useState(`${actor.businessId}|`);
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<{ item: Item; qty: number }[]>([]);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const places = useLiveQuery(() => stockByPlace(actor.businessId), [actor.businessId]);
  const history = useLiveQuery(() => transfersOf(actor.businessId), [actor.businessId]);
  const godownMoves = useLiveQuery(
    async () =>
      (await db.stockMoves.where('businessId').equals(actor.businessId).filter((m) => m.kind === 'transfer' && !m.otherBusinessId && !!m.transferId && m.qty < 0 && !m.voidedAt && !m.deleted).toArray())
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 50),
    [actor.businessId],
  );
  const nameOf = (id: string) => (me?.memberships ?? []).find((m) => m.businessId === id)?.businessName ?? t('another store');
  if (!isOwner && (perms.access === 'readonly' || perms.access === 'warehouse')) return null;

  const src = here.find((p) => p.key === from) ?? here[0]!;
  const targets = [...here.filter((p) => p.key !== src.key), ...(isOwner ? (away ?? []) : [])];
  const dst = targets.find((p) => p.key === to) ?? targets[0];
  const fromQty = (itemId: string) => places?.get(itemId)?.get(src.godownId) ?? 0;

  async function send() {
    if (!dst) return;
    setBusy(true);
    try {
      const items = lines.filter((l) => l.qty > 0);
      if (dst.businessId === actor.businessId) {
        await moveBetweenGodowns(actor, src.godownId, dst.godownId, items, note);
      } else {
        await transferStock(actor, { businessId: dst.businessId, name: nameOf(dst.businessId), isOwner: true }, profile.name, items.map((l) => ({ itemId: l.item.id, qty: l.qty })), { note, fromGodown: src.godownId, toGodown: dst.godownId });
      }
      setLines([]);
      setNote('');
      void toast({ message: t('Stock moved to {place}', { place: dst.label }), duration: 1800, color: 'success' });
    } catch (e) {
      void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={t('Stock transfer')} backHref="/tabs/items">
      {targets.length === 0 ? (
        <p className="ion-padding">{t('Add a godown (Items → Godowns) or another store (More → Stores) to move stock between them.')}</p>
      ) : (
        <FormSection title={t('Move stock')}>
          <SelectField label={t('From')} value={src.key} options={here.map((p) => ({ value: p.key, label: p.label }))} onChange={(v) => (setFrom(v), setTo(''))} />
          <SelectField label={t('To')} value={dst?.key ?? ''} options={targets.map((p) => ({ value: p.key, label: p.businessId === actor.businessId ? p.label : `→ ${p.label}` }))} onChange={setTo} />
          <IonList>
            {lines.map((l, i) => (
              <IonItem key={l.item.id}>
                <IonLabel>
                  <h3>{l.item.name}</h3>
                  <p>{t('{qty} at {place}', { qty: qtyText(fromQty(l.item.id)), place: src.label })}</p>
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
          <IonButton expand="block" disabled={busy || !dst || !lines.some((l) => l.qty > 0)} onClick={() => void send()}>
            {t('Move to {place}', { place: dst?.label ?? '' })}
          </IonButton>
          <p className="section-note">
            {dst && dst.businessId !== actor.businessId
              ? t('The stock leaves this store and is added to the other one. Items missing there are added with the same details.')
              : t('Moving inside this store: its total stock stays the same.')}
          </p>
        </FormSection>
      )}
      {((history?.length ?? 0) > 0 || (godownMoves?.length ?? 0) > 0) && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Transfers')}</IonLabel>
          </IonListHeader>
          {(history ?? []).slice(0, 50).map((h) => (
            <IonItem key={h.transferId}>
              <IonLabel>
                <h3>{h.out ? t('To {store}', { store: nameOf(h.otherBusinessId) }) : t('From {store}', { store: nameOf(h.otherBusinessId) })}</h3>
                <p>{h.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}</p>
              </IonLabel>
              <IonNote slot="end">{dateIN(h.date)}</IonNote>
            </IonItem>
          ))}
          {(godownMoves ?? []).map((m) => (
            <IonItem key={m.id}>
              <IonLabel>
                <h3>
                  {placeName(settings, m.godownId)} → {placeName(settings, m.toGodownId)}
                </h3>
                <p>
                  {m.itemName} × {-m.qty}
                </p>
              </IonLabel>
              <IonNote slot="end">{dateIN(m.date)}</IonNote>
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
