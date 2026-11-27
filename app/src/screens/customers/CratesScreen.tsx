import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField, TextField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { crateBalances, saveCrates } from '../../lib/shopKinds';

/** Crates, cans, bottles and trays: what is out with each party, and deposits held. */
export default function CratesScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const balances = useLiveQuery(() => crateBalances(actor.businessId), [actor.businessId]);
  const customers = useLiveQuery(() => db.customers.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).sortBy('name'), [actor.businessId]);
  const suppliers = useLiveQuery(() => db.suppliers.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).sortBy('name'), [actor.businessId]);
  const [type, setType] = useState<'customer' | 'supplier'>('customer');
  const [partyId, setPartyId] = useState('');
  const [kind, setKind] = useState(t('Crate'));
  const [out, setOut] = useState<number | null>(null);
  const [back, setBack] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number | null>(null);
  const parties = (type === 'customer' ? customers : suppliers) ?? [];

  return (
    <PageShell title={t('Crates and containers')} backHref="/tabs/assets" padded={false}>
      <IonList inset className="flush-list">
        {(balances ?? []).length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Nothing out. Note crates, cans or bottles given with goods and taken back.')}</IonNote>
          </IonItem>
        )}
        {(balances ?? []).map((b) => (
          <IonItem key={`${b.partyId}|${b.kind}`}>
            <IonLabel>
              <h3>{b.partyName}</h3>
              <p>
                {b.partyType === 'customer' ? t('Customer') : t('Supplier')}
                {b.deposit ? ` · ${t('deposit {amount}', { amount: rupees(b.deposit) })}` : ''}
              </p>
            </IonLabel>
            <IonNote slot="end" className={b.out > 0 ? 'text-danger' : undefined}>
              {b.out > 0 ? t('{n} {kind} with them', { n: b.out, kind: b.kind }) : t('{n} {kind} of theirs here', { n: -b.out, kind: b.kind })}
            </IonNote>
          </IonItem>
        ))}
      </IonList>
      <div className="ion-padding">
        <FormSection title={t('Note crates')}>
          <IonSegment value={type} onIonChange={(e) => (setType(e.detail.value as typeof type), setPartyId(''))}>
            <IonSegmentButton value="customer">
              <IonLabel>{t('Customer')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="supplier">
              <IonLabel>{t('Supplier')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
          <SelectField label={type === 'customer' ? t('Customer') : t('Supplier')} value={partyId} options={[{ value: '', label: t('Choose') }, ...parties.map((p) => ({ value: p.id, label: p.name }))]} onChange={setPartyId} />
          <TextField label={t('What (crate, can, bottle, tray)')} value={kind} onChange={setKind} />
          <div className="field-row">
            <NumberField label={type === 'customer' ? t('Given to them') : t('Taken from them')} value={out} onChange={setOut} min={0} />
            <NumberField label={type === 'customer' ? t('Got back') : t('Returned to them')} value={back} onChange={setBack} min={0} />
          </div>
          <MoneyField label={type === 'customer' ? t('Deposit taken (optional)') : t('Deposit paid (optional)')} value={deposit} onChange={setDeposit} />
          <IonButton
            expand="block"
            disabled={!partyId}
            onClick={async () => {
              try {
                const p = parties.find((x) => x.id === partyId)!;
                // From the shop's side: crates "out" are ours with the party.
                const ours = type === 'customer';
                await saveCrates(actor, { partyType: type, partyId, partyName: p.name, kind, date: todayISO(), out: ours ? (out ?? 0) : (back ?? 0), back: ours ? (back ?? 0) : (out ?? 0), deposit: (ours ? 1 : -1) * (deposit ?? 0) });
                setOut(null);
                setBack(null);
                setDeposit(null);
                void toast({ message: t('Saved'), duration: 1200, position: 'top', color: 'success' });
              } catch (e) {
                void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
              }
            }}
          >
            <IonIcon icon={addOutline} slot="start" /> {t('Save')}
          </IonButton>
        </FormSection>
      </div>
    </PageShell>
  );
}
