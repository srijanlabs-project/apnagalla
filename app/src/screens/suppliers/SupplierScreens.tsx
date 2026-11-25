import { IonButton, IonCard, IonCardContent, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSearchbar, useIonAlert, useIonRouter, useIonToast } from '@ionic/react';
import { checkGstin, formatIndianMobile, normalizeIndianMobile, stateName } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, callOutline, cartOutline, cashOutline, clipboardOutline, createOutline, logoWhatsapp, storefrontOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { AddressFields, FormSection, MoneyField, TextArea, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import GstinCheck from '../../components/GstinCheck';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Supplier } from '../../lib/db';
import { addressLines, dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { modeLabel } from '../../lib/ledger';
import { blankSupplier, payables, recordSupplierPayment, supplierLedger, voidSupplierPayment } from '../../lib/purchases';
import { deleteRecord, putRecord } from '../../lib/repo';
import { useForm } from '../../lib/useForm';
import { gstinProblemText } from '../customers/CustomerEditScreen';

/** Owner, or staff when the store lets staff see purchase prices. */
export function useCanBuy(): boolean {
  const { isOwner, settings } = useBusiness();
  return isOwner || settings.staffSeeCost;
}

export function NoAccess() {
  return (
    <PageShell title={t('Purchases')} backHref="/tabs/more">
      <p>{t('Only the owner handles purchases in this store.')}</p>
    </PageShell>
  );
}

export function SuppliersScreen() {
  const { actor, isOwner } = useBusiness();
  const canBuy = useCanBuy();
  const [q, setQ] = useState('');
  const suppliers = useLiveQuery(() => db.suppliers.where('businessId').equals(actor.businessId).filter((s) => !s.deleted).toArray(), [actor.businessId]);
  const owed = useLiveQuery(() => payables(actor.businessId), [actor.businessId]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (suppliers ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.phone?.includes(s)).sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, q]);
  if (!canBuy) return <NoAccess />;
  const total = [...(owed?.values() ?? [])].reduce((a, v) => a + v, 0);

  return (
    <PageShell title={t('Suppliers')} backHref="/tabs/more" padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name or mobile')} />
      {isOwner && (
        <div className="filter-chips">
          <IonButton size="small" fill="clear" routerLink="/tabs/items/import?kind=suppliers">
            {t('Import')}
          </IonButton>
        </div>
      )}
      {total !== 0 && (
        <p className="section-note ion-padding-horizontal">
          {t('You owe suppliers {amount} in all', { amount: rupees(total) })}
        </p>
      )}
      {suppliers && suppliers.length === 0 ? (
        <EmptyState icon={storefrontOutline} title={t('No suppliers yet')} text={t('Add the wholesalers and companies you buy from, to track bills and what you owe them.')} />
      ) : (
        <IonList>
          {list.map((s) => {
            const bal = owed?.get(s.id) ?? 0;
            return (
              <IonItem key={s.id} routerLink={`/tabs/suppliers/${s.id}`} detail={false}>
                <IonLabel>
                  <h2>{s.name}</h2>
                  <p>{[s.phone ? formatIndianMobile(s.phone) : '', s.address.city].filter(Boolean).join(' · ')}</p>
                </IonLabel>
                {bal !== 0 && (
                  <IonNote slot="end" className={bal > 0 ? 'amount-note text-danger' : 'amount-note'}>
                    {rupees(Math.abs(bal))}
                    <small>{bal > 0 ? t('to pay') : t('advance')}</small>
                  </IonNote>
                )}
              </IonItem>
            );
          })}
        </IonList>
      )}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink="/tabs/suppliers/new" aria-label={t('Add supplier')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}

function supplierProblem(s: Supplier): string | null {
  if (!s.name.trim()) return t('Name is required');
  if (s.phone && !normalizeIndianMobile(s.phone)) return t('Enter a valid 10-digit mobile number (or leave it empty)');
  if (s.taxId) {
    const g = checkGstin(s.taxId);
    if (!g.ok) return gstinProblemText(g.problem, s.taxId);
  }
  return null;
}

export function SupplierEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const canBuy = useCanBuy();
  const isNew = !id || id === 'new';
  const existing = useLiveQuery(() => (isNew ? undefined : db.suppliers.get(id!)), [id]);
  const initial = useMemo(() => (isNew ? blankSupplier(actor) : existing), [isNew, existing, actor]);
  const { value: s, setValue, patch, save, saving } = useForm<Supplier>(initial);
  const [alert] = useIonAlert();
  const router = useIonRouter();
  if (!canBuy) return <NoAccess />;
  if (!s) return null;
  const problem = supplierProblem(s);

  return (
    <FormPage
      title={isNew ? t('New supplier') : t('Edit supplier')}
      backHref="/tabs/suppliers"
      saving={saving}
      canSave={!problem}
      onSave={() =>
        save(() => putRecord('suppliers', actor, { ...s, name: s.name.trim(), phone: s.phone ? normalizeIndianMobile(s.phone)! : undefined, taxId: s.taxId?.trim() || undefined }), {
          message: t('Supplier saved'),
          back: true,
        })
      }
    >
      <FormSection>
        <TextField label={t('Name')} required value={s.name} onChange={(name) => patch({ name })} autocapitalize="words" />
        <TextField label={t('Mobile')} type="tel" inputmode="tel" value={s.phone?.replace(/^\+91/, '')} onChange={(phone) => patch({ phone })} />
        <TextField
          label={t('GSTIN (if registered)')}
          value={s.taxId}
          maxlength={15}
          autocapitalize="characters"
          onChange={(v) => {
            const gstin = v.toUpperCase().trim();
            const g = checkGstin(gstin);
            setValue((cur) => cur && { ...cur, taxId: gstin, address: g.ok && !cur.address.state ? { ...cur.address, state: stateName(g.stateCode) } : cur.address });
          }}
          error={s.taxId && problem && problem !== t('Name is required') ? problem : null}
        />
        <GstinCheck
          businessId={s.businessId}
          gstin={s.taxId}
          onUse={(info) => setValue((cur) => cur && { ...cur, name: info.tradeName || info.legalName, address: { ...cur.address, ...Object.fromEntries(Object.entries(info.address ?? {}).filter(([, v]) => v)) } })}
        />
      </FormSection>
      <FormSection title={t('Address')}>
        <AddressFields value={s.address} onChange={(a) => setValue((cur) => cur && { ...cur, address: { ...cur.address, ...a } })} />
      </FormSection>
      <FormSection title={t('Opening balance')} note={t('What you already owed this supplier before using ApnaGalla.')}>
        <MoneyField label={t('Amount you owe')} value={s.openingBalance || null} onChange={(v) => patch({ openingBalance: v ?? 0 })} disabled={!isNew && !isOwner} />
        <TextArea label={t('Notes')} value={s.notes} onChange={(notes) => patch({ notes })} />
      </FormSection>
      {!isNew && isOwner && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void alert({
              message: t('Delete {name}? Their bills stay.', { name: s.name }),
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                {
                  text: t('Delete'),
                  role: 'destructive',
                  handler: async () => {
                    await deleteRecord('suppliers', actor, s.id);
                    router.push('/tabs/suppliers', 'back', 'replace');
                  },
                },
              ],
            })
          }
        >
          {t('Delete supplier')}
        </IonButton>
      )}
    </FormPage>
  );
}

export function SupplierDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const canBuy = useCanBuy();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [paying, setPaying] = useState(false);
  const s = useLiveQuery(() => db.suppliers.get(id!), [id]);
  const ledger = useLiveQuery(() => supplierLedger(actor.businessId, id!), [actor.businessId, id]);
  if (!canBuy) return <NoAccess />;
  if (!s || !ledger) return null;
  const rows = [...ledger.rows].reverse();

  return (
    <PageShell title={s.name} backHref="/tabs/suppliers" padded={false}>
      <IonCard>
        <IonCardContent>
          {s.phone && <p>{formatIndianMobile(s.phone)}</p>}
          {s.taxId && <p>GSTIN {s.taxId}</p>}
          {addressLines(s.address).map((l) => (
            <p key={l}>{l}</p>
          ))}
          <div className="detail-actions">
            {s.phone && (
              <>
                <IonButton size="small" fill="outline" href={`tel:${s.phone}`}>
                  <IonIcon icon={callOutline} slot="start" /> {t('Call')}
                </IonButton>
                <IonButton size="small" fill="outline" href={`https://wa.me/${s.phone.replace('+', '')}`} target="_blank">
                  <IonIcon icon={logoWhatsapp} slot="start" /> WhatsApp
                </IonButton>
              </>
            )}
            <IonButton size="small" fill="outline" routerLink={`/tabs/suppliers/${s.id}/edit`}>
              <IonIcon icon={createOutline} slot="start" /> {t('Edit')}
            </IonButton>
          </div>
        </IonCardContent>
      </IonCard>

      <div className="stat-grid">
        <div className="mini-stat">
          <span>{ledger.balance >= 0 ? t('You owe') : t('Advance with supplier')}</span>
          <strong className={ledger.balance > 0 ? 'text-danger' : ''}>{rupees(Math.abs(ledger.balance))}</strong>
        </div>
      </div>

      <div className="detail-actions ion-padding-horizontal">
        <IonButton onClick={() => setPaying(true)}>
          <IonIcon icon={cashOutline} slot="start" /> {t('Pay')}
        </IonButton>
        <IonButton fill="outline" routerLink={`/tabs/purchases/new?supplier=${s.id}`}>
          <IonIcon icon={cartOutline} slot="start" /> {t('Purchase bill')}
        </IonButton>
        <IonButton fill="outline" routerLink={`/tabs/purchase-orders/new?supplier=${s.id}`}>
          <IonIcon icon={clipboardOutline} slot="start" /> {t('Order')}
        </IonButton>
      </div>

      <IonList inset>
        <IonListHeader>
          <IonLabel>{t('Account')}</IonLabel>
        </IonListHeader>
        {rows.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Nothing recorded yet.')}</IonNote>
          </IonItem>
        )}
        {rows.map((r, i) => (
          <IonItem key={i} routerLink={r.href} detail={false}>
            <IonLabel>
              <h3>{r.label}</h3>
              <p>
                {dateIN(r.date)}
                {r.payment ? ` · ${modeLabel(r.payment.mode)}${r.payment.reference ? ` · ${r.payment.reference}` : ''}` : ''}
              </p>
            </IonLabel>
            <div slot="end" className="list-end">
              <strong className={r.amount > 0 ? 'text-danger' : 'text-success'}>{rupees(Math.abs(r.amount))}</strong>
              <IonNote className="ledger-balance">{t('Balance {amount}', { amount: rupees(r.balance) })}</IonNote>
              {isOwner && r.payment && (
                <IonButton
                  size="small"
                  fill="clear"
                  color="danger"
                  onClick={() =>
                    void alert({
                      header: t('Void this payment?'),
                      inputs: [{ name: 'reason', placeholder: t('Reason') }],
                      buttons: [
                        { text: t('Cancel'), role: 'cancel' },
                        { text: t('Void'), role: 'destructive', handler: (v: { reason?: string }) => void voidSupplierPayment(actor, r.payment!.id, v.reason ?? '') },
                      ],
                    })
                  }
                >
                  {t('Void')}
                </IonButton>
              )}
            </div>
          </IonItem>
        ))}
      </IonList>

      <MoneyEntrySheet
        isOpen={paying}
        onClose={() => setPaying(false)}
        title={t('Pay {name}', { name: s.name })}
        amount={Math.max(0, ledger.balance)}
        onSave={async (e) => {
          await recordSupplierPayment(actor, { supplierId: s.id, ...e });
          void toast({ message: t('Payment saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      />
    </PageShell>
  );
}
