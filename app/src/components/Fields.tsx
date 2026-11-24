import { IonInput, IonItem, IonLabel, IonSelect, IonSelectOption, IonTextarea, IonToggle } from '@ionic/react';
import { paiseToInput, parseRupees } from '@invoice/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Address } from '../lib/db';
import { INDIAN_STATES } from '../lib/format';
import { sync } from '../lib/sync';

interface TextProps {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  type?: 'text' | 'tel' | 'email' | 'url' | 'number';
  inputmode?: 'text' | 'tel' | 'email' | 'url' | 'numeric' | 'decimal';
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  helper?: string;
  error?: string | null;
  autocapitalize?: string;
  maxlength?: number;
}

export function TextField(p: TextProps) {
  return (
    <IonInput
      fill="outline"
      labelPlacement="floating"
      label={p.required ? `${p.label} *` : p.label}
      value={p.value ?? ''}
      type={p.type ?? 'text'}
      inputmode={p.inputmode}
      placeholder={p.placeholder}
      disabled={p.disabled}
      helperText={p.helper}
      errorText={p.error ?? undefined}
      className={p.error ? 'field ion-invalid ion-touched' : 'field'}
      autocapitalize={p.autocapitalize ?? 'sentences'}
      maxlength={p.maxlength}
      onIonInput={sync((e) => p.onChange(String(e.detail.value ?? '')))}
    />
  );
}

export function TextArea(p: { label: string; value: string | undefined; onChange: (v: string) => void; disabled?: boolean; rows?: number; helper?: string }) {
  return (
    <IonTextarea
      className="field"
      fill="outline"
      labelPlacement="floating"
      label={p.label}
      value={p.value ?? ''}
      autoGrow
      rows={p.rows ?? 2}
      disabled={p.disabled}
      helperText={p.helper}
      autocapitalize="sentences"
      onIonInput={sync((e) => p.onChange(String(e.detail.value ?? '')))}
    />
  );
}

/**
 * Rupee input that keeps its own text while typing and reports paise (or null when invalid/empty).
 */
export function MoneyField(p: { label: string; value: number | null | undefined; onChange: (paise: number | null) => void; disabled?: boolean; helper?: string; required?: boolean }) {
  const [text, setText] = useState(p.value == null ? '' : paiseToInput(p.value));
  const [invalid, setInvalid] = useState(false);
  const reported = useRef<number | null | undefined>(p.value);
  // Follow outside changes (e.g. a reset or "Set final amount") without clobbering what the user
  // is typing. Skip values we just reported ourselves; parents may store an emptied field as 0.
  useEffect(() => {
    const mine = p.value === reported.current || (reported.current === null && (p.value == null || p.value === 0));
    if (!mine) setText(p.value == null ? '' : paiseToInput(p.value));
    reported.current = p.value;
  }, [p.value]);
  return (
    <IonInput
      className={invalid ? 'field ion-invalid ion-touched' : 'field'}
      fill="outline"
      labelPlacement="floating"
      label={p.required ? `${p.label} *` : p.label}
      inputmode="decimal"
      value={text}
      disabled={p.disabled}
      helperText={p.helper}
      errorText="Enter an amount like 1250 or 1250.50"
      onIonInput={sync((e) => {
        const t = String(e.detail.value ?? '');
        setText(t);
        const v = parseRupees(t);
        setInvalid(t.trim() !== '' && v === null);
        reported.current = t.trim() === '' ? null : v;
        p.onChange(reported.current);
      })}
    >
      <span slot="start" className="rupee-prefix">
        ₹
      </span>
    </IonInput>
  );
}

/** Plain decimal number input (quantity, percent). Reports null when empty/invalid. */
export function NumberField(p: { label: string; value: number | null | undefined; onChange: (n: number | null) => void; disabled?: boolean; suffix?: string; min?: number; max?: number; helper?: string }) {
  const [text, setText] = useState(p.value == null ? '' : String(p.value));
  const reported = useRef<number | null | undefined>(p.value);
  // Same rule as MoneyField: only outside changes overwrite the text being typed.
  useEffect(() => {
    const mine = p.value === reported.current || (reported.current === null && (p.value == null || p.value === 0));
    if (!mine) setText(p.value == null ? '' : String(p.value));
    reported.current = p.value;
  }, [p.value]);
  return (
    <IonInput
      className="field"
      fill="outline"
      labelPlacement="floating"
      label={p.label}
      inputmode="decimal"
      value={text}
      disabled={p.disabled}
      helperText={p.helper}
      onIonInput={sync((e) => {
        const t = String(e.detail.value ?? '').replace(',', '.');
        setText(t);
        if (t.trim() === '') {
          reported.current = null;
          return p.onChange(null);
        }
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        if (p.min != null && n < p.min) return;
        if (p.max != null && n > p.max) return;
        reported.current = n;
        p.onChange(n);
      })}
    >
      {p.suffix && (
        <span slot="end" className="field-suffix">
          {p.suffix}
        </span>
      )}
    </IonInput>
  );
}

export function SelectField<T extends string | number>(p: { label: string; value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <IonSelect
      className="field"
      fill="outline"
      labelPlacement="floating"
      label={p.label}
      value={p.value}
      disabled={p.disabled}
      interface="popover"
      onIonChange={sync((e) => p.onChange(e.detail.value as T))}
    >
      {p.options.map((o) => (
        <IonSelectOption key={String(o.value)} value={o.value}>
          {o.label}
        </IonSelectOption>
      ))}
    </IonSelect>
  );
}

export function ToggleRow(p: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string }) {
  return (
    <IonItem lines="none" className="toggle-row">
      <IonToggle checked={p.checked} disabled={p.disabled} onIonChange={sync((e) => p.onChange(e.detail.checked))} justify="space-between">
        <IonLabel>
          {p.label}
          {p.note && <p className="toggle-note">{p.note}</p>}
        </IonLabel>
      </IonToggle>
    </IonItem>
  );
}

/**
 * `onChange` receives only the changed key; the parent must merge it into its *latest* state
 * (functional update). Rebuilding the whole address from `value` here could overwrite a
 * keystroke in another field that React hasn't re-rendered yet.
 */
export function AddressFields(p: { value: Address; onChange: (patch: Partial<Address>) => void; disabled?: boolean }) {
  const set = (k: keyof Address) => (v: string) => p.onChange({ [k]: v });
  return (
    <>
      <TextField label="Address line 1" value={p.value.line1} onChange={set('line1')} disabled={p.disabled} />
      <TextField label="Address line 2" value={p.value.line2} onChange={set('line2')} disabled={p.disabled} />
      <div className="field-row">
        <TextField label="City" value={p.value.city} onChange={set('city')} disabled={p.disabled} autocapitalize="words" />
        <TextField label="PIN code" value={p.value.pin} onChange={set('pin')} disabled={p.disabled} inputmode="numeric" maxlength={6} />
      </div>
      <SelectField label="State" value={p.value.state} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} onChange={set('state')} disabled={p.disabled} />
    </>
  );
}

export function FormSection({ title, children, note }: { title?: string; children: ReactNode; note?: string }) {
  return (
    <section className="form-section">
      {title && <h3>{title}</h3>}
      {note && <p className="section-note">{note}</p>}
      {children}
    </section>
  );
}
