import { IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, IonSegment, IonSegmentButton, useIonRouter } from '@ionic/react';
import { useIonToast } from '@ionic/react';
import { useEffect, useRef, useState } from 'react';
import { NetworkError, api } from '../../lib/api';
import { fileToResizedDataUrl } from '../../lib/format';
import { draftFromPaperBill } from '../../lib/paperBill';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, documentTextOutline } from 'ionicons/icons';
import { useMemo } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import StatusBadge, { invoiceStatus } from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db, type CreditNote, type Estimate, type Invoice } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { moneyOf } from '../../lib/ledger';
import type { DocKind } from '../../lib/repo';
import { DOC_BASE } from './DocEditorScreen';

const INVOICE_FILTERS = ['All', 'Unpaid', 'Overdue', 'Paid', 'Draft'] as const;

export default function DocListScreen({ kind }: { kind: DocKind }) {
  const { actor, ledger } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const paperInput = useRef<HTMLInputElement>(null);
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
  const [filter, setFilter] = useState<(typeof INVOICE_FILTERS)[number]>('All');

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
      if (kind !== 'invoice' || filter === 'All') return true;
      const st = invoiceStatus(d as Invoice, ledger).label;
      if (filter === 'Unpaid') return st === 'Unpaid' || st === 'Partly paid' || st === 'Overdue';
      return st === filter;
    });
  }, [docs, q, filter, kind, ledger]);

  const base = DOC_BASE[kind];

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
          <IonLabel>{t('Credit notes')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search number or customer')} />
      {kind === 'invoice' && (
        <div className="filter-chips">
          {INVOICE_FILTERS.map((f) => (
            <IonChip key={f} outline={filter !== f} color={filter === f ? 'primary' : undefined} onClick={() => setFilter(f)}>
              {/* i18n: labels above are translated where rendered */}
              {t(f)}
            </IonChip>
          ))}
        </div>
      )}

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
          {filtered.map((d) => {
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

      {kind === 'invoice' && scanOn && (
        <div className="ion-padding-horizontal">
          <input
            ref={paperInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void scanPaper(f);
            }}
          />
          <IonChip onClick={() => !reading && paperInput.current?.click()}>
            <IonLabel>{reading ? t('Reading the bill…') : t('Scan a paper bill')}</IonLabel>
          </IonChip>
        </div>
      )}
      {kind === 'estimate' && CAN_CREATE_INVOICES && (
        <div className="ion-padding-horizontal">
          <IonChip onClick={() => router.push(`${base}/new?challan=1`)}>
            <IonLabel>{t('New delivery challan')}</IonLabel>
          </IonChip>
        </div>
      )}
      {(kind === 'estimate' || (kind === 'invoice' && CAN_CREATE_INVOICES)) && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton routerLink={`${base}/new`} aria-label={kind === 'invoice' ? t('New invoice') : t('New estimate')}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}
    </PageShell>
  );
}
