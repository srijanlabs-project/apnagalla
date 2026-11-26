import { IonButton, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { useEffect, useState } from 'react';
import PageShell from '../../components/PageShell';
import { api, type ActivityRow } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';

const TABLE: Record<string, () => string> = {
  invoices: () => t('Invoice'),
  estimates: () => t('Estimate'),
  creditNotes: () => t('Credit note'),
  customers: () => t('Customer'),
  suppliers: () => t('Supplier'),
  items: () => t('Item'),
  purchases: () => t('Purchase bill'),
  purchaseOrders: () => t('Purchase order'),
  expenses: () => t('Expense'),
};

/** What happened, in plain words. */
function describe(r: ActivityRow): string {
  const d = r.detail as Record<string, unknown>;
  const money = (v: unknown) => (typeof v === 'number' ? rupees(v) : '');
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (r.action) {
    case 'invoice.saved':
      return t('Saved bill {number} for {amount}', { number: s(d.number), amount: money(d.total) });
    case 'invoice.cancelled':
      return t('Cancelled bill {number}', { number: s(d.number) });
    case 'invoice.edited':
      return t('Changed saved bill {number}', { number: s(d.number) });
    case 'credit_note.saved':
      return t('Saved credit note {number}', { number: s(d.number) });
    case 'credit_note.cancelled':
      return t('Cancelled credit note {number}', { number: s(d.number) });
    case 'payment.voided':
      return t('Voided a payment of {amount}', { amount: money(d.amount) });
    case 'payment.refunded':
      return t('Refunded {amount}', { amount: money(d.amount) });
    case 'supplier_payment.voided':
      return t('Voided a supplier payment of {amount}', { amount: money(d.amount) });
    case 'stock.adjusted':
      return t('Changed stock of {item} by {qty}', { item: s(d.itemName), qty: String(d.qty ?? '') });
    case 'stock.change_voided':
      return t('Voided a stock change');
    case 'purchase.cancelled':
      return t('Cancelled purchase bill {ref}', { ref: s(d.supplierBillNo) });
    case 'purchase.edited':
      return t('Changed purchase bill {ref}', { ref: s(d.supplierBillNo) });
    case 'expense.deleted':
      return t('Deleted an expense of {amount}', { amount: money(d.amount) });
    case 'expense.changed':
      return t('Changed an expense from {from} to {to}', { from: money(d.from), to: money(d.to) });
    case 'day.closed_with_difference':
      return t('Closed {date} with a difference of {amount}', { date: s(d.date), amount: money(d.difference) });
    case 'item.price_changed':
      return t('Changed the price of {item} from {from} to {to}', { item: s(d.name), from: money(d.from), to: money(d.to) });
    case 'store.details_changed':
      return t('Changed store settings');
    case 'record.deleted':
      return t('Deleted {what} {name}', { what: TABLE[s(d.table)]?.() ?? s(d.table), name: s(d.name) });
    case 'record.restored':
      return t('Brought back {what} {name}', { what: TABLE[s(d.table)]?.() ?? s(d.table), name: s(d.name) });
    default:
      return r.action;
  }
}

/** Owner: who did what in the store (needs the internet; kept on the server). */
export default function ActivityScreen() {
  const { actor, isOwner } = useBusiness();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = (before?: string) =>
    void api
      .activity(actor.businessId, before)
      .then((r) => {
        setRows((cur) => (before ? [...cur, ...r.rows] : r.rows));
        setMore(r.rows.length === 100);
        setError(null);
      })
      .catch(() => setError(t('The activity log needs the internet.')));
  useEffect(() => {
    if (isOwner) load();
  }, [actor.businessId, isOwner]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isOwner) return <PageShell title={t('Activity log')} backHref="/tabs/more">{t('Only the owner can see this.')}</PageShell>;
  return (
    <PageShell title={t('Activity log')} backHref="/tabs/more" padded={false}>
      {error && <p className="ion-padding text-danger">{error}</p>}
      <IonList>
        {rows.map((r, i) => (
          <IonItem key={i} lines="full">
            <IonLabel className="ion-text-wrap">
              <h3>{describe(r)}</h3>
              <p>{r.by}</p>
            </IonLabel>
            <IonNote slot="end" className="ion-text-end">
              {new Date(r.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </IonNote>
          </IonItem>
        ))}
      </IonList>
      {more && rows.length > 0 && (
        <IonButton fill="clear" expand="block" onClick={() => load(rows[rows.length - 1]!.at)}>
          {t('Show older')}
        </IonButton>
      )}
    </PageShell>
  );
}
