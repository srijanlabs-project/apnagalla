import { IonButton, IonChip, IonIcon, IonInput, IonLabel } from '@ionic/react';
import { closeCircle } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import type { BusinessSettings } from '../../lib/db';
import { effectiveGstType, formatDocNumber, putRecord } from '../../lib/repo';
import { useForm } from '../../lib/useForm';
import { checkNumberPattern, todayISO, type NumberSeries } from '@invoice/shared';
import { sync } from '../../lib/sync';

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
          <IonInput fill="outline" placeholder={p.placeholder} value={text} onIonInput={sync((e) => setText(String(e.detail.value ?? '')))} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <IonButton size="small" fill="outline" onClick={add} disabled={!text.trim()}>
            Add
          </IonButton>
        </div>
      )}
    </div>
  );
}

const PATTERNS = [
  { value: '{PREFIX}/{FY}/{SEQ}', label: 'INV/26-27/0001' },
  { value: '{PREFIX}-{FY}-{SEQ}', label: 'INV-26-27-0001' },
  { value: '{PREFIX}/{FY4}/{SEQ}', label: 'INV/2026-27/0001' },
  { value: '{PREFIX}/{SEQ}', label: 'INV/0001 (never restarts)' },
  { value: '{PREFIX}-{SEQ}', label: 'INV-0001 (never restarts)' },
];

export default function InvoiceSettingsScreen() {
  const { settings, profile, actor, isOwner } = useBusiness();
  const { value: s, patch, setValue, save, saving } = useForm<BusinessSettings>(settings);
  const [customOpen, setCustomOpen] = useState(false);
  if (!s) return null;
  const ro = !isOwner;
  const labels = [0, 1, 2].map((i) => s.customFieldLabels[i] ?? '');
  const prefixOk = (x: string) => /^[A-Za-z0-9-]{1,10}$/.test(x);
  const regular = effectiveGstType(profile) === 'regular';
  const series: { key: NumberSeries; field: 'invoicePrefix' | 'billPrefix' | 'estimatePrefix' | 'creditNotePrefix'; label: string }[] = [
    { key: 'invoice', field: 'invoicePrefix', label: regular ? 'Tax invoice prefix' : 'Invoice prefix' },
    ...(regular ? [{ key: 'bill' as const, field: 'billPrefix' as const, label: 'Bill without GST prefix' }] : []),
    { key: 'credit', field: 'creditNotePrefix', label: 'Credit note prefix' },
    { key: 'estimate', field: 'estimatePrefix', label: 'Estimate prefix' },
  ];
  const prefixes = series.map((x) => s[x.field]);
  const prefixError = prefixes.every(prefixOk) ? (new Set(prefixes).size < prefixes.length ? 'Each series needs a different prefix' : null) : null;
  const patternError = checkNumberPattern(s.numberPattern, prefixes.filter(prefixOk), s.numberDigits, s.resetEachFinancialYear);
  const custom = customOpen || !PATTERNS.some((x) => x.value === s.numberPattern);
  const today = todayISO();

  return (
    <FormPage
      title="Invoice settings"
      backHref="/tabs/more"
      onSave={isOwner ? () => save(() => putRecord('settings', actor, { ...s, customFieldLabels: labels.map((l) => l.trim()).filter(Boolean) }), { message: 'Saved', back: true }) : undefined}
      saving={saving}
      canSave={prefixes.every(prefixOk) && !prefixError && !patternError}
    >
      {ro && <p className="section-note">Only the owner can change these settings.</p>}

      <FormSection title="Numbering" note="GST allows at most 16 characters: letters, digits, - and /. Numbers are never reused.">
        <div className="field-row">
          {series.slice(0, 2).map((x) => (
            <TextField
              key={x.key}
              label={x.label}
              value={s[x.field]}
              onChange={(v) => patch({ [x.field]: v.toUpperCase() })}
              disabled={ro}
              maxlength={10}
              error={prefixOk(s[x.field]) ? null : 'Letters, digits or -'}
            />
          ))}
        </div>
        <div className="field-row">
          {series.slice(2).map((x) => (
            <TextField
              key={x.key}
              label={x.label}
              value={s[x.field]}
              onChange={(v) => patch({ [x.field]: v.toUpperCase() })}
              disabled={ro}
              maxlength={10}
              error={prefixOk(s[x.field]) ? null : 'Letters, digits or -'}
            />
          ))}
        </div>
        <ToggleRow
          label="Restart numbering every financial year (1 April)"
          checked={s.resetEachFinancialYear}
          onChange={(resetEachFinancialYear) =>
            setValue((cur) =>
              cur && {
                ...cur,
                resetEachFinancialYear,
                // Keep the numbers unique: a restarting series needs the year in it.
                numberPattern: resetEachFinancialYear && !/\{FY4?\}/.test(cur.numberPattern) ? '{PREFIX}/{FY}/{SEQ}' : cur.numberPattern,
              },
            )
          }
          disabled={ro}
        />
        <div className="field-row">
          <SelectField
            label="Number style"
            value={custom ? 'custom' : s.numberPattern}
            options={[...PATTERNS.filter((x) => !s.resetEachFinancialYear || x.value.includes('{FY')), { value: 'custom', label: 'Custom…' }]}
            onChange={(v) => {
              setCustomOpen(v === 'custom');
              if (v !== 'custom') patch({ numberPattern: v });
            }}
            disabled={ro}
          />
          <SelectField
            label="Digits"
            value={s.numberDigits}
            options={[3, 4, 5, 6].map((d) => ({ value: d, label: `${d} (${'0'.repeat(d - 1)}1)` }))}
            onChange={(numberDigits) => patch({ numberDigits })}
            disabled={ro}
          />
        </div>
        {custom && (
          <TextField
            label="Custom pattern"
            value={s.numberPattern}
            onChange={(numberPattern) => patch({ numberPattern: numberPattern.trim() })}
            disabled={ro}
            maxlength={40}
            autocapitalize="characters"
            helper="Use {PREFIX}, {FY} (26-27), {FY4} (2026-27), {YYYY} and {SEQ}"
          />
        )}
        {prefixError || patternError ? (
          <p className="section-note text-danger">{prefixError ?? patternError}</p>
        ) : (
          <p className="section-note">
            Next numbers look like {series.map((x) => formatDocNumber(s, x.key, today, 1)).join(' · ')}
          </p>
        )}
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
