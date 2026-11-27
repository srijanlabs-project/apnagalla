import { IonButton, IonIcon, IonSpinner, useIonAlert, useIonRouter, useIonToast } from '@ionic/react';
import { formatDateIN } from '@invoice/shared';

import { ellipsisHorizontal, logoWhatsapp, shareSocialOutline, swapHorizontalOutline, walletOutline } from 'ionicons/icons';
import { useRef, useState, type ReactNode } from 'react';

import { api } from '../../../lib/api';
import { useBusiness } from '../../../lib/business';

import { keepAsCredit } from '../../../lib/credit';
import { db, type CreditNote, type Estimate, type Invoice } from '../../../lib/db';
import { markDelivered } from '../../../lib/deliveries';
import { rupees } from '../../../lib/format';

import { t } from '../../../lib/i18n';
import { releaseAdvance, stageLabel } from '../../../lib/jobs';
import { applyAdvance } from '../../../lib/khata';

import { loyaltyOf, redeemPoints } from '../../../lib/loyalty';

import { pdfFileName, pdfInputFor, renderPdf, sharePdf } from '../../../lib/pdf';
import { CAN_CREATE_INVOICES } from '../../../lib/platform';
import { cancelCreditNote, cancelInvoice, convertEstimate, deleteDraft, duplicateInvoice, newCreditNoteDraft, recordPayments, saveCreditNote, setEstimateStatus } from '../../../lib/repo';
import { checkVoucherOnline, payWithVoucher } from '../../../lib/retailExtras';
import { extraOn } from '../../../lib/shopExtras';
import { printPdfFile, sendOnWhatsApp } from '../../../lib/shopTools';
import { usePrint } from '../../../lib/usePrint';
import { DOC_BASE } from '../DocEditorScreen';
import { billMenu } from './billMenu';

import type { BillData } from './BillView';

type Derived = {
  inv: Invoice | null;
  est: Estimate | null;
  note: CreditNote | null;
  money: any;
  pending: any;
  billForMoney: any;
  billMoneyNow: any;
  refundDue: any;
  keepNote: any;
  upi: any;
  view: any;
  canEdit: any;
  canTakePayment: any;
  estOpen: any;
  canConvert: any;
  canDeliver: any;
  phone: any;
  pointValue: any;
};

/** Everything the bill's buttons do: share, print, pay, return, cancel… and which buttons show. */
export function useBillActions(p: BillData, d: Derived) {
  const { kind, doc, progress, estAdvance, points, advance, emailOn } = p;
  const { inv, est, note, money, pending, billForMoney, refundDue, keepNote, view, canEdit, canTakePayment, estOpen, canConvert, canDeliver, phone, pointValue } = d;
  const { actor, isOwner, settings, profile, perms } = useBusiness();
  const customerId = inv?.billTo?.customerId;
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

  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : t('Something went wrong'), duration: 2500, color: 'danger' });
  const done = (message: string) => void toast({ message, duration: 1500, position: 'top', color: 'success' });
  const makePdf = async () => renderPdf(await pdfInputFor(kind, doc, settings));

  /** With a phone number: straight into that WhatsApp chat with the PDF; else the share sheet. */
  async function onShare(to?: string) {
    setBusy(to ? 'wa' : 'share');
    try {
      const pdf = await makePdf();
      const text = inv
        ? `${profile.name}: ${view.title} ${doc!.number} for ${rupees(inv.totals.grandTotal)}${pending > 0 ? `. Pending ${rupees(pending)}.` : '.'}`
        : `${profile.name}: ${view.title} ${doc!.number}`;
      const r = to ? await sendOnWhatsApp(to, pdfFileName(kind, doc!), pdf.blob, text) : await sharePdf(pdfFileName(kind, doc!), pdf, text);
      if (r === 'downloaded') void toast({ message: t('PDF downloaded'), duration: 1500 });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  /** Email the PDF from the store (the server sends it; needs the internet). */
  function onEmail() {
    void alert({
      header: t('Email the PDF'),
      inputs: [{ name: 'to', type: 'email', value: doc!.billTo?.email ?? '', placeholder: 'name@example.com' }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Send'),
          handler: (v: { to: string }) => {
            const to = v.to.trim();
            if (!/^\S+@\S+\.\S+$/.test(to)) return false;
            setBusy('mail');
            void (async () => {
              try {
                const pdf = await makePdf();
                await api.emailDoc(actor.businessId, {
                  to,
                  subject: `${profile.name}: ${view.title} ${doc!.number}`.slice(0, 160),
                  body: t('Please find {title} {number} attached.\n\n{store}', { title: view.title, number: doc!.number, store: profile.name }),
                  fileName: pdfFileName(kind, doc!).replace(/[^\w .()-]/g, '-'),
                  pdfBase64: pdf.base64,
                });
                done(t('Email sent to {to}', { to }));
              } catch (e) {
                fail(e);
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    });
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
    const msg = settings.reminderTemplate
      .replaceAll('{name}', inv.billTo?.name ?? '')
      .replaceAll('{pending}', (pending / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }))
      .replaceAll('{number}', inv.number)
      .replaceAll('{date}', formatDateIN(inv.date))
      .replaceAll('{business}', profile.name);
    window.open(`https://wa.me/${inv.billTo?.phone?.replace('+', '') ?? ''}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  const askCancel = (header: string, message: string, label: string, run: (reason?: string) => Promise<unknown>) =>
    void alert({
      header,
      message,
      inputs: [{ name: 'reason', placeholder: t('Reason (optional)') }],
      buttons: [
        { text: t('Keep'), role: 'cancel' },
        { text: label, role: 'destructive', handler: (v: { reason?: string }) => void run(v.reason).catch(fail) },
      ],
    });

  const groups = billMenu({
    doc,
    inv,
    est,
    note,
    isOwner,
    canEdit,
    canCancelBills: !!perms.cancelBills,
    isWarehouse: perms.access === 'warehouse',
    canTakePayment,
    pending,
    due: money?.due ?? 0,
    advance,
    pointsLine:
      points >= loyaltyOf(settings).minRedeem
        ? t('Use {n} points ({amount})', { n: Math.min(points, Math.floor(pending / pointValue)), amount: rupees(Math.min(points * pointValue, pending - (pending % pointValue))) })
        : null,
    vouchersOn: extraOn(settings, 'vouchers'),
    emailOn,
    estAdvance,
    printerLabel: printer.canPrint ? t('Print receipt') : t('Receipt'),
    hasPhone: !!phone,
    act: {
      whatsappToNumber: () =>
        void alert({
          header: t('WhatsApp to a number'),
          message: t('Any mobile number: it need not be saved in your phone.'),
          inputs: [{ name: 'phone', type: 'tel', placeholder: t('10-digit mobile number'), value: phone ?? '' }],
          buttons: [
            { text: t('Cancel'), role: 'cancel' },
            {
              text: t('Send'),
              handler: (v: { phone: string }) => {
                const digits = (v.phone ?? '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
                if (!/^[6-9]\d{9}$/.test(digits)) {
                  void toast({ message: t('Enter a 10-digit mobile number'), duration: 2000, color: 'warning' });
                  return false;
                }
                void onShare(`+91${digits}`);
              },
            },
          ],
        }),
      share: () => void onShare(),
      email: onEmail,
      printA4: () => void makePdf().then((pdf) => printPdfFile(pdfFileName(kind, doc), pdf.blob, `${view.title} ${doc.number}`)).catch(fail),
      receipt: () => (printer.canPrint ? void printer.print(kind, doc) : void printer.preview(kind, doc).then(setReceipt).catch(fail)),
      preview: () => void onPreview(),
      useAdvance: () => void db.customers.get(customerId!).then((c) => c && applyAdvance(actor, c, inv!, Math.min(pending, advance))).catch(fail),
      usePoints: () =>
        void redeemPoints(actor, inv!, points, settings)
          .then((p) => void (p && done(t('{n} points used', { n: p.points ?? 0 }))))
          .catch(fail),
      payWithCredit: () => setCreditPay(true),
      payWithVoucher: () =>
        void alert({
          header: t('Pay with gift voucher'),
          inputs: [{ name: 'code', placeholder: 'GV123456' }],
          buttons: [
            { text: t('Cancel'), role: 'cancel' },
            { text: t('Use'), handler: (v: { code: string }) => void checkVoucherOnline(actor.businessId, v.code).then((g) => payWithVoucher(actor, inv!, g.code, Math.min(pending, g.left))).catch(fail) },
          ],
        }),
      oldItem: () =>
        void alert({
          header: t('Old item taken back'),
          message: t('The customer gives an old item (sofa, phone, fridge…) as part payment.'),
          inputs: [
            { name: 'what', placeholder: t('What was taken (e.g. old 3-seater sofa)') },
            { name: 'value', type: 'number', placeholder: t('Value ₹'), min: 0 },
          ],
          buttons: [
            { text: t('Cancel'), role: 'cancel' },
            {
              text: t('Save'),
              handler: (v: { what: string; value: string }) => {
                const amount = Math.round((Number(v.value) || 0) * 100);
                if (!(amount > 0) || !v.what.trim()) return false;
                void recordPayments(actor, inv!.id, [{ mode: 'buyback', amount: Math.min(amount, pending), note: v.what.trim() }]).catch(fail);
              },
            },
          ],
        }),
      deliveredWithPhoto: () => deliveryCam.current?.click(),
      returnAdvance: () => setAdvanceOpen('refund'),
      moveAdvance: () =>
        void releaseAdvance(actor, est!)
          .then((a) => void (a > 0 && done(t("Moved to the customer's advance"))))
          .catch(fail),
      accept: () => void setEstimateStatus(actor, doc.id, 'accepted'),
      decline: () => void setEstimateStatus(actor, doc.id, 'declined'),
      edit: () => router.push(`${base}/${doc.id}/edit`),
      returnItems: () =>
        void newCreditNoteDraft(actor, doc.id)
          .then((n) => saveCreditNote(actor, n, { finalize: false }))
          .then((n) => router.push(`/tabs/credit-notes/${n.id}/edit`))
          .catch(fail),
      duplicate: () =>
        void duplicateInvoice(actor, doc.id)
          .then((d) => router.push(`/tabs/invoices/${d.id}/edit`))
          .catch(fail),
      cancelNote: () =>
        askCancel(
          t('Cancel {number}?', { number: doc.number }),
          t('The number is kept and the amount goes back onto invoice {number}. This cannot be undone.', { number: note?.invoiceNumber ?? '' }),
          t('Cancel credit note'),
          (r) => cancelCreditNote(actor, doc.id, r),
        ),
      cancelInvoice: () =>
        askCancel(t('Cancel {number}?', { number: doc.number }), t('The number is kept and the invoice is marked CANCELLED. This cannot be undone.'), t('Cancel invoice'), (r) => cancelInvoice(actor, doc.id, r)),
      deleteDraft: () =>
        void deleteDraft(actor, kind, doc.id)
          .then(() => router.push(base, 'back', 'replace'))
          .catch(fail),
    },
  });

  // The bottom bar: the main job right now, then one or two more, then More.
  const shareButton = (solid = false) =>
    phone ? (
      <IonButton key="wa" fill={solid ? 'solid' : 'outline'} onClick={() => void onShare(phone)} disabled={!!busy}>
        {busy === 'wa' ? <IonSpinner name="dots" /> : <IonIcon icon={logoWhatsapp} slot="start" />} WhatsApp
      </IonButton>
    ) : (
      <IonButton key="share" fill={solid ? 'solid' : 'outline'} onClick={() => void onShare()} disabled={!!busy}>
        {busy === 'share' ? <IonSpinner name="dots" /> : <IonIcon icon={shareSocialOutline} slot="start" />} {t('Share')}
      </IonButton>
    );
  const bar: ReactNode[] = [];
  if (canTakePayment) {
    bar.push(
      <IonButton key="pay" className="main" onClick={() => setPayOpen('payment')}>
        {t('Record payment')}
      </IonButton>,
      shareButton(),
    );
    if (phone) bar.push(<IonButton key="remind" fill="outline" onClick={onReminder}>{t('Remind')}</IonButton>);
  } else if (canConvert) {
    bar.push(
      <IonButton
        key="convert"
        className="main"
        onClick={() =>
          void convertEstimate(actor, est!.id)
            .then((d) => router.push(`/tabs/invoices/${d.id}/edit`))
            .catch(fail)
        }
      >
        {est!.consignment ? t('Bill what was sold') : est!.order ? (progress?.state === 'part' ? t('Bill the rest') : t('Make bill')) : t('Convert to invoice')}
      </IonButton>,
      shareButton(),
    );
  } else if (doc.status === 'draft' && canEdit) {
    bar.push(
      <IonButton key="edit" className="main" routerLink={`${base}/${doc.id}/edit`}>
        {t('Edit')}
      </IonButton>,
      shareButton(),
    );
  } else {
    bar.push(<span key="s" className="main-wrap">{shareButton(true)}</span>);
    if (!est && doc.status !== 'draft')
      bar.push(
        <IonButton key="print" fill="outline" onClick={() => (printer.canPrint ? void printer.print(kind, doc) : void printer.preview(kind, doc).then(setReceipt).catch(fail))}>
          {printer.canPrint ? t('Print') : t('Receipt')}
        </IonButton>,
      );
  }
  bar.push(
    <IonButton key="more" fill="outline" color="medium" className="more-btn" onClick={() => setMenu(true)} aria-label={t('More')}>
      <IonIcon icon={ellipsisHorizontal} slot="icon-only" />
    </IonButton>,
  );

  // Things that need doing on this bill now, shown on its card.
  const next: ReactNode[] = [];
  if (canDeliver)
    next.push(
      <IonButton
        key="deliver"
        size="small"
        fill="outline"
        onClick={() => (perms.access === 'warehouse' ? deliveryCam.current?.click() : void markDelivered(actor, kind as 'invoice' | 'estimate', doc.id).catch(fail))}
      >
        {t('Mark delivered')}
      </IonButton>,
    );
  if (estOpen && canConvert)
    next.push(
      <IonButton key="adv" size="small" fill="outline" onClick={() => setAdvanceOpen('take')}>
        <IonIcon icon={walletOutline} slot="start" /> {t('Take advance')}
      </IonButton>,
    );
  if (refundDue > 0 && CAN_CREATE_INVOICES) {
    if (billForMoney)
      next.push(
        <IonButton key="exch" size="small" fill="outline" routerLink={`/tabs/sale?exchange=${billForMoney.id}`}>
          <IonIcon icon={swapHorizontalOutline} slot="start" /> {t('Exchange: new bill')}
        </IonButton>,
      );
    next.push(
      <IonButton key="refund" size="small" fill="outline" color="danger" onClick={() => setPayOpen('refund')}>
        {t('Refund {amount}', { amount: rupees(refundDue) })}
      </IonButton>,
    );
    if (keepNote)
      next.push(
        <IonButton key="keep" size="small" fill="outline" onClick={() => void keepAsCredit(actor, keepNote).catch(fail)}>
          {t('Keep {amount} as credit', { amount: rupees(refundDue) })}
        </IonButton>,
      );
  }
  if (est?.convertedInvoiceId)
    next.push(
      <IonButton key="open" size="small" fill="outline" routerLink={`/tabs/invoices/${est.convertedInvoiceId}`}>
        {t('Open invoice')}
      </IonButton>,
    );
  if (est?.job)
    next.push(
      <IonButton key="job" size="small" fill="outline" routerLink={`/tabs/jobs/${est.id}`}>
        {t('Work order: {stage}', { stage: stageLabel(est.job.stage) })}
      </IonButton>,
    );

  return { groups, bar, next, fail, onShare, deliveryCam, menu, setMenu, payOpen, setPayOpen, creditPay, setCreditPay, advanceOpen, setAdvanceOpen, receipt, setReceipt, preview, base };
}
