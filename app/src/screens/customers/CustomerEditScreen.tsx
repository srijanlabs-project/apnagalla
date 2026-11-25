import { IonButton, useIonAlert, useIonRouter } from '@ionic/react';
import { checkGstin, normalizeIndianMobile, stateName, type GstinProblem } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AddressFields, FormSection, MoneyField, SelectField, TextField, ToggleRow } from '../../components/Fields';
import { levelLabel } from '../../lib/pricing';
import FormPage from '../../components/FormPage';
import GstinCheck from '../../components/GstinCheck';
import { useBusiness } from '../../lib/business';
import { db, type Address, type Customer } from '../../lib/db';
import { t } from '../../lib/i18n';
import { deleteRecord, newId, putRecord, type Actor } from '../../lib/repo';
import { useForm } from '../../lib/useForm';

export function blankCustomer(actor: Actor, name = ''): Customer {
  return { id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', name, billingAddress: {}, shippingAddress: null, openingBalance: 0 };
}

// Compared by value in CustomerForm to show each message under the right field (any language).
const nameRequired = () => t('Name is required');
const badMobile = () => t('Enter a valid 10-digit mobile number (or leave it empty)');
const badEmail = () => t('Enter a valid email (or leave it empty)');

/** checkGstin's message (English, from shared) in the app's language. */
export function gstinProblemText(problem: GstinProblem, gstin: string): string {
  if (problem === 'format') return t('A GSTIN has 15 characters, like 24ABCDE1234F1Z5');
  if (problem === 'state') return t('{code} is not a GST state code', { code: gstin.trim().toUpperCase().slice(0, 2) });
  return t('This GSTIN has a typo (the last character does not match)');
}

export function validateCustomer(c: Customer): string | null {
  if (!c.name.trim()) return nameRequired();
  if (c.phone && !normalizeIndianMobile(c.phone)) return badMobile();
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return badEmail();
  if (c.taxId) {
    const g = checkGstin(c.taxId);
    if (!g.ok) return gstinProblemText(g.problem, c.taxId);
  }
  return null;
}

/** Saves a customer, normalising the phone number. Shared with the inline "add customer" in the invoice editor. */
export async function saveCustomer(actor: Actor, c: Customer): Promise<Customer> {
  const err = validateCustomer(c);
  if (err) throw new Error(err);
  return putRecord('customers', actor, { ...c, name: c.name.trim(), phone: c.phone ? normalizeIndianMobile(c.phone)! : undefined, taxId: c.taxId?.trim() || undefined });
}

/** `update` must apply the function to the parent's latest state (functional setState). */
export function CustomerForm({ value: c, update }: { value: Customer; update: (fn: (c: Customer) => Customer) => void }) {
  const err = validateCustomer(c);
  const patch = (p: Partial<Customer>) => update((cur) => ({ ...cur, ...p }));
  const patchAddress = (key: 'billingAddress' | 'shippingAddress') => (a: Partial<Address>) =>
    update((cur) => ({ ...cur, [key]: { ...cur[key], ...a } }));
  return (
    <>
      <FormSection>
        <TextField label={t('Name')} required value={c.name} onChange={(name) => patch({ name })} autocapitalize="words" />
        <TextField
          label={t('Mobile')}
          type="tel"
          inputmode="tel"
          value={c.phone?.replace(/^\+91/, '')}
          onChange={(phone) => patch({ phone })}
          error={c.phone && err === badMobile() ? err : null}
        />
        <TextField label={t('Email')} type="email" inputmode="email" value={c.email} onChange={(email) => patch({ email })} autocapitalize="off" />
        <TextField
          label={t('GSTIN (if registered)')}
          value={c.taxId}
          maxlength={15}
          autocapitalize="characters"
          onChange={(taxId) => {
            const gstin = taxId.toUpperCase().trim();
            const g = checkGstin(gstin);
            // A valid GSTIN tells us the state: fill it in if the address has none yet.
            update((cur) => ({
              ...cur,
              taxId: gstin,
              billingAddress: g.ok && !cur.billingAddress.state ? { ...cur.billingAddress, state: stateName(g.stateCode) } : cur.billingAddress,
            }));
          }}
          error={c.taxId && err && err !== badMobile() && err !== badEmail() && err !== nameRequired() ? err : null}
        />
        <GstinCheck
          businessId={c.businessId}
          gstin={c.taxId}
          onUse={(info) =>
            update((cur) => ({
              ...cur,
              name: info.tradeName || info.legalName,
              billingAddress: { ...cur.billingAddress, ...Object.fromEntries(Object.entries(info.address ?? {}).filter(([, v]) => v)) },
            }))
          }
        />
      </FormSection>
      <FormSection title={t('Billing address')}>
        <AddressFields value={c.billingAddress} onChange={patchAddress('billingAddress')} />
      </FormSection>
      <FormSection title={t('Shipping address')}>
        <ToggleRow
          label={t('Same as billing address')}
          checked={!c.shippingAddress}
          onChange={(same) => update((cur) => ({ ...cur, shippingAddress: same ? null : { ...cur.billingAddress } }))}
        />
        {c.shippingAddress && <AddressFields value={c.shippingAddress} onChange={patchAddress('shippingAddress')} />}
      </FormSection>
    </>
  );
}

export default function CustomerEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner, perms } = useBusiness();
  const isNew = !id || id === 'new';
  const existing = useLiveQuery(() => (isNew ? undefined : db.customers.get(id!)), [id]);
  const initial = useMemo(() => (isNew ? blankCustomer(actor) : existing), [isNew, existing, actor]);
  const { value: c, setValue, patch, save, saving } = useForm<Customer>(initial);
  const [alert] = useIonAlert();
  const router = useIonRouter();
  if (!c) return null;

  return (
    <FormPage
      title={isNew ? t('New customer') : t('Edit customer')}
      backHref={isNew ? '/tabs/customers' : `/tabs/customers/${c.id}`}
      onSave={() => save(() => saveCustomer(actor, c), { message: t('Customer saved'), back: true })}
      saving={saving}
      canSave={!validateCustomer(c)}
    >
      <CustomerForm value={c} update={(fn) => setValue((v) => v && fn(v))} />
      <FormSection title={t('Opening balance')} note={t('Amount this customer already owed you before you started using the app. Added to their pending total.')}>
        <MoneyField label={t('Opening balance')} value={c.openingBalance} onChange={(v) => patch({ openingBalance: v ?? 0 })} disabled={!isOwner && !isNew} />
      </FormSection>
      <FormSection title={t('Customer type')} note={t('Wholesale and special customers get the items’ wholesale or special prices.')}>
        <SelectField
          label={t('Customer type')}
          value={c.priceLevel ?? 'retail'}
          options={(['retail', 'wholesale', 'special'] as const).map((value) => ({ value, label: levelLabel(value) }))}
          onChange={(priceLevel) => patch({ priceLevel })}
          disabled={!isOwner && !isNew}
        />
      </FormSection>
      <FormSection title={t('Credit limit')} note={t('Warns before billing on credit beyond this amount. Leave empty for no limit.')}>
        <MoneyField label={t('Credit limit')} value={c.creditLimit ?? null} onChange={(v) => patch({ creditLimit: v || null })} disabled={!isOwner} />
      </FormSection>
      {!isNew && perms.deleteRecords && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void alert({
              message: t('Delete {customer}? Their past invoices are kept.', { customer: c.name }),
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                {
                  text: t('Delete'),
                  role: 'destructive',
                  handler: async () => {
                    await deleteRecord('customers', actor, c.id);
                    router.push('/tabs/customers', 'back', 'replace');
                  },
                },
              ],
            })
          }
        >
          {t('Delete customer')}
        </IonButton>
      )}
    </FormPage>
  );
}
