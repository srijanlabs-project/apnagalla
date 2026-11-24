import { IonButton, useIonAlert, useIonRouter } from '@ionic/react';
import { normalizeIndianMobile } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { AddressFields, FormSection, MoneyField, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import { db, type Address, type Customer } from '../../lib/db';
import { deleteRecord, newId, putRecord, type Actor } from '../../lib/repo';
import { useForm } from '../../lib/useForm';

export function blankCustomer(actor: Actor, name = ''): Customer {
  return { id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', name, billingAddress: {}, shippingAddress: null, openingBalance: 0 };
}

export function validateCustomer(c: Customer): string | null {
  if (!c.name.trim()) return 'Name is required';
  if (c.phone && !normalizeIndianMobile(c.phone)) return 'Enter a valid 10-digit mobile number (or leave it empty)';
  if (c.email && !/^\S+@\S+\.\S+$/.test(c.email)) return 'Enter a valid email (or leave it empty)';
  return null;
}

/** Saves a customer, normalising the phone number. Shared with the inline "add customer" in the invoice editor. */
export async function saveCustomer(actor: Actor, c: Customer): Promise<Customer> {
  const err = validateCustomer(c);
  if (err) throw new Error(err);
  return putRecord('customers', actor, { ...c, name: c.name.trim(), phone: c.phone ? normalizeIndianMobile(c.phone)! : undefined });
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
        <TextField label="Name" required value={c.name} onChange={(name) => patch({ name })} autocapitalize="words" />
        <TextField
          label="Mobile"
          type="tel"
          inputmode="tel"
          value={c.phone?.replace(/^\+91/, '')}
          onChange={(phone) => patch({ phone })}
          error={c.phone && err?.includes('mobile') ? err : null}
        />
        <TextField label="Email" type="email" inputmode="email" value={c.email} onChange={(email) => patch({ email })} autocapitalize="off" />
        <TextField label="Tax ID (optional)" value={c.taxId} onChange={(taxId) => patch({ taxId: taxId.toUpperCase() })} />
      </FormSection>
      <FormSection title="Billing address">
        <AddressFields value={c.billingAddress} onChange={patchAddress('billingAddress')} />
      </FormSection>
      <FormSection title="Shipping address">
        <ToggleRow
          label="Same as billing address"
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
  const { actor, isOwner } = useBusiness();
  const isNew = !id || id === 'new';
  const existing = useLiveQuery(() => (isNew ? undefined : db.customers.get(id!)), [id]);
  const initial = useMemo(() => (isNew ? blankCustomer(actor) : existing), [isNew, existing, actor]);
  const { value: c, setValue, patch, save, saving } = useForm<Customer>(initial);
  const [alert] = useIonAlert();
  const router = useIonRouter();
  if (!c) return null;

  return (
    <FormPage
      title={isNew ? 'New customer' : 'Edit customer'}
      backHref={isNew ? '/tabs/customers' : `/tabs/customers/${c.id}`}
      onSave={() => save(() => saveCustomer(actor, c), { message: 'Customer saved', back: true })}
      saving={saving}
      canSave={!validateCustomer(c)}
    >
      <CustomerForm value={c} update={(fn) => setValue((v) => v && fn(v))} />
      <FormSection title="Opening balance" note="Amount this customer already owed you before you started using the app. Added to their pending total.">
        <MoneyField label="Opening balance" value={c.openingBalance} onChange={(v) => patch({ openingBalance: v ?? 0 })} disabled={!isOwner && !isNew} />
      </FormSection>
      {!isNew && isOwner && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void alert({
              message: `Delete ${c.name}? Their past invoices are kept.`,
              buttons: [
                { text: 'Cancel', role: 'cancel' },
                {
                  text: 'Delete',
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
          Delete customer
        </IonButton>
      )}
    </FormPage>
  );
}
