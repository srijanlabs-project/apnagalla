import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonAlert } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, cubeOutline } from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import type { BusinessSettings } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { newId, putRecord } from '../../lib/repo';
import { crateBalances } from '../../lib/shopKinds';

type Asset = NonNullable<BusinessSettings['assets']>[number];

/**
 * Store assets: what the store owns and uses (fridge, scale, furniture, computer, vehicle) and its
 * crates, cans and bottles, including those lying with customers and suppliers.
 */
export default function AssetsScreen() {
  const { actor, settings, isOwner } = useBusiness();
  const [alert] = useIonAlert();
  const assets = (settings.assets ?? []).filter((a) => !a.deleted);
  const crates = useLiveQuery(() => crateBalances(actor.businessId), [actor.businessId]);
  const outByKind = new Map<string, number>();
  for (const c of crates ?? []) if (c.out > 0) outByKind.set(c.kind, (outByKind.get(c.kind) ?? 0) + c.out);
  const save = (list: Asset[]) => void putRecord('settings', actor, { ...settings, assets: list });

  const edit = (a?: Asset) =>
    void alert({
      header: a ? a.name : t('New asset'),
      inputs: [
        { name: 'name', placeholder: t('What (fridge, weighing scale, counter…)'), value: a?.name ?? '' },
        { name: 'qty', type: 'number', placeholder: t('How many'), value: a?.qty ?? 1, min: 0 },
        { name: 'value', type: 'number', placeholder: t('Value ₹ (optional)'), value: a?.value ? a.value / 100 : '' },
        { name: 'date', type: 'date', value: a?.date ?? todayISO() },
        { name: 'place', placeholder: t('Where (shop, godown…), optional'), value: a?.place ?? '' },
      ],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        ...(a ? [{ text: t('Remove'), role: 'destructive', handler: () => save((settings.assets ?? []).map((x) => (x.id === a.id ? { ...x, deleted: true } : x))) }] : []),
        {
          text: t('Save'),
          handler: (v: { name: string; qty: string; value: string; date: string; place: string }) => {
            if (!v.name.trim()) return false;
            const next: Asset = { id: a?.id ?? newId(), name: v.name.trim(), qty: Math.max(0, Number(v.qty) || 1), value: Math.round((Number(v.value) || 0) * 100) || undefined, date: v.date || undefined, place: v.place.trim() || undefined };
            save(a ? (settings.assets ?? []).map((x) => (x.id === a.id ? next : x)) : [...(settings.assets ?? []), next]);
          },
        },
      ],
    });

  return (
    <PageShell title={t('Store assets')} backHref="/tabs/more" padded={false}>
      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('What the store owns')}</IonLabel>
          {isOwner && (
            <IonButton onClick={() => edit()}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add')}
            </IonButton>
          )}
        </IonListHeader>
        {assets.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Note the store’s equipment: fridge, weighing scale, counter, computer, printer, vehicle.')}</IonNote>
          </IonItem>
        )}
        {assets.map((a) => (
          <IonItem key={a.id} button={isOwner} detail={false} onClick={() => isOwner && edit(a)}>
            <IonLabel>
              <h3>
                {a.name} × {a.qty}
              </h3>
              <p>{[a.place, a.date ? dateIN(a.date) : ''].filter(Boolean).join(' · ')}</p>
            </IonLabel>
            {!!a.value && <IonNote slot="end">{rupees(a.value)}</IonNote>}
          </IonItem>
        ))}
        {assets.some((a) => a.value) && (
          <IonItem lines="none">
            <IonLabel>{t('Total value')}</IonLabel>
            <IonNote slot="end">{rupees(assets.reduce((s, a) => s + (a.value ?? 0), 0))}</IonNote>
          </IonItem>
        )}
      </IonList>
      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Crates and containers')}</IonLabel>
        </IonListHeader>
        <IonItem routerLink="/tabs/assets/crates" detail>
          <IonIcon icon={cubeOutline} slot="start" />
          <IonLabel>
            <h3>{t('Crates, cans, bottles, trays')}</h3>
            <p>{outByKind.size ? [...outByKind.entries()].map(([k, n]) => t('{n} {kind} with others', { n, kind: k })).join(' · ') : t('Given with goods and taken back, with deposits')}</p>
          </IonLabel>
        </IonItem>
      </IonList>
      <p className="section-note ion-padding-horizontal">{t('For the books, add big assets as a ledger in More → Books (group Fixed assets).')}</p>
    </PageShell>
  );
}
