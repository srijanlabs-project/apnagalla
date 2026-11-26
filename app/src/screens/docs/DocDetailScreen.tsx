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
import CreditPaySheet from '../../components/CreditPaySheet';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import { keepAsCredit, payWithCredit, settlementOf } from '../../lib/credit';
import { jobAdvance, refundAdvance, releaseAdvance, stageLabel, takeAdvance } from '../../lib/jobs';
import DocPhotos from '../../components/DocPhotos';
import { formatDateIN } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { cameraOutline, createOutline, documentOutline, ellipsisVertical, eyeOutline, logoWhatsapp, shareSocialOutline, walletOutline, printOutline, swapHorizontalOutline } from 'ionicons/icons';
import { printPdfFile, sendOnWhatsApp } from '../../lib/shopTools';
import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import PdfPreview from '../../components/PdfPreview';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db, type CreditNote, type Estimate, type Invoice } from '../../lib/db';
import { gstViewOf, titleIn } from '../../lib/gstView';
import { appLanguage } from '../../lib/i18n';
import { dateIN, lineSize, rupees, fileToResizedDataUrl } from '../../lib/format';
import { t } from '../../lib/i18n';
import { receiptFor, shareReceipt } from '../../lib/pdf/receipt';
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
  putRecord,
} from '../../lib/repo';
import PaySheet from '../../components/PaySheet';
import { applyAdvance, khataOf } from '../../lib/khata';
import { markDelivered } from '../../lib/deliveries';
import { usePrint } from '../../lib/usePrint';
import { modeLabel, moneyOf } from '../../lib/ledger';
import { DOC_BASE } from './DocEditorScreen';
import { orderProgress, orderStateLabel } from '../../lib/orders';
import { consignmentProgress, takeBackConsignment } from '../../lib/consignment';
import { loyaltyOf, pointsOf, redeemPoints } from '../../lib/loyalty';

export default function DocDetailScreen({ kind }: { kind: DocKind }) {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner, settings, profile, ledger, upiIds, perms } = useBusiness();
  const deliveryCam = useRef<HTMLInputElement>(null);
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [menu, setMenu] = useState(false);
  const [payOpen, setPayOpen] = useState<'payment' | 'refund' | null>(null);
  const [creditPay, setCreditPay] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState<'take' | 'refund' | null>(null);
  const printer = usePrint();
  const [receipt, setReceipt] = useState<string | null>(null);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = DOC_BASE[kind];

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
  // A credit note's settlement: refunded, or kept as credit (and what's left).
  const settlement = useLiveQuery(async () => (kind === 'credit' && doc && doc.status === 'saved' ? settlementOf(doc as CreditNote) : undefined), [kind, doc, ledger]);
  // An estimate's advance (taken, less used or returned).
  const progress = useLiveQuery(async () => (kind === 'estimate' && doc && (doc as Estimate).order && doc.status !== 'draft' ? orderProgress(doc as Estimate) : null), [kind, doc, ledger]);
  const consign = useLiveQuery(async () => (kind === 'estimate' && doc && (doc as Estimate).consignment && doc.status !== 'draft' ? consignmentProgress(doc as Estimate) : null), [kind, doc, ledger]);
  const estAdvance = useLiveQuery(async () => (kind === 'estimate' && id ? jobAdvance(actor.businessId, id) : 0), [kind, id, actor.businessId, ledger]);
  // Money the customer left on account, to use on this bill.
  const customerId = kind === 'invoice' ? (doc as Invoice | undefined)?.billTo?.customerId : undefined;
  const points = useLiveQuery(async () => (kind === 'invoice' && customerId && loyaltyOf(settings).enabled ? (await pointsOf(actor.businessId, customerId)).balance : 0), [kind, customerId, settings, ledger]);
  const advance = useLiveQuery(async () => {
    const c = customerId ? await db.customers.get(customerId) : undefined;
    return c ? (await khataOf(actor.businessId, c)).advance : 0;
  }, [customerId, actor.businessId, ledger]);
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
  // "Keep as credit" settles through a return credit note: this one, or the bill's last one.
  const keepNote = note?.status === 'saved' ? note : (creditNotes ?? []).filter((n) => n.status === 'saved').slice(-1)[0];
  const upi = upiIds.find((u) => u.id === billForMoney?.upiIdId) ?? upiIds.find((u) => u.isDefault) ?? upiIds[0] ?? null;
  const view = gstViewOf(kind, doc, doc.businessSnapshot ?? profile, doc.totals);
  const canEdit =
    (kind === 'estimate' || CAN_CREATE_INVOICES) &&
    (doc.status === 'draft' || (doc.status !== 'cancelled' && doc.status !== 'converted' && (isOwner || (est != null && doc.createdBy === actor.userId))));

  // The invoice link is placed wherever the language puts it in the sentence.
  const [againstBefore, againstAfter = ''] = note ? t('Against invoice {number} of {date}', { date: dateIN(note.invoiceDate) }).split('{number}') : ['', ''];

  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : t('Something went wrong'), duration: 2500, color: 'danger' });

  async function makePdf() {
    return renderPdf(await pdfInputFor(kind, doc!, settings));
  }

  /** With a phone number: straight into that WhatsApp chat with the PDF; else the share sheet. */
  async function onShare(phone?: string) {
    setBusy(phone ? 'wa' : 'share');
    try {
      const pdf = await makePdf();
      const text = inv
        ? `${profile.name}: ${view.title} ${doc!.number} for ${rupees(inv.totals.grandTotal)}${pending > 0 ? `. Pending ${rupees(pending)}.` : '.'}`
        : `${profile.name}: ${view.title} ${doc!.number}`;
      const r = phone ? await sendOnWhatsApp(phone, pdfFileName(kind, doc!), pdf.blob, text) : await sharePdf(pdfFileName(kind, doc!), pdf, text);
      if (r === 'downloaded') void toast({ message: t('PDF downloaded'), duration: 1500 });
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
    ...(canEdit ? [{ text: t('Edit'), handler: () => router.push(`${base}/${doc.id}/edit`) }] : []),
    ...(inv && inv.status === 'saved' && CAN_CREATE_INVOICES && (money?.due ?? 0) > 0
      ? [
          {
            text: isOwner ? t('Return items / credit note') : t('Return items'),
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
            text: t('Cancel credit note'),
            role: 'destructive' as const,
            handler: () =>
              void alert({
                header: t('Cancel {number}?', { number: doc.number }),
                message: t('The number is kept and the amount goes back onto invoice {number}. This cannot be undone.', { number: note.invoiceNumber }),
                inputs: [{ name: 'reason', placeholder: t('Reason (optional)') }],
                buttons: [
                  { text: t('Keep'), role: 'cancel' },
                  { text: t('Cancel credit note'), role: 'destructive', handler: (v: { reason?: string }) => void cancelCreditNote(actor, doc.id, v.reason).catch(fail) },
                ],
              }),
          },
        ]
      : []),
    ...(inv && CAN_CREATE_INVOICES
      ? [
          {
            text: t('Duplicate'),
            handler: () =>
              void duplicateInvoice(actor, doc.id)
                .then((d) => router.push(`/tabs/invoices/${d.id}/edit`))
                .catch(fail),
          },
        ]
      : []),
    ...(est && est.status !== 'draft' && est.status !== 'converted'
      ? [
          { text: t('Mark accepted'), handler: () => void setEstimateStatus(actor, doc.id, 'accepted') },
          { text: t('Mark declined'), handler: () => void setEstimateStatus(actor, doc.id, 'declined') },
        ]
      : []),
    ...(inv && inv.status === 'saved' && (isOwner || perms.cancelBills)
      ? [
          {
            text: t('Cancel invoice'),
            role: 'destructive' as const,
            handler: () =>
              void alert({
                header: t('Cancel {number}?', { number: doc.number }),
                message: t('The number is kept and the invoice is marked CANCELLED. This cannot be undone.'),
                inputs: [{ name: 'reason', placeholder: t('Reason (optional)') }],
                buttons: [
                  { text: t('Keep'), role: 'cancel' },
                  { text: t('Cancel invoice'), role: 'destructive', handler: (v: { reason?: string }) => void cancelInvoice(actor, doc.id, v.reason).catch(fail) },
                ],
              }),
          },
        ]
      : []),
    ...(doc.status === 'draft'
      ? [
          {
            text: t('Delete draft'),
            role: 'destructive' as const,
            handler: () =>
              void deleteDraft(actor, kind, doc.id)
                .then(() => router.push(base, 'back', 'replace'))
                .catch(fail),
          },
        ]
      : []),
    { text: t('Close'), role: 'cancel' as const },
  ];

  return (
    <PageShell title={doc.number || (kind === 'invoice' ? t('Invoice draft') : kind === 'estimate' ? t('Estimate draft') : t('Credit note draft'))} backHref={base} padded={false}>
      <IonCard>
        <IonCardContent>
          <div className="detail-head">
            <div>
              <h2>{doc.billTo?.name ?? t('No customer')}</h2>
              <p>
                {titleIn(view.title, appLanguage())} {doc.number || t('(draft)')} · {dateIN(doc.date)}
                {inv?.dueDate ? ` · ${t('due {date}', { date: dateIN(inv.dueDate) })}` : ''}
              </p>
              {view.mode === 'gst' && view.pos && (
                <p>
                  {t('Place of supply {place}', { place: view.posLabel })} · {view.interState ? 'IGST' : `CGST + ${view.sgstName}`}
                </p>
              )}
              {doc.deliveryDate && (
                <p>
                  {t('Delivery {date}', { date: dateIN(doc.deliveryDate) })}
                  {doc.deliveryAssignee ? ` · ${doc.deliveryAssignee.name}` : ''}
                  {doc.deliveredAt ? ` · ${doc.deliveredByName ? t('delivered by {name}', { name: doc.deliveredByName }) : t('delivered')}` : ''}
                </p>
              )}
              {note && (
                <p>
                  {againstBefore}
                  <a onClick={() => router.push(`/tabs/invoices/${note.invoiceId}`)}>{note.invoiceNumber}</a>
                  {againstAfter}
                </p>
              )}
            </div>
            {inv ? <StatusBadge invoice={inv} /> : est ? <StatusBadge estimate={est} /> : <StatusBadge creditNote={note!} />}
          </div>
          <div className="detail-total">
            <span>{t('Total')}</span>
            <strong>{rupees(doc.totals.grandTotal)}</strong>
          </div>
          {money && money.credited > 0 && (
            <div className="detail-pay">
              <div>
                <span>{t('Credit notes')}</span> <strong>−{rupees(money.credited)}</strong>
              </div>
            </div>
          )}
          {money && inv?.status === 'saved' && (
            <div className="detail-pay">
              <div>
                <span>{t('Paid')}</span> <strong>{rupees(money.paid)}</strong>
              </div>
              <div>
                <span>{t('Pending')}</span> <strong className={pending ? 'text-danger' : ''}>{rupees(pending)}</strong>
              </div>
            </div>
          )}
          {settlement && settlement.state !== 'open' && (
            <p className={settlement.state === 'credit' ? 'text-success' : undefined}>
              {settlement.state === 'refunded' ? t('Refunded to the customer') : t('Kept as credit · {amount} left to use', { amount: rupees(settlement.left) })}
            </p>
          )}
          {progress && (
            <div className="order-progress">
              <p>
                <strong>{orderStateLabel(progress.state)}</strong>
                {progress.pendingValue > 0 ? ` · ${t('{amount} still to deliver', { amount: rupees(progress.pendingValue) })}` : ''}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>{t('Item')}</th>
                    <th>{t('Ordered')}</th>
                    <th>{t('Delivered')}</th>
                    <th>{t('Pending')}</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.lines.map((l) => (
                    <tr key={l.lineId}>
                      <td>{l.name}</td>
                      <td>{l.ordered}</td>
                      <td>{l.delivered}</td>
                      <td className={l.pending > 0 ? 'text-danger' : 'text-success'}>{l.pending}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {progress.bills.map((b) => (
                <IonButton key={b.id} size="small" fill="clear" routerLink={`/tabs/invoices/${b.id}`}>
                  {b.number || t('Draft')} · {dateIN(b.date)}
                </IonButton>
              ))}
            </div>
          )}
          {consign && (
            <div className="order-progress">
              <p>
                <strong>{consign.settled ? t('Settled') : t('Sale or return')}</strong>
                {consign.outValue > 0 ? ` · ${t('{amount} still with them', { amount: rupees(consign.outValue) })}` : ''}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>{t('Item')}</th>
                    <th>{t('Sent')}</th>
                    <th>{t('Sold')}</th>
                    <th>{t('Back')}</th>
                    <th>{t('With them')}</th>
                  </tr>
                </thead>
                <tbody>
                  {consign.lines.map((l) => (
                    <tr key={l.lineId}>
                      <td>{l.name}</td>
                      <td>{l.sent}</td>
                      <td>{l.sold}</td>
                      <td>{l.returned}</td>
                      <td className={l.out > 0 ? 'text-danger' : 'text-success'}>{l.out}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {consign.bills.map((b) => (
                <IonButton key={b.id} size="small" fill="clear" routerLink={`/tabs/invoices/${b.id}`}>
                  {b.number || t('Draft')} · {dateIN(b.date)}
                </IonButton>
              ))}
              {!consign.settled && CAN_CREATE_INVOICES && (
                <IonButton
                  size="small"
                  fill="outline"
                  onClick={() =>
                    void alert({
                      header: t('Goods came back'),
                      inputs: consign.lines
                        .filter((l) => l.out > 0)
                        .map((l) => ({ name: l.lineId, type: 'number' as const, placeholder: `${l.name} (${t('max {n}', { n: l.out })})`, min: 0, max: l.out })),
                      buttons: [
                        { text: t('Cancel'), role: 'cancel' },
                        {
                          text: t('Save'),
                          handler: (v: Record<string, string>) =>
                            void takeBackConsignment(actor, doc.id, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x) || 0])))
                              .then((n) => void (n && toast({ message: t('Stock taken back'), duration: 1500, position: 'top', color: 'success' })))
                              .catch(fail),
                        },
                      ],
                    })
                  }
                >
                  {t('Goods came back')}
                </IonButton>
              )}
            </div>
          )}
          {est && (estAdvance ?? 0) > 0 && <p className="text-success">{t("Advance received: {amount}, kept for this estimate's bill only", { amount: rupees(estAdvance ?? 0) })}</p>}
          {refundDue > 0 && (
            <p className="text-danger">
              {note
                ? t('{amount} was paid more than is now due on invoice {number}: refund it to the customer.', { amount: rupees(refundDue), number: note.invoiceNumber })
                : t('{amount} was paid more than is now due: refund it to the customer.', { amount: rupees(refundDue) })}
            </p>
          )}

          <div className="detail-actions">
            {doc.billTo?.phone && (
              <IonButton color="success" onClick={() => void onShare(doc.billTo!.phone)} disabled={!!busy}>
                {busy === 'wa' ? <IonSpinner name="dots" /> : <IonIcon icon={logoWhatsapp} slot="start" />} WhatsApp
              </IonButton>
            )}
            <IonButton fill={doc.billTo?.phone ? 'outline' : 'solid'} onClick={() => void onShare()} disabled={!!busy}>
              {busy === 'share' ? <IonSpinner name="dots" /> : <IonIcon icon={shareSocialOutline} slot="start" />} {t('Share PDF')}
            </IonButton>
            <IonButton fill="outline" onClick={() => void makePdf().then((pdf) => printPdfFile(pdfFileName(kind, doc), pdf.blob, `${view.title} ${doc.number}`)).catch(fail)} disabled={!!busy}>
              <IonIcon icon={documentOutline} slot="start" /> {t('Print A4')}
            </IonButton>
            {doc.status !== 'draft' && kind !== 'estimate' && (
              <IonButton
                fill="outline"
                disabled={printer.busy}
                onClick={() =>
                  printer.canPrint
                    ? void printer.print(kind, doc)
                    : void printer
                        .preview(kind, doc)
                        .then(setReceipt)
                        .catch(fail)
                }
              >
                {printer.busy ? <IonSpinner name="dots" /> : <IonIcon icon={printOutline} slot="start" />} {printer.canPrint ? t('Print') : t('Receipt')}
              </IonButton>
            )}
            <IonButton fill="outline" onClick={() => void onPreview()} disabled={!!busy}>
              {busy === 'preview' ? <IonSpinner name="dots" /> : <IonIcon icon={eyeOutline} slot="start" />} {t('Preview')}
            </IonButton>
            {inv && inv.status === 'saved' && pending > 0 && (
              <IonButton fill="outline" onClick={() => setPayOpen('payment')}>
                <IonIcon icon={walletOutline} slot="start" /> {t('Record payment')}
              </IonButton>
            )}
            {inv && inv.status === 'saved' && pending > 0 && (advance ?? 0) > 0 && CAN_CREATE_INVOICES && (
              <IonButton
                fill="outline"
                color="success"
                onClick={() =>
                  void db.customers
                    .get(customerId!)
                    .then((c) => c && applyAdvance(actor, c, inv, Math.min(pending, advance ?? 0)))
                    .catch(fail)
                }
              >
                <IonIcon icon={walletOutline} slot="start" /> {t('Use advance {amount}', { amount: rupees(Math.min(pending, advance ?? 0)) })}
              </IonButton>
            )}
            {!doc.deliveredAt && (doc.deliveryDate || est?.challan || perms.access === 'warehouse') && (inv?.status === 'saved' || (est && est.status !== 'draft' && est.status !== 'converted')) && (
              <IonButton
                fill="outline"
                color="success"
                onClick={() => (perms.access === 'warehouse' ? deliveryCam.current?.click() : void markDelivered(actor, kind as 'invoice' | 'estimate', doc.id).catch(fail))}
              >
                {t('Mark delivered')}
              </IonButton>
            )}
            {!doc.deliveredAt && perms.access !== 'warehouse' && (doc.deliveryDate || est?.challan) && (inv?.status === 'saved' || (est && est.status !== 'draft' && est.status !== 'converted')) && (
              <IonButton fill="clear" color="success" onClick={() => deliveryCam.current?.click()}>
                <IonIcon icon={cameraOutline} slot="start" /> {t('Delivered, with photo')}
              </IonButton>
            )}
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
            {refundDue > 0 && CAN_CREATE_INVOICES && billForMoney && (
              <IonButton fill="outline" color="success" routerLink={`/tabs/sale?exchange=${billForMoney.id}`}>
                <IonIcon icon={swapHorizontalOutline} slot="start" /> {t('Exchange: new bill')}
              </IonButton>
            )}
            {refundDue > 0 && CAN_CREATE_INVOICES && (
              <IonButton fill="outline" color="danger" onClick={() => setPayOpen('refund')}>
                <IonIcon icon={walletOutline} slot="start" /> {t('Refund {amount}', { amount: rupees(refundDue) })}
              </IonButton>
            )}
            {refundDue > 0 && CAN_CREATE_INVOICES && keepNote && (
              <IonButton fill="outline" onClick={() => void keepAsCredit(actor, keepNote).catch(fail)}>
                <IonIcon icon={walletOutline} slot="start" /> {t('Keep {amount} as credit', { amount: rupees(refundDue) })}
              </IonButton>
            )}
            {inv && inv.status === 'saved' && pending > 0 && CAN_CREATE_INVOICES && (
              <IonButton fill="outline" onClick={() => setCreditPay(true)}>
                {t('Pay with credit note')}
              </IonButton>
            )}
            {est && est.status !== 'draft' && est.status !== 'converted' && (
              <IonButton fill="outline" onClick={() => setAdvanceOpen('take')}>
                <IonIcon icon={walletOutline} slot="start" /> {t('Take advance')}
              </IonButton>
            )}
            {est && (estAdvance ?? 0) > 0 && est.status !== 'converted' && (
              <IonButton fill="clear" color="danger" onClick={() => setAdvanceOpen('refund')}>
                {t('Return advance')}
              </IonButton>
            )}
            {est && (estAdvance ?? 0) > 0 && est.status !== 'converted' && isOwner && est.billTo?.customerId && (
              <IonButton
                fill="clear"
                onClick={() =>
                  void releaseAdvance(actor, est)
                    .then((a) => void (a > 0 && toast({ message: t("Moved to the customer's advance"), duration: 1800, position: 'top', color: 'success' })))
                    .catch(fail)
                }
              >
                {t("Move to customer's advance")}
              </IonButton>
            )}
            {inv && inv.status === 'saved' && pending > 0 && (points ?? 0) >= loyaltyOf(settings).minRedeem && CAN_CREATE_INVOICES && (
              <IonButton
                fill="outline"
                color="tertiary"
                onClick={() =>
                  void redeemPoints(actor, inv, points!, settings)
                    .then((p) => void (p && toast({ message: t('{n} points used', { n: p.points ?? 0 }), duration: 1500, position: 'top', color: 'success' })))
                    .catch(fail)
                }
              >
                {t('Use {n} points ({amount})', { n: Math.min(points!, Math.floor(pending / loyaltyOf(settings).pointValue)), amount: rupees(Math.min(points! * loyaltyOf(settings).pointValue, pending - (pending % loyaltyOf(settings).pointValue))) })}
              </IonButton>
            )}
            {inv && pending > 0 && (
              <IonButton fill="outline" color="success" onClick={onReminder}>
                <IonIcon icon={logoWhatsapp} slot="start" /> {t('Remind')}
              </IonButton>
            )}
            {est && est.status !== 'draft' && est.status !== 'converted' && CAN_CREATE_INVOICES && (!est.order || (progress && progress.state !== 'done' && progress.state !== 'closed')) && (!est.consignment || (consign && !consign.settled)) && (
              <IonButton
                color="success"
                onClick={() =>
                  void convertEstimate(actor, est.id)
                    .then((d) => router.push(`/tabs/invoices/${d.id}/edit`))
                    .catch(fail)
                }
              >
                {est.consignment ? t('Bill what was sold') : est.order ? (progress?.state === 'part' ? t('Bill the rest') : t('Make bill')) : t('Convert to invoice')}
              </IonButton>
            )}
            {est?.convertedInvoiceId && (
              <IonButton fill="outline" routerLink={`/tabs/invoices/${est.convertedInvoiceId}`}>
                {t('Open invoice')}
              </IonButton>
            )}
            {canEdit && (
              <IonButton fill="clear" routerLink={`${base}/${doc.id}/edit`}>
                <IonIcon icon={createOutline} slot="start" /> {t('Edit')}
              </IonButton>
            )}
          </div>
        </IonCardContent>
      </IonCard>

      {preview && <PdfPreview blob={preview} />}
      {receipt && (
        <div className="receipt-preview" onClick={() => setReceipt(null)}>
          <img src={receipt} alt={t('Receipt')} />
          <p className="section-note">{t('Thermal receipt preview. Printing works in the Android app. Tap to close.')}</p>
        </div>
      )}

      {est?.job && (
        <IonButton fill="outline" expand="block" routerLink={`/tabs/jobs/${est.id}`}>
          {t('Work order: {stage}', { stage: stageLabel(est.job.stage) })}
        </IonButton>
      )}
      {doc.privateNotes && (
        <p className="private-notes">
          <strong>{t('Notes for us')}:</strong> {doc.privateNotes}
        </p>
      )}
      {doc.deliveryPhoto && (
        <div className="ion-padding-horizontal">
          <p className="section-note">{t('Delivery photo')}{doc.deliveredByName ? ` · ${doc.deliveredByName}` : ''}</p>
          <img src={doc.deliveryPhoto} alt="" className="delivery-photo" />
        </div>
      )}
      {(kind !== 'credit' || (doc.photos?.length ?? 0) > 0) && perms.access !== 'warehouse' && perms.access !== 'readonly' && (
        <DocPhotos
          photos={doc.photos ?? []}
          canAdd={doc.status !== 'cancelled'}
          onChange={(photos) => void putRecord(kind === 'invoice' ? 'invoices' : 'estimates', actor, { ...(doc as Invoice), photos }).catch(fail)}
        />
      )}
      {money && money.entries.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Payments')}</IonLabel>
          </IonListHeader>
          {money.entries.map((e) => (
            <IonItem key={e.id} lines="full">
              <IonLabel className={e.voidedAt ? 'voided' : undefined}>
                <h3>
                  {e.kind === 'refund' ? t('Refund') : t('Received')} · {modeLabel(e.mode)}
                  {e.reference ? ` · ${e.reference}` : ''}
                </h3>
                <p>
                  {dateIN(e.date)}
                  {e.receivedByName ? ` · ${e.receivedByName}` : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
                {e.voidedAt && (
                  <p className="text-danger">
                    {e.voidedByName ? t('Voided by {name}: {reason}', { name: e.voidedByName, reason: e.voidReason ?? '' }) : t('Voided: {reason}', { reason: e.voidReason ?? '' })}
                  </p>
                )}
              </IonLabel>
              <IonNote slot="end" className={e.voidedAt ? 'voided' : e.kind === 'refund' ? 'text-danger' : undefined}>
                {e.kind === 'refund' ? '−' : ''}
                {rupees(e.amount)}
              </IonNote>
              {!e.voidedAt && e.kind === 'payment' && e.mode !== 'advance' && e.mode !== 'creditnote' && (
                <IonButton slot="end" fill="clear" size="small" onClick={() => void receiptFor(e.id).then((d) => d && shareReceipt(d)).catch(fail)}>
                  {t('Receipt')}
                </IonButton>
              )}
              {isOwner && !e.voidedAt && (
                <IonButton
                  slot="end"
                  fill="clear"
                  size="small"
                  color="medium"
                  onClick={() =>
                    void alert({
                      header: t('Void {amount} {mode}?', { amount: rupees(e.amount), mode: modeLabel(e.mode) }),
                      message: t('Use this for a mistake. The entry stays in the history, crossed out.'),
                      inputs: [{ name: 'reason', placeholder: t('Reason') }],
                      buttons: [
                        { text: t('Keep'), role: 'cancel' },
                        { text: t('Void'), role: 'destructive', handler: (v: { reason?: string }) => void voidPayment(actor, e.id, v.reason ?? '').catch(fail) },
                      ],
                    })
                  }
                >
                  {t('Void')}
                </IonButton>
              )}
            </IonItem>
          ))}
        </IonList>
      )}

      {creditNotes && creditNotes.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Credit notes')}</IonLabel>
          </IonListHeader>
          {creditNotes.map((n) => (
            <IonItem key={n.id} routerLink={`/tabs/credit-notes/${n.id}`} detail={false}>
              <IonLabel>
                <h3>{n.number || t('Draft')}</h3>
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
          <IonLabel>{t('Items')}</IonLabel>
        </IonListHeader>
        {doc.lines.map((l, i) => (
          <IonItem key={l.id}>
            <IonLabel>
              <h3>{l.name}</h3>
              {lineSize(l) && <p>{lineSize(l)}</p>}
              <p>
                {l.qty} {l.unit} × {rupees(l.rate)}
                {view.mode === 'none' ? '' : ` · ${t('tax {pct}%', { pct: l.taxPct })}`}
                {l.hsn && view.mode !== 'none' ? ` · ${t('HSN {code}', { code: l.hsn })}` : ''}
              </p>
            </IonLabel>
            <IonNote slot="end">{rupees(doc.totals.lines[i]?.amount ?? 0)}</IonNote>
          </IonItem>
        ))}
      </IonList>

      <IonList inset>
        <IonListHeader>
          <IonLabel>{t('History')}</IonLabel>
        </IonListHeader>
        {[...doc.history].reverse().map((h, i) => (
          <IonItem key={i} lines="none">
            <IonLabel>
              <p>
                <strong>{h.action}</strong>
                {h.detail ? ` — ${h.detail}` : ''}
              </p>
              <p>
                {h.byName || t('Someone')} · {new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </IonLabel>
          </IonItem>
        ))}
      </IonList>

      <IonButtons className="detail-more">
        <IonButton onClick={() => setMenu(true)}>
          <IonIcon icon={ellipsisVertical} slot="start" /> {t('More actions')}
        </IonButton>
      </IonButtons>
      <IonActionSheet isOpen={menu} onDidDismiss={() => setMenu(false)} buttons={menuButtons} />

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
          amount={advanceOpen === 'refund' ? (estAdvance ?? 0) : undefined}
          max={advanceOpen === 'refund' ? (estAdvance ?? 0) : undefined}
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
