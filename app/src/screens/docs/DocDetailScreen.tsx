import {
  IonActionSheet,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  useIonAlert,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { formatDateIN } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { createOutline, ellipsisVertical, eyeOutline, logoWhatsapp, shareSocialOutline, walletOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import PdfPreview from '../../components/PdfPreview';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db, type CreditNote, type Estimate, type Invoice } from '../../lib/db';
import { gstViewOf } from '../../lib/gstView';
import { dateIN, rupees } from '../../lib/format';
import { pdfFileName, pdfInputFor, renderPdf, sharePdf } from '../../lib/pdf';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import {
  cancelCreditNote,
  cancelInvoice,
  convertEstimate,
  deleteDraft,
  duplicateInvoice,
  newCreditNoteDraft,
  recordPayments,
  saveCreditNote,
  setEstimateStatus,
  voidPayment,
  type DocKind,
} from '../../lib/repo';
import PaySheet from '../../components/PaySheet';
import { MODE_LABEL, moneyOf } from '../../lib/ledger';
import { DOC_BASE, DOC_LABEL } from './DocEditorScreen';

export default function DocDetailScreen({ kind }: { kind: DocKind }) {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner, settings, profile, ledger, upiIds } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [menu, setMenu] = useState(false);
  const [payOpen, setPayOpen] = useState<'payment' | 'refund' | null>(null);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = DOC_BASE[kind];
  const label = DOC_LABEL[kind];

  const doc = useLiveQuery(
    () => (kind === 'invoice' ? db.invoices.get(id!) : kind === 'estimate' ? db.estimates.get(id!) : db.creditNotes.get(id!)) as Promise<Invoice | Estimate | CreditNote | undefined>,
    [id, kind],
  );
  const creditNotes = useLiveQuery(
    () => (kind === 'invoice' && id ? db.creditNotes.where('invoiceId').equals(id).filter((n) => !n.deleted).toArray() : Promise.resolve([] as CreditNote[])),
    [id, kind],
  );
  // A credit note's invoice: its refund is paid from here.
  const noteInvoiceId = kind === 'credit' ? (doc as CreditNote | undefined)?.invoiceId : undefined;
  const linked = useLiveQuery(async (): Promise<Invoice | undefined> => (noteInvoiceId ? db.invoices.get(noteInvoiceId) : undefined), [noteInvoiceId]);
  if (!doc) return null;
  const inv = kind === 'invoice' ? (doc as Invoice) : null;
  const est = kind === 'estimate' ? (doc as Estimate) : null;
  const note = kind === 'credit' ? (doc as CreditNote) : null;
  const money = inv ? moneyOf(inv, ledger) : null;
  const pending = money?.pending ?? 0;
  // The bill money goes on: this invoice, or the invoice a credit note belongs to.
  const billForMoney = inv ?? linked ?? null;
  const billMoneyNow = billForMoney ? moneyOf(billForMoney, ledger) : null;
  const refundDue = note?.status === 'saved' || inv ? (billMoneyNow?.refundDue ?? 0) : 0;
  const upi = upiIds.find((u) => u.id === billForMoney?.upiIdId) ?? upiIds.find((u) => u.isDefault) ?? upiIds[0] ?? null;
  const view = gstViewOf(kind, doc, doc.businessSnapshot ?? profile, doc.totals);
  const canEdit =
    (kind === 'estimate' || CAN_CREATE_INVOICES) &&
    (doc.status === 'draft' || (doc.status !== 'cancelled' && doc.status !== 'converted' && (isOwner || (est != null && doc.createdBy === actor.userId))));

  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : 'Something went wrong', duration: 2500, color: 'danger' });

  async function makePdf() {
    return renderPdf(await pdfInputFor(kind, doc!, settings));
  }

  async function onShare() {
    setBusy('share');
    try {
      const pdf = await makePdf();
      const text = inv
        ? `${profile.name}: ${view.title} ${doc!.number} for ${rupees(inv.totals.grandTotal)}${pending > 0 ? `. Pending ${rupees(pending)}.` : '.'}`
        : `${profile.name}: ${view.title} ${doc!.number}`;
      const r = await sharePdf(pdfFileName(kind, doc!), pdf, text);
      if (r === 'downloaded') void toast({ message: 'PDF downloaded', duration: 1500 });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onPreview() {
    setBusy('preview');
    try {
      setPreview((await makePdf()).blob);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  function onReminder() {
    if (!inv) return;
    const phone = inv.billTo?.phone?.replace('+', '');
    const msg = settings.reminderTemplate
      .replaceAll('{name}', inv.billTo?.name ?? '')
      .replaceAll('{pending}', (pending / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }))
      .replaceAll('{number}', inv.number)
      .replaceAll('{date}', formatDateIN(inv.date))
      .replaceAll('{business}', profile.name);
    window.open(`https://wa.me/${phone ?? ''}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const menuButtons = [
    ...(canEdit ? [{ text: 'Edit', handler: () => router.push(`${base}/${doc.id}/edit`) }] : []),
    ...(inv && inv.status === 'saved' && CAN_CREATE_INVOICES && (money?.due ?? 0) > 0
      ? [
          {
            text: isOwner ? 'Return items / credit note' : 'Return items',
            handler: () =>
              void newCreditNoteDraft(actor, doc.id)
                .then((n) => saveCreditNote(actor, n, { finalize: false }))
                .then((n) => router.push(`/tabs/credit-notes/${n.id}/edit`))
                .catch(fail),
          },
        ]
      : []),
    ...(note && note.status === 'saved' && isOwner
      ? [
          {
            text: 'Cancel credit note',
            role: 'destructive' as const,
            handler: () =>
              void alert({
                header: `Cancel ${doc.number}?`,
                message: `The number is kept and the amount goes back onto invoice ${note.invoiceNumber}. This cannot be undone.`,
                inputs: [{ name: 'reason', placeholder: 'Reason (optional)' }],
                buttons: [
                  { text: 'Keep', role: 'cancel' },
                  { text: 'Cancel credit note', role: 'destructive', handler: (v: { reason?: string }) => void cancelCreditNote(actor, doc.id, v.reason).catch(fail) },
                ],
              }),
          },
        ]
      : []),
    ...(inv && CAN_CREATE_INVOICES
      ? [
          {
            text: 'Duplicate',
            handler: () =>
              void duplicateInvoice(actor, doc.id)
                .then((d) => router.push(`/tabs/invoices/${d.id}/edit`))
                .catch(fail),
          },
        ]
      : []),
    ...(est && est.status !== 'draft' && est.status !== 'converted'
      ? [
          { text: 'Mark accepted', handler: () => void setEstimateStatus(actor, doc.id, 'accepted') },
          { text: 'Mark declined', handler: () => void setEstimateStatus(actor, doc.id, 'declined') },
        ]
      : []),
    ...(inv && inv.status === 'saved' && isOwner
      ? [
          {
            text: 'Cancel invoice',
            role: 'destructive' as const,
            handler: () =>
              void alert({
                header: `Cancel ${doc.number}?`,
                message: 'The number is kept and the invoice is marked CANCELLED. This cannot be undone.',
                inputs: [{ name: 'reason', placeholder: 'Reason (optional)' }],
                buttons: [
                  { text: 'Keep', role: 'cancel' },
                  { text: 'Cancel invoice', role: 'destructive', handler: (v: { reason?: string }) => void cancelInvoice(actor, doc.id, v.reason).catch(fail) },
                ],
              }),
          },
        ]
      : []),
    ...(doc.status === 'draft'
      ? [
          {
            text: 'Delete draft',
            role: 'destructive' as const,
            handler: () =>
              void deleteDraft(actor, kind, doc.id)
                .then(() => router.push(base, 'back', 'replace'))
                .catch(fail),
          },
        ]
      : []),
    { text: 'Close', role: 'cancel' as const },
  ];

  return (
    <PageShell title={doc.number || `${label} draft`} backHref={base} padded={false}>
      <IonCard>
        <IonCardContent>
          <div className="detail-head">
            <div>
              <h2>{doc.billTo?.name ?? 'No customer'}</h2>
              <p>
                {view.title} {doc.number || '(draft)'} · {dateIN(doc.date)}
                {inv?.dueDate ? ` · due ${dateIN(inv.dueDate)}` : ''}
              </p>
              {view.mode === 'gst' && view.pos && (
                <p>
                  Place of supply {view.posLabel} · {view.interState ? 'IGST' : `CGST + ${view.sgstName}`}
                </p>
              )}
              {note && (
                <p>
                  Against invoice <a onClick={() => router.push(`/tabs/invoices/${note.invoiceId}`)}>{note.invoiceNumber}</a> of {dateIN(note.invoiceDate)}
                </p>
              )}
            </div>
            {inv ? <StatusBadge invoice={inv} /> : est ? <StatusBadge estimate={est} /> : <StatusBadge creditNote={note!} />}
          </div>
          <div className="detail-total">
            <span>Total</span>
            <strong>{rupees(doc.totals.grandTotal)}</strong>
          </div>
          {money && money.credited > 0 && (
            <div className="detail-pay">
              <div>
                <span>Credit notes</span> <strong>−{rupees(money.credited)}</strong>
              </div>
            </div>
          )}
          {money && inv?.status === 'saved' && (
            <div className="detail-pay">
              <div>
                <span>Paid</span> <strong>{rupees(money.paid)}</strong>
              </div>
              <div>
                <span>Pending</span> <strong className={pending ? 'text-danger' : ''}>{rupees(pending)}</strong>
              </div>
            </div>
          )}
          {refundDue > 0 && (
            <p className="text-danger">
              {rupees(refundDue)} was paid more than is now due{note ? ` on invoice ${note.invoiceNumber}` : ''}: refund it to the customer.
            </p>
          )}

          <div className="detail-actions">
            <IonButton onClick={() => void onShare()} disabled={!!busy}>
              {busy === 'share' ? <IonSpinner name="dots" /> : <IonIcon icon={shareSocialOutline} slot="start" />} Share PDF
            </IonButton>
            <IonButton fill="outline" onClick={() => void onPreview()} disabled={!!busy}>
              {busy === 'preview' ? <IonSpinner name="dots" /> : <IonIcon icon={eyeOutline} slot="start" />} Preview
            </IonButton>
            {inv && inv.status === 'saved' && pending > 0 && (
              <IonButton fill="outline" onClick={() => setPayOpen('payment')}>
                <IonIcon icon={walletOutline} slot="start" /> Record payment
              </IonButton>
            )}
            {refundDue > 0 && CAN_CREATE_INVOICES && (
              <IonButton fill="outline" color="danger" onClick={() => setPayOpen('refund')}>
                <IonIcon icon={walletOutline} slot="start" /> Refund {rupees(refundDue)}
              </IonButton>
            )}
            {inv && pending > 0 && (
              <IonButton fill="outline" color="success" onClick={onReminder}>
                <IonIcon icon={logoWhatsapp} slot="start" /> Remind
              </IonButton>
            )}
            {est && est.status !== 'draft' && est.status !== 'converted' && CAN_CREATE_INVOICES && (
              <IonButton
                color="success"
                onClick={() =>
                  void convertEstimate(actor, est.id)
                    .then((d) => router.push(`/tabs/invoices/${d.id}/edit`))
                    .catch(fail)
                }
              >
                Convert to invoice
              </IonButton>
            )}
            {est?.convertedInvoiceId && (
              <IonButton fill="outline" routerLink={`/tabs/invoices/${est.convertedInvoiceId}`}>
                Open invoice
              </IonButton>
            )}
            {canEdit && (
              <IonButton fill="clear" routerLink={`${base}/${doc.id}/edit`}>
                <IonIcon icon={createOutline} slot="start" /> Edit
              </IonButton>
            )}
          </div>
        </IonCardContent>
      </IonCard>

      {preview && <PdfPreview blob={preview} />}

      {money && money.entries.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>Payments</IonLabel>
          </IonListHeader>
          {money.entries.map((e) => (
            <IonItem key={e.id} lines="full">
              <IonLabel className={e.voidedAt ? 'voided' : undefined}>
                <h3>
                  {e.kind === 'refund' ? 'Refund' : 'Received'} · {MODE_LABEL[e.mode]}
                  {e.reference ? ` · ${e.reference}` : ''}
                </h3>
                <p>
                  {dateIN(e.date)}
                  {e.receivedByName ? ` · ${e.receivedByName}` : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
                {e.voidedAt && (
                  <p className="text-danger">
                    Voided{e.voidedByName ? ` by ${e.voidedByName}` : ''}: {e.voidReason}
                  </p>
                )}
              </IonLabel>
              <IonNote slot="end" className={e.voidedAt ? 'voided' : e.kind === 'refund' ? 'text-danger' : undefined}>
                {e.kind === 'refund' ? '−' : ''}
                {rupees(e.amount)}
              </IonNote>
              {isOwner && !e.voidedAt && (
                <IonButton
                  slot="end"
                  fill="clear"
                  size="small"
                  color="medium"
                  onClick={() =>
                    void alert({
                      header: `Void ${rupees(e.amount)} ${MODE_LABEL[e.mode]}?`,
                      message: 'Use this for a mistake. The entry stays in the history, crossed out.',
                      inputs: [{ name: 'reason', placeholder: 'Reason' }],
                      buttons: [
                        { text: 'Keep', role: 'cancel' },
                        { text: 'Void', role: 'destructive', handler: (v: { reason?: string }) => void voidPayment(actor, e.id, v.reason ?? '').catch(fail) },
                      ],
                    })
                  }
                >
                  Void
                </IonButton>
              )}
            </IonItem>
          ))}
        </IonList>
      )}

      {creditNotes && creditNotes.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>Credit notes</IonLabel>
          </IonListHeader>
          {creditNotes.map((n) => (
            <IonItem key={n.id} routerLink={`/tabs/credit-notes/${n.id}`} detail={false}>
              <IonLabel>
                <h3>{n.number || 'Draft'}</h3>
                <p>
                  {dateIN(n.date)} · {n.status}
                </p>
              </IonLabel>
              <IonNote slot="end">{rupees(n.totals.grandTotal)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}

      <IonList inset>
        <IonListHeader>
          <IonLabel>Items</IonLabel>
        </IonListHeader>
        {doc.lines.map((l, i) => (
          <IonItem key={l.id}>
            <IonLabel>
              <h3>{l.name}</h3>
              <p>
                {l.qty} {l.unit} × {rupees(l.rate)}
                {view.mode === 'none' ? '' : ` · tax ${l.taxPct}%`}
                {l.hsn && view.mode !== 'none' ? ` · HSN ${l.hsn}` : ''}
              </p>
            </IonLabel>
            <IonNote slot="end">{rupees(doc.totals.lines[i]?.amount ?? 0)}</IonNote>
          </IonItem>
        ))}
      </IonList>

      <IonList inset>
        <IonListHeader>
          <IonLabel>History</IonLabel>
        </IonListHeader>
        {[...doc.history].reverse().map((h, i) => (
          <IonItem key={i} lines="none">
            <IonLabel>
              <p>
                <strong>{h.action}</strong>
                {h.detail ? ` — ${h.detail}` : ''}
              </p>
              <p>
                {h.byName || 'Someone'} · {new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </IonLabel>
          </IonItem>
        ))}
      </IonList>

      <IonButtons className="detail-more">
        <IonButton onClick={() => setMenu(true)}>
          <IonIcon icon={ellipsisVertical} slot="start" /> More actions
        </IonButton>
      </IonButtons>
      <IonActionSheet isOpen={menu} onDidDismiss={() => setMenu(false)} buttons={menuButtons} />

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
                void toast({ message: payOpen === 'refund' ? 'Refund recorded' : 'Payment recorded', duration: 1200, color: 'success' });
              })
              .catch(fail)
          }
        />
      )}
    </PageShell>
  );
}
