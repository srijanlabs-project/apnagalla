import { IonButton, IonButtons, IonContent, IonHeader, IonLabel, IonModal, IonSegment, IonSegmentButton, IonTitle, IonToolbar } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { MoneyField, SelectField } from '../../components/Fields';
import type { Invoice, PaymentInfo } from '../../lib/db';
import { rupees } from '../../lib/format';

type Choice = 'unpaid' | 'paid' | 'partial';

/** SPEC §3: one payment entry per invoice — Unpaid / Paid / Partially paid (amount ≤ total). */
export default function PaymentModal({
  invoice,
  isOpen,
  isOwner,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  isOpen: boolean;
  isOwner: boolean;
  onClose: () => void;
  onSave: (p: PaymentInfo) => void;
}) {
  const total = invoice.totals.grandTotal;
  const [choice, setChoice] = useState<Choice>(invoice.payment.status);
  const [amount, setAmount] = useState<number | null>(invoice.payment.amountPaid || null);
  const [date, setDate] = useState(invoice.payment.date ?? todayISO());
  const [mode, setMode] = useState<PaymentInfo['mode']>(invoice.payment.mode ?? 'upi');

  useEffect(() => {
    if (!isOpen) return;
    setChoice(invoice.payment.status);
    setAmount(invoice.payment.amountPaid || null);
    setDate(invoice.payment.date ?? todayISO());
    setMode(invoice.payment.mode ?? 'upi');
  }, [isOpen, invoice]);

  const paid = choice === 'paid' ? total : choice === 'unpaid' ? 0 : amount ?? 0;
  const tooMuch = choice === 'partial' && (amount ?? 0) > total;
  const reducing = paid < invoice.payment.amountPaid;
  const invalid = tooMuch || (choice === 'partial' && !(amount && amount > 0 && amount < total)) || (reducing && !isOwner);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>Update payment</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={invalid} onClick={() => onSave({ status: choice, amountPaid: paid, date: choice === 'unpaid' ? undefined : date, mode: choice === 'unpaid' ? undefined : mode })}>
              Save
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p className="section-note">
          Invoice total <strong>{rupees(total)}</strong>
        </p>
        <IonSegment value={choice} onIonChange={(e) => setChoice(e.detail.value as Choice)}>
          <IonSegmentButton value="unpaid">
            <IonLabel>Unpaid</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="partial">
            <IonLabel>Partly paid</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="paid">
            <IonLabel>Paid</IonLabel>
          </IonSegmentButton>
        </IonSegment>

        {choice === 'partial' && <MoneyField label="Amount paid" value={amount} onChange={setAmount} required />}
        {tooMuch && <p className="text-danger">Amount cannot be more than the invoice total {rupees(total)}.</p>}
        {choice === 'partial' && amount != null && amount >= total && !tooMuch && <p className="text-danger">That's the full amount — choose "Paid" instead.</p>}
        {reducing && !isOwner && <p className="text-danger">Only the owner can reduce a recorded payment.</p>}

        {choice !== 'unpaid' && (
          <>
            <label className="date-field">
              <span>Payment date</span>
              <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <SelectField
              label="Mode"
              value={mode}
              options={[
                { value: 'upi', label: 'UPI' },
                { value: 'cash', label: 'Cash' },
                { value: 'bank', label: 'Bank transfer' },
                { value: 'cheque', label: 'Cheque' },
                { value: 'other', label: 'Other' },
              ]}
              onChange={(m) => setMode(m)}
            />
          </>
        )}

        <div className="line-preview">
          <div>
            <span>Paid</span>
            <strong>{rupees(Math.min(paid, total))}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong className={total - paid > 0 ? 'text-danger' : ''}>{rupees(Math.max(0, total - paid))}</strong>
          </div>
        </div>
      </IonContent>
    </IonModal>
  );
}
