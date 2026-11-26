import { IonButton, IonButtons, IonContent, IonHeader, IonInput, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { todayISO, type PaymentMode } from '@invoice/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';
import { modeLabel } from '../lib/ledger';
import { sync } from '../lib/sync';
import AccountField from './AccountField';
import { MoneyField, SelectField, TextField } from './Fields';

export type CashMode = Exclude<PaymentMode, 'advance' | 'creditnote' | 'points'>;
export const CASH_MODES: CashMode[] = ['cash', 'upi', 'bank', 'cheque', 'card', 'other'];

export interface MoneyEntry {
  amount: number;
  mode: CashMode;
  /** R6: bank account for UPI, card, bank, cheque (none = the default account). */
  accountId?: string | null;
  date: string;
  reference?: string;
  note?: string;
}

/** Record money paid or received: amount, mode, date, reference, note. */
export default function MoneyEntrySheet({
  isOpen,
  onClose,
  title,
  amount,
  max,
  onSave,
  children,
  saveLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** Starting amount (e.g. what is owed). */
  amount?: number;
  max?: number;
  onSave: (e: MoneyEntry) => Promise<void> | void;
  /** Extra fields above (e.g. expense category). */
  children?: ReactNode;
  saveLabel?: string;
}) {
  const [e, setE] = useState<MoneyEntry>({ amount: amount ?? 0, mode: 'cash', date: todayISO() });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isOpen) setE({ amount: amount ?? 0, mode: 'cash', date: todayISO() });
  }, [isOpen, amount]);
  const tooMuch = max != null && e.amount > max;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.85} breakpoints={[0, 0.85, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {children}
        <MoneyField label={t('Amount')} required value={e.amount || null} onChange={(amount) => setE((x) => ({ ...x, amount: amount ?? 0 }))} />
        {tooMuch && <p className="section-note text-danger">{t('More than what is owed')}</p>}
        <div className="field-row">
          <SelectField label={t('Mode')} value={e.mode} options={CASH_MODES.map((m) => ({ value: m, label: modeLabel(m) }))} onChange={(mode) => setE((x) => ({ ...x, mode }))} />
          <IonInput
            className="field"
            fill="outline"
            labelPlacement="floating"
            label={t('Date')}
            type="date"
            value={e.date}
            max={todayISO()}
            onIonInput={sync((ev) => setE((x) => ({ ...x, date: String(ev.detail.value ?? todayISO()) })))}
          />
        </div>
        <AccountField mode={e.mode} value={e.accountId} onChange={(accountId) => setE((x) => ({ ...x, accountId }))} />
        {e.mode !== 'cash' && <TextField label={t('Reference (UPI ref, cheque no.)')} value={e.reference} onChange={(reference) => setE((x) => ({ ...x, reference }))} />}
        <TextField label={t('Note (optional)')} value={e.note} onChange={(note) => setE((x) => ({ ...x, note }))} />
        <IonButton
          expand="block"
          disabled={!(e.amount > 0) || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(e);
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {saveLabel ?? t('Save')}
        </IonButton>
      </IonContent>
    </IonModal>
  );
}
