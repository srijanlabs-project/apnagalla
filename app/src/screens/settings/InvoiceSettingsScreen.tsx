import { IonButton, IonChip, IonIcon, IonInput, IonLabel } from '@ionic/react';
import { closeCircle } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import type { BusinessSettings } from '../../lib/db';
import { t } from '../../lib/i18n';
import { effectiveGstType, formatDocNumber, putRecord } from '../../lib/repo';
import { useForm } from '../../lib/useForm';
import { LANGS, LANG_NAMES, checkNumberPattern, todayISO, type NumberSeries } from '@invoice/shared';
import { sync } from '../../lib/sync';

export const PAYMENT_TERMS = [
  { value: 0, label: 'Due on receipt' },
  { value: 7, label: 'Net 7 days' },
  { value: 15, label: 'Net 15 days' },
  { value: 30, label: 'Net 30 days' },
  { value: 45, label: 'Net 45 days' },
  { value: 60, label: 'Net 60 days' },
];
// i18n: labels above are translated where rendered

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
            {t('Add')}
          </IonButton>
        </div>
      )}
    </div>
  );
}

/** Styles offered; the letter part only shows on staff numbers when each person has a series. */
const PATTERNS = [
  { value: '{PREFIX}-{CODE}/{FY}/{SEQ}', label: 'INV/26-27/0001', staff: 'INV-B/26-27/0001' },
  { value: '{PREFIX}{CODE}/{FY}/{SEQ}', label: 'INV/26-27/0001', staff: 'INVB/26-27/0001' },
  { value: '{PREFIX}-{CODE}-{FY}-{SEQ}', label: 'INV-26-27-0001', staff: 'INV-B-26-27-0001' },
  { value: '{PREFIX}-{CODE}/{FY4}/{SEQ}', label: 'INV/2026-27/0001', staff: 'INV-B/2026-27/0001' },
  { value: '{PREFIX}-{CODE}/{SEQ}', label: 'INV/0001 (never restarts)', staff: 'INV-B/0001' },
];
// i18n: labels above are translated where rendered

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
    { key: 'invoice', field: 'invoicePrefix', label: regular ? t('Tax invoice prefix') : t('Invoice prefix') },
    ...(regular ? [{ key: 'bill' as const, field: 'billPrefix' as const, label: t('Bill without GST prefix') }] : []),
    { key: 'credit', field: 'creditNotePrefix', label: t('Credit note prefix') },
    { key: 'estimate', field: 'estimatePrefix', label: t('Estimate prefix') },
  ];
  const prefixes = series.map((x) => s[x.field]);
  const prefixError = prefixes.every(prefixOk) ? (new Set(prefixes).size < prefixes.length ? t('Each series needs a different prefix') : null) : null;
  const perPerson = s.numberingMode !== 'shared';
  const patternError = checkNumberPattern(s.numberPattern, prefixes.filter(prefixOk), s.numberDigits, s.resetEachFinancialYear, s.numberingMode);
  const custom = customOpen || !PATTERNS.some((x) => x.value === s.numberPattern);
  // Only offer styles that fit the GST limits with the current prefixes and digits.
  const styles = PATTERNS.filter(
    (x) => x.value === s.numberPattern || !checkNumberPattern(x.value, prefixes.filter(prefixOk), s.numberDigits, s.resetEachFinancialYear, s.numberingMode),
  );
  const today = todayISO();

  return (
    <FormPage
      title={t('Invoice settings')}
      backHref="/tabs/more"
      onSave={isOwner ? () => save(() => putRecord('settings', actor, { ...s, customFieldLabels: labels.map((l) => l.trim()).filter(Boolean) }), { message: t('Saved'), back: true }) : undefined}
      saving={saving}
      canSave={prefixes.every(prefixOk) && !prefixError && !patternError}
    >
      {ro && <p className="section-note">{t('Only the owner can change these settings.')}</p>}

      <FormSection title={t('Numbering')} note={t('GST allows at most 16 characters: letters, digits, - and /. Numbers are never reused.')}>
        <SelectField
          label={t('Who shares a number series')}
          value={s.numberingMode}
          options={[
            { value: 'perPerson', label: t('Each person has their own series (works offline)') },
            { value: 'shared', label: t('One series for everyone') },
          ]}
          onChange={(numberingMode) => patch({ numberingMode })}
          disabled={ro}
        />
        <p className="section-note">
          {perPerson
            ? t("Your numbers have no letter; each staff member's numbers carry their letter (see Team). Phones never run out of numbers offline.")
            : t('Every phone keeps a block of numbers sized to how much it bills, and gives unused ones back on logout. Best switched on 1 April.')}
        </p>
        <div className="field-row">
          {series.slice(0, 2).map((x) => (
            <TextField
              key={x.key}
              label={x.label}
              value={s[x.field]}
              onChange={(v) => patch({ [x.field]: v.toUpperCase() })}
              disabled={ro}
              maxlength={10}
              error={prefixOk(s[x.field]) ? null : t('Letters, digits or -')}
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
              error={prefixOk(s[x.field]) ? null : t('Letters, digits or -')}
            />
          ))}
        </div>
        <ToggleRow
          label={t('Restart numbering every financial year (1 April)')}
          checked={s.resetEachFinancialYear}
          onChange={(resetEachFinancialYear) =>
            setValue((cur) =>
              cur && {
                ...cur,
                resetEachFinancialYear,
                // Keep the numbers unique: a restarting series needs the year in it.
                numberPattern: resetEachFinancialYear && !/\{FY4?\}/.test(cur.numberPattern) ? '{PREFIX}-{CODE}/{FY}/{SEQ}' : cur.numberPattern,
              },
            )
          }
          disabled={ro}
        />
        <div className="field-row">
          <SelectField
            label={t('Number style')}
            value={custom ? 'custom' : s.numberPattern}
            options={[...styles.map((x) => ({ value: x.value, label: perPerson ? t('{example} · staff {staffExample}', { example: t(x.label), staffExample: x.staff }) : t(x.label) })), { value: 'custom', label: t('Custom…') }]}
            onChange={(v) => {
              setCustomOpen(v === 'custom');
              if (v !== 'custom') patch({ numberPattern: v });
            }}
            disabled={ro}
          />
          <SelectField
            label={t('Digits')}
            value={s.numberDigits}
            options={[3, 4, 5, 6].map((d) => ({ value: d, label: `${d} (${'0'.repeat(d - 1)}1)` }))}
            onChange={(numberDigits) => patch({ numberDigits })}
            disabled={ro}
          />
        </div>
        {custom && (
          <TextField
            label={t('Custom pattern')}
            value={s.numberPattern}
            onChange={(numberPattern) => patch({ numberPattern: numberPattern.trim() })}
            disabled={ro}
            maxlength={40}
            autocapitalize="characters"
            helper={t('Use {PREFIX}, {CODE} (staff letter), {FY} (26-27), {FY4} (2026-27), {YYYY} and {SEQ}')}
          />
        )}
        {prefixError || patternError ? (
          <p className="section-note text-danger">{prefixError ?? patternError}</p>
        ) : (
          <p className="section-note">
            {perPerson
              ? t('Next numbers look like {examples} — staff B: {staffExamples}', {
                  examples: series.map((x) => formatDocNumber(s, x.key, today, 1)).join(' · '),
                  staffExamples: series.filter((x) => x.key !== 'estimate').map((x) => formatDocNumber(s, x.key, today, 1, 'B')).join(' · '),
                })
              : t('Next numbers look like {examples}', { examples: series.map((x) => formatDocNumber(s, x.key, today, 1)).join(' · ') })}
          </p>
        )}
      </FormSection>

      <FormSection title={t('Defaults for new invoices')}>
        <SelectField label={t('Payment terms')} value={s.defaultPaymentTermsDays} options={PAYMENT_TERMS.map((x) => ({ ...x, label: t(x.label) }))} onChange={(defaultPaymentTermsDays) => patch({ defaultPaymentTermsDays })} disabled={ro} />
        <SelectField
          label={t('Default tax %')}
          value={s.defaultTaxPct}
          options={s.taxRates.map((r) => ({ value: r, label: `${r}%` }))}
          onChange={(defaultTaxPct) => patch({ defaultTaxPct })}
          disabled={ro}
        />
        <ToggleRow label={t('Round off total to nearest ₹1')} checked={s.roundOff} onChange={(roundOff) => patch({ roundOff })} disabled={ro} />
        <TextArea label={t('Default notes')} value={s.defaultNotes} onChange={(defaultNotes) => patch({ defaultNotes })} disabled={ro} />
        <TextArea label={t('Default terms & conditions')} value={s.defaultTerms} onChange={(defaultTerms) => patch({ defaultTerms })} disabled={ro} rows={3} />
      </FormSection>

      <FormSection title={t('Custom fields (up to 3)')} note={t('Extra header fields you fill on each invoice, e.g. "Vehicle No." or "Order ID".')}>
        {labels.map((l, i) => (
          <TextField
            key={i}
            label={t('Field {number} label', { number: i + 1 })}
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

      <FormSection title={t('Delivery alert')} note={t('Phone alert the day before a delivery date, to the owner and the person delivering.')}>
        <label className="date-field">
          <span>{t('Alert time (day before)')}</span>
          <input type="time" value={s.deliveryAlertTime} disabled={ro} onChange={(e) => e.target.value && patch({ deliveryAlertTime: e.target.value })} />
        </label>
      </FormSection>

      <FormSection title={t('Printed receipts')} note={t('Thermal receipts print in this language. PDFs stay in English for now.')}>
        <SelectField
          label={t('Receipt language')}
          value={s.billLanguage}
          options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
          onChange={(billLanguage) => patch({ billLanguage })}
          disabled={ro}
        />
      </FormSection>

      <FormSection title={t('Staff')}>
        <ToggleRow
          label={t('Staff can see purchase prices')}
          note={t('Off: cost prices never reach staff phones.')}
          checked={s.staffSeeCost}
          onChange={(staffSeeCost) => patch({ staffSeeCost })}
          disabled={ro}
        />
      </FormSection>

      <FormSection title={t('Shop features')}>
        <ToggleRow
          label={t('Area / job-work billing')}
          note={t('Price items per sq ft or running foot and enter sizes on the bill (painting, glass, acrylic, carpentry, flex).')}
          checked={s.areaBilling}
          onChange={(areaBilling) => patch({ areaBilling })}
          disabled={ro}
        />
      </FormSection>

      <FormSection title={t('Units')}>
        <ChipList values={s.units} onChange={(units) => patch({ units })} parse={(x) => (x ? x.slice(0, 10) : null)} placeholder={t('e.g. pack')} disabled={ro} />
      </FormSection>

      <FormSection title={t('Tax rates (%)')}>
        <ChipList
          values={s.taxRates}
          onChange={(taxRates) => patch({ taxRates: [...taxRates].sort((a, b) => a - b) })}
          parse={(x) => {
            const n = Number(x.replace('%', ''));
            return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
          }}
          format={(v) => `${v}%`}
          placeholder={t('e.g. 3')}
          disabled={ro}
        />
      </FormSection>

      <FormSection title={t('WhatsApp payment reminder')} note={t('Placeholders: {name} {pending} {number} {date} {business}')}>
        <TextArea label={t('Message')} value={s.reminderTemplate} onChange={(reminderTemplate) => patch({ reminderTemplate })} disabled={ro} rows={3} />
      </FormSection>
    </FormPage>
  );
}
