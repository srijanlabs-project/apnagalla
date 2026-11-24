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
import { db, type Estimate, type Invoice } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { pdfFileName, pdfInputFor, renderPdf, sharePdf } from '../../lib/pdf';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { cancelInvoice, convertEstimate, deleteDraft, duplicateInvoice, pendingAmount, setEstimateStatus, updatePayment } from '../../lib/repo';
import PaymentModal from './PaymentModal';

type Kind = 'invoice' | 'estimate';

export default function DocDetailScreen({ kind }: { kind: Kind }) {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner, settings, profile } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [menu, setMenu] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const base = kind === 'invoice' ? '/tabs/invoices' : '/tabs/estimates';

  const doc = useLiveQuery(() => (kind === 'invoice' ? db.invoices.get(id!) : db.estimates.get(id!)) as Promise<Invoice | Estimate | undefined>, [id, kind]);
  if (!doc) return null;
  const inv = kind === 'invoice' ? (doc as Invoice) : null;
  const est = kind === 'estimate' ? (doc as Estimate) : null;
  const pending = inv ? pendingAmount(inv) : 0;
  const canEdit =
    (kind !== 'invoice' || CAN_CREATE_INVOICES) &&
    (doc.status === 'draft' || (doc.status !== 'cancelled' && doc.status !== 'converted' && (isOwner || (est != null && doc.createdBy === actor.userId))));

  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : 'Something went wrong', duration: 2500, color: 'danger' });

  async function makePdf() {
    return renderPdf(await pdfInputFor(kind, doc!, settings));
  }

  async function onShare() {
    setBusy('share');
    try {
      const pdf = await makePdf();
      const text = inv ? `${profile.name}: Invoice ${doc!.number} for ${rupees(inv.totals.grandTotal)}${pending > 0 ? `. Pending ${rupees(pending)}.` : '.'}` : `${profile.name}: Estimate ${doc!.number}`;
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
    <PageShell title={doc.number || 'Draft'} backHref={base} padded={false}>
      <IonCard>
        <IonCardContent>
          <div className="detail-head">
            <div>
              <h2>{doc.billTo?.name ?? 'No customer'}</h2>
              <p>
                {kind === 'invoice' ? 'Invoice' : 'Estimate'} {doc.number || '(draft)'} · {dateIN(doc.date)}
                {inv?.dueDate ? ` · due ${dateIN(inv.dueDate)}` : ''}
              </p>
            </div>
            {inv ? <StatusBadge invoice={inv} /> : <StatusBadge estimate={est!} />}
          </div>
          <div className="detail-total">
            <span>Total</span>
            <strong>{rupees(doc.totals.grandTotal)}</strong>
          </div>
          {inv && inv.status === 'saved' && (
            <div className="detail-pay">
              <div>
                <span>Paid</span> <strong>{rupees(inv.payment.amountPaid)}</strong>
              </div>
              <div>
                <span>Pending</span> <strong className={pending ? 'text-danger' : ''}>{rupees(pending)}</strong>
              </div>
            </div>
          )}

          <div className="detail-actions">
            <IonButton onClick={() => void onShare()} disabled={!!busy}>
              {busy === 'share' ? <IonSpinner name="dots" /> : <IonIcon icon={shareSocialOutline} slot="start" />} Share PDF
            </IonButton>
            <IonButton fill="outline" onClick={() => void onPreview()} disabled={!!busy}>
              {busy === 'preview' ? <IonSpinner name="dots" /> : <IonIcon icon={eyeOutline} slot="start" />} Preview
            </IonButton>
            {inv && inv.status === 'saved' && (
              <IonButton fill="outline" onClick={() => setPayOpen(true)}>
                <IonIcon icon={walletOutline} slot="start" /> Payment
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

      <IonList inset>
        <IonListHeader>
          <IonLabel>Items</IonLabel>
        </IonListHeader>
        {doc.lines.map((l, i) => (
          <IonItem key={l.id}>
            <IonLabel>
              <h3>{l.name}</h3>
              <p>
                {l.qty} {l.unit} × {rupees(l.rate)} · tax {l.taxPct}%
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

      {inv && (
        <PaymentModal
          invoice={inv}
          isOpen={payOpen}
          isOwner={isOwner}
          onClose={() => setPayOpen(false)}
          onSave={(p) =>
            void updatePayment(actor, inv.id, p)
              .then(() => {
                setPayOpen(false);
                void toast({ message: 'Payment updated', duration: 1200, color: 'success' });
              })
              .catch(fail)
          }
        />
      )}
    </PageShell>
  );
}
