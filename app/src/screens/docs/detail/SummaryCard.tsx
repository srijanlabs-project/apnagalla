import { useIonRouter } from '@ionic/react';
import type { ReactNode } from 'react';
import StatusBadge from '../../../components/StatusBadge';
import type { CreditNote, Estimate, Invoice } from '../../../lib/db';
import { dateIN, rupees } from '../../../lib/format';
import type { gstViewOf } from '../../../lib/gstView';
import { titleIn } from '../../../lib/gstView';
import { appLanguage, t } from '../../../lib/i18n';
import type { moneyOf } from '../../../lib/ledger';

/** The bill at a glance: who, which document, total / paid / pending, and anything that needs doing next. */
export default function SummaryCard({
  doc,
  inv,
  est,
  note,
  money,
  view,
  settlement,
  refundDue,
  estAdvance,
  children,
}: {
  doc: Invoice | Estimate | CreditNote;
  inv: Invoice | null;
  est: Estimate | null;
  note: CreditNote | null;
  money: ReturnType<typeof moneyOf> | null;
  view: ReturnType<typeof gstViewOf>;
  settlement?: { state: string; left: number } | null;
  refundDue: number;
  estAdvance: number;
  /** "Next step" buttons that apply right now (delivery, refund…). */
  children?: ReactNode;
}) {
  const router = useIonRouter();
  const pending = money?.pending ?? 0;
  // The invoice link is placed wherever the language puts it in the sentence.
  const [againstBefore, againstAfter = ''] = note ? t('Against invoice {number} of {date}', { date: dateIN(note.invoiceDate) }).split('{number}') : ['', ''];
  return (
    <section className="bill-card">
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

      {money && inv?.status === 'saved' ? (
        <div className="bill-figures">
          <div>
            <span>{t('Total')}</span>
            <strong>{rupees(doc.totals.grandTotal)}</strong>
          </div>
          <div>
            <span>{t('Paid')}</span>
            <strong>{rupees(money.paid)}</strong>
          </div>
          <div>
            <span>{t('Pending')}</span>
            <strong className={pending ? 'text-danger' : 'text-success'}>{rupees(pending)}</strong>
          </div>
        </div>
      ) : (
        <div className="detail-total">
          <span>{t('Total')}</span>
          <strong>{rupees(doc.totals.grandTotal)}</strong>
        </div>
      )}
      {money && money.credited > 0 && <p className="section-note">{t('Credit notes')} −{rupees(money.credited)}</p>}
      {settlement && settlement.state !== 'open' && (
        <p className={settlement.state === 'credit' ? 'text-success' : undefined}>
          {settlement.state === 'refunded' ? t('Refunded to the customer') : t('Kept as credit · {amount} left to use', { amount: rupees(settlement.left) })}
        </p>
      )}
      {est && estAdvance > 0 && <p className="text-success">{t("Advance received: {amount}, kept for this estimate's bill only", { amount: rupees(estAdvance) })}</p>}
      {refundDue > 0 && (
        <p className="text-danger">
          {note
            ? t('{amount} was paid more than is now due on invoice {number}: refund it to the customer.', { amount: rupees(refundDue), number: note.invoiceNumber })
            : t('{amount} was paid more than is now due: refund it to the customer.', { amount: rupees(refundDue) })}
        </p>
      )}
      {children && <div className="bill-next">{children}</div>}
    </section>
  );
}
