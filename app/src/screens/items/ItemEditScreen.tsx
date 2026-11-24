import { IonButton, useIonAlert, useIonRouter } from '@ionic/react';
import { calculateInvoice, checkHsn } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { FormSection, MoneyField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import { db, type BusinessSettings, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { deleteRecord, newId, putRecord, type Actor } from '../../lib/repo';
import { useForm } from '../../lib/useForm';

export function blankItem(actor: Actor, settings: BusinessSettings, name = ''): Item {
  return {
    id: newId(),
    businessId: actor.businessId,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    name,
    unit: settings.units[0] ?? 'pcs',
    rate: 0,
    rateIncludesTax: false,
    taxPct: settings.defaultTaxPct,
  };
}

export function ItemForm({ value: it, onChange: patch, settings, priceLocked }: { value: Item; onChange: (p: Partial<Item>) => void; settings: BusinessSettings; priceLocked?: boolean }) {
  const preview = calculateInvoice({ lines: [{ qty: 1, rate: it.rate, rateIncludesTax: it.rateIncludesTax, taxPct: it.taxPct }], roundOff: false });
  const units = settings.units.includes(it.unit) ? settings.units : [...settings.units, it.unit];
  const rates = settings.taxRates.includes(it.taxPct) ? settings.taxRates : [...settings.taxRates, it.taxPct].sort((a, b) => a - b);
  return (
    <>
      <FormSection>
        <TextField label="Item / service name" required value={it.name} onChange={(name) => patch({ name })} />
        <TextArea label="Description (optional)" value={it.description} onChange={(description) => patch({ description })} />
        <SelectField label="Unit" value={it.unit} options={units.map((u) => ({ value: u, label: u }))} onChange={(unit) => patch({ unit })} />
      </FormSection>
      <FormSection title="Price & tax" note={priceLocked ? 'Only the owner can change prices.' : undefined}>
        <MoneyField label={it.rateIncludesTax ? 'Price (incl. tax)' : 'Price (before tax)'} value={it.rate} onChange={(v) => patch({ rate: v ?? 0 })} disabled={priceLocked} />
        <div className="field-row">
          <SelectField label="Tax %" value={it.taxPct} options={rates.map((r) => ({ value: r, label: `${r}%` }))} onChange={(taxPct) => patch({ taxPct })} disabled={priceLocked} />
          <TextField
            label="HSN / SAC"
            value={it.hsn}
            onChange={(hsn) => patch({ hsn: hsn.replace(/\D/g, '') || undefined })}
            disabled={priceLocked}
            inputmode="numeric"
            maxlength={8}
            error={it.hsn && !checkHsn(it.hsn) ? '4, 6 or 8 digits' : null}
          />
        </div>
        <ToggleRow
          label="Price includes tax"
          note="Turn on for MRP-style prices where the price already contains tax."
          checked={it.rateIncludesTax}
          onChange={(rateIncludesTax) => patch({ rateIncludesTax })}
          disabled={priceLocked}
        />
        {it.rate > 0 && (
          <p className="section-note">
            Before tax {rupees(preview.taxableAmount)} + tax {rupees(preview.taxTotal)} = <strong>{rupees(preview.taxableAmount + preview.taxTotal)}</strong> per {it.unit}
          </p>
        )}
      </FormSection>
    </>
  );
}

export default function ItemEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, settings, isOwner } = useBusiness();
  const isNew = !id || id === 'new';
  const existing = useLiveQuery(() => (isNew ? undefined : db.items.get(id!)), [id]);
  const initial = useMemo(() => (isNew ? blankItem(actor, settings) : existing), [isNew, existing, actor, settings]);
  const { value: it, patch, save, saving } = useForm<Item>(initial);
  const [alert] = useIonAlert();
  const router = useIonRouter();
  if (!it) return null;
  const priceLocked = !isNew && !isOwner;

  return (
    <FormPage
      title={isNew ? 'New item' : 'Edit item'}
      backHref="/tabs/items"
      onSave={isNew || isOwner ? () => save(() => putRecord('items', actor, { ...it, name: it.name.trim() }), { message: 'Item saved', back: true }) : undefined}
      saving={saving}
      canSave={!!it.name.trim()}
    >
      {!isNew && !isOwner && <p className="section-note">Only the owner can edit catalogue items.</p>}
      <ItemForm value={it} onChange={patch} settings={settings} priceLocked={priceLocked} />
      {!isNew && isOwner && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void alert({
              message: `Delete ${it.name}? Existing invoices keep their lines.`,
              buttons: [
                { text: 'Cancel', role: 'cancel' },
                {
                  text: 'Delete',
                  role: 'destructive',
                  handler: async () => {
                    await deleteRecord('items', actor, it.id);
                    router.push('/tabs/items', 'back', 'replace');
                  },
                },
              ],
            })
          }
        >
          Delete item
        </IonButton>
      )}
    </FormPage>
  );
}
