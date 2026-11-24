import { IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, IonSegment, IonSegmentButton, useIonRouter } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, documentTextOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import StatusBadge, { invoiceStatus } from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db, type CreditNote, type Estimate, type Invoice } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { pendingAmount, type DocKind } from '../../lib/repo';
import { DOC_BASE } from './DocEditorScreen';

const INVOICE_FILTERS = ['All', 'Unpaid', 'Overdue', 'Paid', 'Draft'] as const;

export default function DocListScreen({ kind }: { kind: DocKind }) {
  const { actor } = useBusiness();
  const router = useIonRouter();
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
      const st = invoiceStatus(d as Invoice).label;
      if (filter === 'Unpaid') return st === 'Unpaid' || st === 'Partly paid' || st === 'Overdue';
      return st === filter;
    });
  }, [docs, q, filter, kind]);

  const base = DOC_BASE[kind];

  return (
    <PageShell title={kind === 'invoice' ? 'Invoices' : kind === 'estimate' ? 'Estimates' : 'Credit notes'} padded={false}>
      <IonSegment value={kind} onIonChange={(e) => router.push(DOC_BASE[e.detail.value as DocKind], 'none', 'replace')}>
        <IonSegmentButton value="invoice">
          <IonLabel>Invoices</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="estimate">
          <IonLabel>Estimates</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="credit">
          <IonLabel>Credit notes</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder="Search number or customer" />
      {kind === 'invoice' && (
        <div className="filter-chips">
          {INVOICE_FILTERS.map((f) => (
            <IonChip key={f} outline={filter !== f} color={filter === f ? 'primary' : undefined} onClick={() => setFilter(f)}>
              {f}
            </IonChip>
          ))}
        </div>
      )}

      {docs && docs.length === 0 ? (
        <EmptyState
          icon={documentTextOutline}
          title={kind === 'invoice' ? 'No invoices yet' : kind === 'estimate' ? 'No estimates yet' : 'No credit notes yet'}
          text={
            kind === 'invoice'
              ? 'Tap + to create your first invoice. It works offline too.'
              : kind === 'estimate'
                ? 'Send a quotation, then convert it to an invoice in one tap.'
                : 'For a return or a price cut, open the invoice and choose More actions → Credit note.'
          }
        />
      ) : (
        <IonList>
          {filtered.map((d) => {
            const pending = kind === 'invoice' ? pendingAmount(d as Invoice) : 0;
            return (
              <IonItem key={d.id} routerLink={`${base}/${d.id}`} detail={false}>
                <IonLabel>
                  <h2>{d.billTo?.name ?? 'No customer'}</h2>
                  <p>
                    {d.number || 'Draft'} · {dateIN(d.date)}
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
                  {pending > 0 && pending < d.totals.grandTotal && <small className="text-danger">{rupees(pending)} due</small>}
                </div>
              </IonItem>
            );
          })}
        </IonList>
      )}

      {(kind === 'estimate' || (kind === 'invoice' && CAN_CREATE_INVOICES)) && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton routerLink={`${base}/new`} aria-label={kind === 'invoice' ? 'New invoice' : 'New estimate'}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}
    </PageShell>
  );
}
