import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonModal, IonSegment, IonSegmentButton, IonLabel, IonTitle, IonToolbar } from '@ionic/react';
import { todayISO, type PaymentMode } from '@invoice/shared';
import { addOutline, closeCircle } from 'ionicons/icons';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import type { UpiId } from '../lib/db';
import { rupees } from '../lib/format';
import { t } from '../lib/i18n';
import { MODE_LABEL, modeLabel } from '../lib/ledger';
import { upiLink } from '../lib/pdf/buildDoc';
import type { NewPayment } from '../lib/repo';
import { sync } from '../lib/sync';
import AccountField from './AccountField';
import { MoneyField, SelectField, TextField } from './Fields';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Most that can be entered: pending amount (payment) or overpaid amount (refund). */
  amount: number;
  kind?: 'payment' | 'refund';
  /** UPI ID for the on-screen QR (payments only). */
  upi?: UpiId | null;
  /** Note on the QR, e.g. the bill number. */
  qrNote?: string;
  /** Owner may record an earlier date. */
  allowDate?: boolean;
  /** Walk-in sale: the full amount must be paid now. */
  requireFull?: boolean;
  /** Named customer at the counter: may take the goods and pay later. */
  allowPayLater?: boolean;
  /** `change` = cash to give back to the customer. */
  onConfirm: (parts: NewPayment[], date: string, change: number) => Promise<void> | void;
}

interface Row extends NewPayment {
  /** Cash handed over by the customer, to work out the change. */
  tendered?: number | null;
}

const QUICK: PaymentMode[] = ['cash', 'upi', 'card'];
/** Built when shown, so the labels are in the app's language. */
const allModes = () => (Object.keys(MODE_LABEL) as PaymentMode[]).filter((m) => m !== 'advance' && m !== 'creditnote' && m !== 'points').map((value) => ({ value, label: modeLabel(value) }));

/**
 * Take a payment (or give a refund): one mode or split across several. Cash shows the change to
 * give back; UPI shows a QR for the exact amount for the customer to scan. The cashier confirms
 * once the money is received; nothing is checked with the bank.
 */
export default function PaySheet({ isOpen, onClose, amount, kind = 'payment', upi, qrNote = '', allowDate, requireFull, allowPayLater, onConfirm }: Props) {
  const [rows, setRows] = useState<Row[]>([{ mode: 'cash', amount }]);
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRows([{ mode: kind === 'refund' ? 'cash' : 'cash', amount }]);
      setDate(todayISO());
    }
  }, [isOpen, amount, kind]);

  const total = rows.reduce((a, r) => a + (r.amount || 0), 0);
  const left = amount - total;
  const tooMuch = total > amount;
  const short = !!requireFull && left > 0;
  const change = rows.reduce((a, r) => a + (r.mode === 'cash' && r.tendered && r.tendered > r.amount ? r.tendered - r.amount : 0), 0);
  const set = (i: number, p: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const split = rows.length > 1;

  async function confirm(payLater = false) {
    if (busy || (!payLater && (total <= 0 || tooMuch || short))) return;
    setBusy(true);
    try {
      await onConfirm(payLater ? [] : rows.filter((r) => r.amount > 0).map(({ tendered: _t, ...r }) => r), date, payLater ? 0 : change);
    } finally {
      setBusy(false);
    }
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
          <IonTitle>
            {kind === 'refund' ? t('Refund {amount}', { amount: rupees(amount) }) : t('Receive {amount}', { amount: rupees(amount) })}
          </IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding pay-sheet">
        {!split && (
          <IonSegment value={rows[0]!.mode} onIonChange={sync((e) => set(0, { mode: e.detail.value as PaymentMode }))}>
            {QUICK.map((m) => (
              <IonSegmentButton key={m} value={m}>
                <IonLabel>{modeLabel(m)}</IonLabel>
              </IonSegmentButton>
            ))}
            <IonSegmentButton value="other">
              <IonLabel>{t('Other')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        )}

        {rows.map((r, i) => (
          <div key={i} className="pay-row">
            <div className="field-row">
              {(split || !QUICK.includes(r.mode)) && <SelectField label={t('Mode')} value={r.mode} options={allModes()} onChange={(mode) => set(i, { mode })} />}
              <MoneyField label={split ? t('Amount {number}', { number: i + 1 }) : t('Amount')} value={r.amount} onChange={(v) => set(i, { amount: v ?? 0 })} />
            </div>
            {split && (
              <IonButton fill="clear" size="small" color="medium" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
                <IonIcon icon={closeCircle} slot="start" /> {t('Remove {mode}', { mode: modeLabel(r.mode).toLowerCase() })}
              </IonButton>
            )}

            {r.mode === 'cash' && kind === 'payment' && (
              <div className="field-row">
                <MoneyField label={t('Cash received')} value={r.tendered ?? null} onChange={(tendered) => set(i, { tendered })} />
                <div className="change-box">
                  <span>{t('Give back')}</span>
                  <strong>{r.tendered && r.tendered >= r.amount ? rupees(r.tendered - r.amount) : '—'}</strong>
                </div>
              </div>
            )}

            {r.mode === 'upi' && kind === 'payment' && upi && r.amount > 0 && <UpiQr upi={upi} amount={r.amount} note={qrNote} />}
            {r.mode === 'upi' && kind === 'payment' && !upi && <p className="section-note">{t('Add your UPI ID in More → Payment details to show a QR here.')}</p>}

            <AccountField mode={r.mode} value={r.accountId} onChange={(accountId) => set(i, { accountId })} />
            {(r.mode === 'upi' || r.mode === 'cheque' || r.mode === 'bank' || r.mode === 'card') && (
              <TextField
                label={r.mode === 'cheque' ? t('Cheque no.') : r.mode === 'card' ? t('Card / slip ref. (optional)') : t('Reference (optional)')}
                value={r.reference}
                onChange={(reference) => set(i, { reference })}
              />
            )}
          </div>
        ))}

        {left > 0 && (
          <IonButton fill="clear" size="small" onClick={() => setRows((cur) => [...cur, { mode: cur[0]?.mode === 'cash' ? 'upi' : 'cash', amount: left }])}>
            <IonIcon icon={addOutline} slot="start" /> {t('Split: add another mode')}
          </IonButton>
        )}

        {allowDate && (
          <label className="date-field">
            <span>{t('Date')}</span>
            <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
        )}

        <div className="pay-summary">
          {tooMuch ? (
            <p className="text-danger">{t('That is more than {amount}.', { amount: rupees(amount) })}</p>
          ) : short ? (
            <p className="text-danger">{t('A walk-in customer pays the full {amount}. Pick a customer to leave a balance.', { amount: rupees(amount) })}</p>
          ) : left > 0 && kind === 'payment' ? (
            <p>{t('{amount} stays pending on the bill.', { amount: rupees(left) })}</p>
          ) : null}
        </div>

        <IonButton expand="block" size="large" disabled={busy || total <= 0 || tooMuch || short} onClick={() => void confirm()}>
          {kind === 'refund' ? t('Refunded {amount}', { amount: rupees(total) }) : t('Received {amount}', { amount: rupees(total) })}
        </IonButton>
        {allowPayLater && (
          <IonButton expand="block" fill="clear" disabled={busy} onClick={() => void confirm(true)}>
            {t('Save unpaid (pay later)')}
          </IonButton>
        )}
      </IonContent>
    </IonModal>
  );
}

/** QR the customer scans with any UPI app; the amount is filled in. */
function UpiQr({ upi, amount, note }: { upi: UpiId; amount: number; note: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(upiLink(upi, amount, note), { margin: 1, width: 240 }).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [upi, amount, note]);
  // The amount is shown in bold, wherever the language puts it in the sentence.
  const [payBefore, payAfter = ''] = t('Scan to pay {amount}').split('{amount}');
  return (
    <div className="upi-qr">
      {src && <img src={src} alt={t('UPI QR for {amount}', { amount: rupees(amount) })} />}
      <p>
        {payBefore}
        <strong>{rupees(amount)}</strong>
        {payAfter}
      </p>
      <p className="section-note">{upi.upiId}</p>
      <p className="section-note">{t('Tap “Received” only after the money shows in your UPI app.')}</p>
    </div>
  );
}
