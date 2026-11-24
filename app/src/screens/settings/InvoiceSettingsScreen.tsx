import { IonButton, IonChip, IonIcon, IonInput, IonLabel } from '@ionic/react';
import { closeCircle } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import type { BusinessSettings } from '../../lib/db';
import { formatDocNumber, putRecord } from '../../lib/repo';
import { useForm } from '../../lib/useForm';
import { todayISO } from '@invoice/shared';

export const PAYMENT_TERMS = [
  { value: 0, label: 'Due on receipt' },
  { value: 7, label: 'Net 7 days' },
  { value: 15, label: 'Net 15 days' },
  { value: 30, label: 'Net 30 days' },
  { value: 45, label: 'Net 45 days' },
  { value: 60, label: 'Net 60 days' },
];

/** Editable list of short strings / numbers shown as chips. */
function ChipList<T extends string | number>(p: { values: T[]; onChange: (v: T[]) => void; parse: (s: string) => T | null; placeholder: string; format?: (v: T) => string; disabled?: boolean }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = p.parse(text.trim());
    if (v !== null && !p.values.includes(v)) p.onChange([...p.values, v]);
    setText('');
  };
  return (
    <div className="chip-list">
      {p.values.map((v) => (
        <IonChip key={String(v)} disabled={p.disabled} onClick={() => p.onChange(p.values.filter((x) => x !== v))}>
          <IonLabel>{p.format ? p.format(v) : String(v)}</IonLabel>
          {!p.disabled && <IonIcon icon={closeCircle} />}
        </IonChip>
      ))}
      {!p.disabled && (
        <div className="chip-add">
          <IonInput fill="outline" placeholder={p.placeholder} value={text} onIonInput={(e) => setText(String(e.detail.value ?? ''))} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <IonButton size="small" fill="outline" onClick={add} disabled={!text.trim()}>
            Add
          </IonButton>
        </div>
      )}
    </div>
  );
}

export default function InvoiceSettingsScreen() {
  const { settings, actor, isOwner } = useBusiness();
  const { value: s, patch, save, saving } = useForm<BusinessSettings>(settings);
  if (!s) return null;
  const ro = !isOwner;
  const labels = [0, 1, 2].map((i) => s.customFieldLabels[i] ?? '');
  const prefixOk = (x: string) => /^[A-Za-z0-9-]{1,10}$/.test(x);

  return (
    <FormPage
      title="Invoice settings"
      backHref="/tabs/more"
      onSave={isOwner ? () => save(() => putRecord('settings', actor, { ...s, customFieldLabels: labels.map((l) => l.trim()).filter(Boolean) }), { message: 'Saved', back: true }) : undefined}
      saving={saving}
      canSave={prefixOk(s.invoicePrefix) && prefixOk(s.estimatePrefix)}
    >
      {ro && <p className="section-note">Only the owner can change these settings.</p>}

      <FormSection title="Numbering" note={`Next invoice looks like ${formatDocNumber(s.invoicePrefix || 'INV', todayISO(), 1, s.resetEachFinancialYear)}`}>
        <div className="field-row">
          <TextField
            label="Invoice prefix"
            value={s.invoicePrefix}
            onChange={(v) => patch({ invoicePrefix: v.toUpperCase() })}
            disabled={ro}
            maxlength={10}
            error={prefixOk(s.invoicePrefix) ? null : 'Letters, digits or -'}
          />
          <TextField
            label="Estimate prefix"
            value={s.estimatePrefix}
            onChange={(v) => patch({ estimatePrefix: v.toUpperCase() })}
            disabled={ro}
            maxlength={10}
            error={prefixOk(s.estimatePrefix) ? null : 'Letters, digits or -'}
          />
        </div>
        <ToggleRow label="Restart numbering every financial year (1 April)" checked={s.resetEachFinancialYear} onChange={(resetEachFinancialYear) => patch({ resetEachFinancialYear })} disabled={ro} />
      </FormSection>

      <FormSection title="Defaults for new invoices">
        <SelectField label="Payment terms" value={s.defaultPaymentTermsDays} options={PAYMENT_TERMS} onChange={(defaultPaymentTermsDays) => patch({ defaultPaymentTermsDays })} disabled={ro} />
        <SelectField
          label="Default tax %"
          value={s.defaultTaxPct}
          options={s.taxRates.map((r) => ({ value: r, label: `${r}%` }))}
          onChange={(defaultTaxPct) => patch({ defaultTaxPct })}
          disabled={ro}
        />
        <ToggleRow label="Round off total to nearest ₹1" checked={s.roundOff} onChange={(roundOff) => patch({ roundOff })} disabled={ro} />
        <TextArea label="Default notes" value={s.defaultNotes} onChange={(defaultNotes) => patch({ defaultNotes })} disabled={ro} />
        <TextArea label="Default terms & conditions" value={s.defaultTerms} onChange={(defaultTerms) => patch({ defaultTerms })} disabled={ro} rows={3} />
      </FormSection>

      <FormSection title="Custom fields (up to 3)" note='Extra header fields you fill on each invoice, e.g. "Vehicle No." or "Order ID".'>
        {labels.map((l, i) => (
          <TextField
            key={i}
            label={`Field ${i + 1} label`}
            value={l}
            onChange={(v) => {
              const next = [...labels];
              next[i] = v;
              patch({ customFieldLabels: next });
            }}
            disabled={ro}
            maxlength={30}
          />
        ))}
      </FormSection>

      <FormSection title="Units">
        <ChipList values={s.units} onChange={(units) => patch({ units })} parse={(x) => (x ? x.slice(0, 10) : null)} placeholder="e.g. pack" disabled={ro} />
      </FormSection>

      <FormSection title="Tax rates (%)">
        <ChipList
          values={s.taxRates}
          onChange={(taxRates) => patch({ taxRates: [...taxRates].sort((a, b) => a - b) })}
          parse={(x) => {
            const n = Number(x.replace('%', ''));
            return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
          }}
          format={(v) => `${v}%`}
          placeholder="e.g. 3"
          disabled={ro}
        />
      </FormSection>

      <FormSection title="WhatsApp payment reminder" note="Placeholders: {name} {pending} {number} {date} {business}">
        <TextArea label="Message" value={s.reminderTemplate} onChange={(reminderTemplate) => patch({ reminderTemplate })} disabled={ro} rows={3} />
      </FormSection>
    </FormPage>
  );
}
