import { IonButton, IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, IonSegment, IonSegmentButton, useIonAlert, useIonRouter } from '@ionic/react';
import { extraOn } from '../../lib/shopExtras';
import { useIonActionSheet, useIonToast } from '@ionic/react';
import { useEffect, useState } from 'react';
import { NetworkError, api } from '../../lib/api';
import { fileToResizedDataUrl } from '../../lib/format';
import { draftFromPaperBill } from '../../lib/paperBill';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, calendarOutline, closeCircle, documentTextOutline, personOutline, layersOutline, chevronDownOutline } from 'ionicons/icons';
import { useMemo } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import StatusBadge, { estimateStatus, invoiceStatus } from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db, type CreditNote, type Estimate, type Invoice } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { moneyOf } from '../../lib/ledger';
import type { DocKind } from '../../lib/repo';
import { DOC_BASE } from './DocEditorScreen';
import { usePhotoSource } from '../../components/PhotoSource';
import { presetPeriod, type Preset } from '../reports/ReportsScreen';
import CustomerPicker from './CustomerPicker';

const INVOICE_FILTERS = ['All', 'Unpaid', 'Overdue', 'Paid', 'Draft'] as const;
const ESTIMATE_FILTERS = ['All', 'Open', 'Accepted', 'Converted', 'Declined', 'Draft'] as const;
const ESTIMATE_TYPES = ['all', 'online', 'quote', 'order', 'proforma', 'work', 'challan'] as const;
const PAGE = 25;

type DatePick = Preset | 'all';
const DATE_LABEL: Record<DatePick, () => string> = {
  all: () => t('All dates'),
  today: () => t('Today'),
  yesterday: () => t('Yesterday'),
  week: () => t('This week'),
  month: () => t('This month'),
  lastMonth: () => t('Last month'),
  fy: () => t('This year'),
  lastFy: () => t('Last year'),
  custom: () => t('Choose dates'),
};

export default function DocListScreen({ kind }: { kind: DocKind }) {
  const { actor, ledger, settings } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const paperInput = usePhotoSource((f) => void scanPaper(f));
  const [scanOn, setScanOn] = useState(false);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (kind === 'invoice' && CAN_CREATE_INVOICES) void api.features().then((f) => setScanOn(f.scanBill)).catch(() => setScanOn(false));
  }, [kind]);
  async function scanPaper(file: File) {
    setReading(true);
    try {
      const photo = await fileToResizedDataUrl(file, 1600, true);
      const { bill } = await api.scanBill(actor.businessId, photo.split(',')[1]!, 'image/jpeg', 'sale');
      const draft = await draftFromPaperBill(actor, bill, photo);
      void toast({ message: t('Bill read. Check every line before saving.'), duration: 3000, position: 'top', color: 'warning' });
      router.push(`/tabs/invoices/${draft.id}/edit`);
    } catch (e) {
      void toast({ message: e instanceof NetworkError ? t('Scanning needs the internet.') : (e as Error).message, duration: 3000, position: 'top', color: 'danger' });
    } finally {
      setReading(false);
    }
  }
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('All');
  const [estType, setEstType] = useState<(typeof ESTIMATE_TYPES)[number]>('all');
  const [datePick, setDatePick] = useState<DatePick>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [page, setPage] = useState(0);
  const [alert] = useIonAlert();
  // A new tab starts with its own filters.
  useEffect(() => {
    setFilter('All');
    setEstType('all');
    setPage(0);
  }, [kind]);
  useEffect(() => setPage(0), [q, filter, estType, datePick, custom, customer]);
  const period = datePick === 'all' ? null : presetPeriod(datePick, custom);

  function chooseDates() {
    void sheet({
      header: t('Dates'),
      buttons: [
        ...(['all', 'today', 'yesterday', 'week', 'month', 'lastMonth', 'fy', 'lastFy'] as DatePick[]).map((p) => ({ text: DATE_LABEL[p](), handler: () => setDatePick(p) })),
        {
          text: DATE_LABEL.custom(),
          handler: () =>
            void alert({
              header: t('Choose dates'),
              inputs: [
                { name: 'from', type: 'date', label: t('From'), value: custom.from || period?.from },
                { name: 'to', type: 'date', label: t('To'), value: custom.to || period?.to },
              ],
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                {
                  text: t('OK'),
                  handler: (v: { from: string; to: string }) => {
                    if (!v.from || !v.to) return;
                    setCustom(v.from <= v.to ? v : { from: v.to, to: v.from });
                    setDatePick('custom');
                  },
                },
              ],
            }),
        },
        { text: t('Cancel'), role: 'cancel' },
      ],
    });
  }

  const docs = useLiveQuery(
    async () => {
      const table = kind === 'invoice' ? db.invoices : kind === 'estimate' ? db.estimates : db.creditNotes;
      const rows = await (table as unknown as typeof db.invoices)
        .where('[businessId+date]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .reverse()
        .filter((d) => !d.deleted)
        .toArray();
      return rows as unknown as (Invoice | Estimate | CreditNote)[];
    },
    [actor.businessId, kind],
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (docs ?? []).filter((d) => {
      if (s && !(d.number.toLowerCase().includes(s) || (d.billTo?.name ?? '').toLowerCase().includes(s))) return false;
      if (period && (d.date < period.from || d.date > period.to)) return false;
      if (customer && d.billTo?.customerId !== customer.id) return false;
      if (kind === 'estimate') {
        const e = d as Estimate;
        const type = e.challan ? 'challan' : e.order ? 'order' : e.proforma ? 'proforma' : e.job ? 'work' : 'quote';
        if (estType === 'online') return !!e.online && e.status === 'draft';
        if (estType !== 'all' && type !== estType) return false;
        return filter === 'All' || estimateStatus(e).label === filter;
      }
      if (kind !== 'invoice' || filter === 'All') return true;
      const st = invoiceStatus(d as Invoice, ledger).label;
      if (filter === 'Unpaid') return st === 'Unpaid' || st === 'Partly paid' || st === 'Overdue';
      return st === filter;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, q, filter, kind, ledger, estType, period?.from, period?.to, customer]);
  const onlineNew = (docs ?? []).filter((d) => (d as Estimate).online && d.status === 'draft').length;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const totalShown = filtered.reduce((a, d) => a + (d.status === 'cancelled' ? 0 : d.totals.grandTotal), 0);

  const [kindSheet] = useIonActionSheet();
  const base = DOC_BASE[kind];
  const estTypeLabel = (f: (typeof ESTIMATE_TYPES)[number]) =>
    f === 'online' ? t('New online orders') : f === 'all' ? t('All kinds') : f === 'quote' ? t('Quotations') : f === 'order' ? t('Sales orders') : f === 'proforma' ? t('Proforma') : f === 'work' ? t('Work orders') : t('Challans');

  return (
    <PageShell title={kind === 'invoice' ? t('Invoices') : kind === 'estimate' ? t('Estimates') : t('Credit notes')} padded={false}>
      <IonSegment value={kind} onIonChange={(e) => router.push(DOC_BASE[e.detail.value as DocKind], 'none', 'replace')}>
        <IonSegmentButton value="invoice">
          <IonLabel>{t('Invoices')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="estimate">
          <IonLabel>{t('Estimates')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="credit">
          <IonLabel>{t('Returns')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search number or customer')} />
      {kind !== 'credit' && (
        <div className="filter-chips">
          {(kind === 'invoice' ? INVOICE_FILTERS : ESTIMATE_FILTERS).map((f) => (
            <IonChip key={f} outline={filter !== f} color={filter === f ? 'primary' : undefined} onClick={() => setFilter(f)}>
              {/* i18n: labels above are translated where rendered */}
              {t(f)}
            </IonChip>
          ))}
        </div>
      )}
      <div className="filter-chips">
        {kind === 'estimate' && onlineNew > 0 && (
          <IonChip color={estType === 'online' ? 'primary' : 'success'} outline={estType !== 'online'} onClick={() => setEstType(estType === 'online' ? 'all' : 'online')}>
            {t('New online orders')} ({onlineNew})
          </IonChip>
        )}
        {kind === 'estimate' && (
          <IonChip
            outline={estType === 'all'}
            color={estType !== 'all' ? 'primary' : undefined}
            onClick={() =>
              void kindSheet({
                header: t('Kind'),
                buttons: [
                  ...ESTIMATE_TYPES.filter((f) => f !== 'online' && (extraOn(settings, 'orders') || !['order', 'challan', 'proforma'].includes(f)) && (extraOn(settings, 'jobs') || f !== 'work')).map((f) => ({ text: estTypeLabel(f), handler: () => setEstType(f) })),
                  { text: t('Cancel'), role: 'cancel' },
                ],
              })
            }
          >
            <IonIcon icon={layersOutline} />
            <IonLabel>{estTypeLabel(estType)}</IonLabel>
            <IonIcon icon={chevronDownOutline} />
          </IonChip>
        )}
        <IonChip outline={datePick === 'all'} color={datePick !== 'all' ? 'primary' : undefined} onClick={chooseDates}>
          <IonIcon icon={calendarOutline} />
          <IonLabel>{datePick === 'custom' ? `${dateIN(custom.from)} – ${dateIN(custom.to)}` : DATE_LABEL[datePick]()}</IonLabel>
          {datePick !== 'all' && (
            <IonIcon
              icon={closeCircle}
              onClick={(e) => {
                e.stopPropagation();
                setDatePick('all');
              }}
            />
          )}
        </IonChip>
        <IonChip outline={!customer} color={customer ? 'primary' : undefined} onClick={() => setPicking(true)}>
          <IonIcon icon={personOutline} />
          <IonLabel>{customer ? customer.name : t('All customers')}</IonLabel>
          {customer && (
            <IonIcon
              icon={closeCircle}
              onClick={(e) => {
                e.stopPropagation();
                setCustomer(null);
              }}
            />
          )}
        </IonChip>
      </div>
      {docs && docs.length > 0 && <p className="list-summary">{t('{count} found · {amount}', { count: filtered.length, amount: rupees(totalShown) })}</p>}

      {docs && docs.length === 0 ? (
        <EmptyState
          icon={documentTextOutline}
          title={kind === 'invoice' ? t('No invoices yet') : kind === 'estimate' ? t('No estimates yet') : t('No credit notes yet')}
          text={
            kind === 'invoice'
              ? t('Tap + to create your first invoice. It works offline too.')
              : kind === 'estimate'
                ? t('Send a quotation, then convert it to an invoice in one tap.')
                : t('For a return or a price cut, open the invoice and choose More actions → Credit note.')
          }
        />
      ) : (
        <IonList>
          {shown.map((d) => {
            const pending = kind === 'invoice' ? moneyOf(d as Invoice, ledger).pending : 0;
            return (
              <IonItem key={d.id} routerLink={`${base}/${d.id}`} detail={false}>
                <IonLabel>
                  <h2>{d.billTo?.name ?? t('No customer')}</h2>
                  <p>
                    {d.number || t('Draft')} · {dateIN(d.date)}
                  </p>
                </IonLabel>
                <div slot="end" className="list-end">
                  <strong>{rupees(d.totals.grandTotal)}</strong>
                  {kind === 'invoice' ? (
                    <StatusBadge invoice={d as Invoice} />
                  ) : kind === 'estimate' ? (
                    <StatusBadge estimate={d as Estimate} />
                  ) : (
                    <StatusBadge creditNote={d as CreditNote} />
                  )}
                  {pending > 0 && pending < d.totals.grandTotal && <small className="text-danger">{t('{amount} due', { amount: rupees(pending) })}</small>}
                </div>
              </IonItem>
            );
          })}
        </IonList>
      )}
      {pages > 1 && (
        <div className="pager">
          <IonButton fill="outline" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t('Previous')}
          </IonButton>
          <span>{t('Page {n} of {total}', { n: page + 1, total: pages })}</span>
          <IonButton fill="outline" size="small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            {t('Next')}
          </IonButton>
        </div>
      )}
      <CustomerPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        onPick={(_party, c) => {
          setCustomer(c ? { id: c.id, name: c.name } : null);
          setPicking(false);
        }}
      />

      {kind === 'invoice' && scanOn && (
        <div className="ion-padding-horizontal">
          {paperInput.inputs}
          <IonChip onClick={() => !reading && paperInput.open()}>
            <IonLabel>{reading ? t('Reading the bill…') : t('Scan a paper bill')}</IonLabel>
          </IonChip>
        </div>
      )}
      {(kind === 'estimate' || (kind === 'invoice' && CAN_CREATE_INVOICES)) && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton
            aria-label={kind === 'invoice' ? t('New invoice') : t('New estimate')}
            onClick={() =>
              CAN_CREATE_INVOICES
                ? void sheet({
                    header: t('New'),
                    buttons: [
                      { text: t('Invoice'), handler: () => router.push('/tabs/invoices/new') },
                      { text: t('Counter sale'), handler: () => router.push('/tabs/sale') },
                      { text: t('Estimate / quotation'), handler: () => router.push('/tabs/estimates/new') },
                      { text: t('Sales order'), handler: () => router.push('/tabs/estimates/new?order=1') },
                      { text: t('Order from a WhatsApp message'), handler: () => router.push('/tabs/message-order') },
                      { text: t('Proforma invoice'), handler: () => router.push('/tabs/estimates/new?proforma=1') },
                      { text: t('Work order'), handler: () => router.push('/tabs/estimates/new?work=1') },
                      { text: t('Delivery challan'), handler: () => router.push('/tabs/estimates/new?challan=1') },
                      { text: t('Goods on sale or return'), handler: () => router.push('/tabs/estimates/new?challan=1&consign=1') },
                      { text: t('Cancel'), role: 'cancel' },
                    ],
                  })
                : router.push(`${base}/new`)
            }
          >
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}
    </PageShell>
  );
}
