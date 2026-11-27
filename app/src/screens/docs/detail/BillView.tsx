import { IonButton, IonIcon, useIonToast } from '@ionic/react';

import { ellipsisVertical } from 'ionicons/icons';

import ActionMenu from '../../../components/ActionMenu';
import CreditPaySheet from '../../../components/CreditPaySheet';
import DocPhotos from '../../../components/DocPhotos';
import EInvoicePanel from '../../../components/EInvoicePanel';
import InstalmentPanel from '../../../components/InstalmentPanel';
import MoneyEntrySheet from '../../../components/MoneyEntrySheet';
import PageShell from '../../../components/PageShell';
import PaySheet from '../../../components/PaySheet';
import PdfPreview from '../../../components/PdfPreview';

import { useBusiness } from '../../../lib/business';
import { consignmentProgress } from '../../../lib/consignment';
import { payWithCredit, settlementOf } from '../../../lib/credit';
import { type CreditNote, type Estimate, type Invoice } from '../../../lib/db';
import { markDelivered } from '../../../lib/deliveries';
import { fileToResizedDataUrl } from '../../../lib/format';
import { gstViewOf } from '../../../lib/gstView';
import { t } from '../../../lib/i18n';
import { refundAdvance, takeAdvance } from '../../../lib/jobs';

import { moneyOf } from '../../../lib/ledger';
import { loyaltyOf } from '../../../lib/loyalty';
import { orderProgress } from '../../../lib/orders';

import { CAN_CREATE_INVOICES } from '../../../lib/platform';
import { putRecord, recordPayments, type DocKind } from '../../../lib/repo';

import { CreditNotesList, DocLines, HistoryList } from './LinesAndHistory';
import OrderProgress from './OrderProgress';
import PaymentsList from './PaymentsList';
import SummaryCard from './SummaryCard';

import { useBillActions } from './useBillActions';

export interface BillData {
  kind: DocKind;
  doc: Invoice | Estimate | CreditNote;
  creditNotes?: CreditNote[];
  linked?: Invoice;
  settlement?: Awaited<ReturnType<typeof settlementOf>>;
  progress?: Awaited<ReturnType<typeof orderProgress>> | null;
  consign?: Awaited<ReturnType<typeof consignmentProgress>> | null;
  estAdvance: number;
  points: number;
  advance: number;
  emailOn: boolean;
}

/** What the bill screen shows, once loaded. */
export default function BillView(p: BillData) {
  const { kind, doc, creditNotes, linked, settlement, progress, consign, estAdvance } = p;
  const { actor, isOwner, settings, profile, ledger, upiIds, perms } = useBusiness();
  const [toast] = useIonToast();
  const inv = kind === 'invoice' ? (doc as Invoice) : null;
  const est = kind === 'estimate' ? (doc as Estimate) : null;
  const note = kind === 'credit' ? (doc as CreditNote) : null;
  const money = inv ? moneyOf(inv, ledger) : null;
  const pending = money?.pending ?? 0;
  // The bill money goes on: this invoice, or the invoice a credit note belongs to.
  const billForMoney = inv ?? linked ?? null;
  const billMoneyNow = billForMoney ? moneyOf(billForMoney, ledger) : null;
  const refundDue = note?.status === 'saved' || inv ? (billMoneyNow?.refundDue ?? 0) : 0;
  // "Keep as credit" settles through a return credit note: this one, or the bill's last one.
  const keepNote = note?.status === 'saved' ? note : (creditNotes ?? []).filter((n) => n.status === 'saved').slice(-1)[0];
  const upi = upiIds.find((u) => u.id === billForMoney?.upiIdId) ?? upiIds.find((u) => u.isDefault) ?? upiIds[0] ?? null;
  const view = gstViewOf(kind, doc, doc.businessSnapshot ?? profile, doc.totals);
  const canEdit =
    (kind === 'estimate' || CAN_CREATE_INVOICES) &&
    (doc.status === 'draft' || (doc.status !== 'cancelled' && doc.status !== 'converted' && (isOwner || (est != null && doc.createdBy === actor.userId))));
  const canTakePayment = !!inv && inv.status === 'saved' && pending > 0 && CAN_CREATE_INVOICES;
  const estOpen = !!est && est.status !== 'draft' && est.status !== 'converted';
  const canConvert = estOpen && CAN_CREATE_INVOICES && (!est!.order || (progress && progress.state !== 'done' && progress.state !== 'closed')) && (!est!.consignment || (consign && !consign.settled));
  const canDeliver = !doc.deliveredAt && (doc.deliveryDate || est?.challan || perms.access === 'warehouse') && (inv?.status === 'saved' || estOpen);
  const phone = doc.billTo?.phone;
  const pointValue = loyaltyOf(settings).pointValue;

  const { groups, bar, next, fail, deliveryCam, menu, setMenu, payOpen, setPayOpen, creditPay, setCreditPay, advanceOpen, setAdvanceOpen, receipt, setReceipt, preview, base } = useBillActions(p, { inv, est, note, money, pending, billForMoney, billMoneyNow, refundDue, keepNote, upi, view, canEdit, canTakePayment, estOpen, canConvert, canDeliver, phone, pointValue });
  return (
    <PageShell
      title={doc.number || (kind === 'invoice' ? t('Invoice draft') : kind === 'estimate' ? t('Estimate draft') : t('Credit note draft'))}
      backHref={base}
      padded={false}
      headerEnd={
        <IonButton onClick={() => setMenu(true)} aria-label={t('More')}>
          <IonIcon icon={ellipsisVertical} slot="icon-only" />
        </IonButton>
      }
      footer={<div className="action-bar">{bar}</div>}
    >
      <SummaryCard doc={doc} inv={inv} est={est} note={note} money={money} view={view} settlement={settlement} refundDue={refundDue} estAdvance={estAdvance}>
        {next.length ? next : null}
      </SummaryCard>
      <input
        ref={deliveryCam}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await markDelivered(actor, kind as 'invoice' | 'estimate', doc.id, await fileToResizedDataUrl(f, 1000, true)).catch(fail);
        }}
      />
      <OrderProgress docId={doc.id} progress={progress} consign={consign} fail={fail} />

      {inv && money && <InstalmentPanel inv={inv} paid={money.paid} pending={pending} />}
      {inv && isOwner && CAN_CREATE_INVOICES && <EInvoicePanel inv={inv} />}
      {preview && <PdfPreview blob={preview} />}
      {receipt && (
        <div className="receipt-preview" onClick={() => setReceipt(null)}>
          <img src={receipt} alt={t('Receipt')} />
          <p className="section-note">{t('Thermal receipt preview. Printing works in the Android app. Tap to close.')}</p>
        </div>
      )}
      {doc.privateNotes && (
        <p className="private-notes">
          <strong>{t('Notes for us')}:</strong> {doc.privateNotes}
        </p>
      )}
      {doc.deliveryPhoto && (
        <div className="ion-padding-horizontal">
          <p className="section-note">
            {t('Delivery photo')}
            {doc.deliveredByName ? ` · ${doc.deliveredByName}` : ''}
          </p>
          <img src={doc.deliveryPhoto} alt="" className="delivery-photo" />
        </div>
      )}

      {money && <PaymentsList money={money} fail={fail} />}
      <CreditNotesList notes={creditNotes ?? []} />
      <DocLines doc={doc} noTax={view.mode === 'none'} />
      {(kind !== 'credit' || (doc.photos?.length ?? 0) > 0) && perms.access !== 'warehouse' && perms.access !== 'readonly' && (
        <DocPhotos
          photos={doc.photos ?? []}
          canAdd={doc.status !== 'cancelled'}
          onChange={(photos) => void putRecord(kind === 'invoice' ? 'invoices' : 'estimates', actor, { ...(doc as Invoice), photos }).catch(fail)}
        />
      )}
      <HistoryList doc={doc} />

      <ActionMenu isOpen={menu} onClose={() => setMenu(false)} title={t('More for {number}', { number: doc.number || t('(draft)') })} groups={groups} />
      <CreditPaySheet
        isOpen={creditPay}
        onClose={() => setCreditPay(false)}
        businessId={actor.businessId}
        customerId={inv?.billTo?.customerId}
        onPick={(n, left) => inv && void payWithCredit(actor, inv, n.id, left).catch(fail)}
      />
      {est && (
        <MoneyEntrySheet
          isOpen={!!advanceOpen}
          onClose={() => setAdvanceOpen(null)}
          title={advanceOpen === 'refund' ? t('Return advance') : t('Advance for {job}', { job: est.number })}
          amount={advanceOpen === 'refund' ? estAdvance : undefined}
          max={advanceOpen === 'refund' ? estAdvance : undefined}
          onSave={async (m) => {
            if (advanceOpen === 'refund') await refundAdvance(actor, est, m);
            else await takeAdvance(actor, est, m);
          }}
        />
      )}
      {billForMoney && (
        <PaySheet
          isOpen={!!payOpen}
          kind={payOpen ?? 'payment'}
          amount={payOpen === 'refund' ? refundDue : pending}
          upi={upi}
          qrNote={`${view.title} ${billForMoney.number}`}
          allowDate={isOwner}
          onClose={() => setPayOpen(null)}
          onConfirm={(parts, date) =>
            recordPayments(actor, billForMoney.id, parts, { date, kind: payOpen ?? 'payment', creditNoteId: note?.id })
              .then(() => {
                setPayOpen(null);
                void toast({ message: payOpen === 'refund' ? t('Refund recorded') : t('Payment recorded'), duration: 1200, color: 'success' });
              })
              .catch(fail)
          }
        />
      )}
    </PageShell>
  );
}
