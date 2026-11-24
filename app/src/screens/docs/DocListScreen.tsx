import { IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonSearchbar, IonSegment, IonSegmentButton, useIonRouter } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, documentTextOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import StatusBadge, { invoiceStatus } from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db, type Estimate, type Invoice } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { pendingAmount } from '../../lib/repo';

type Kind = 'invoice' | 'estimate';
const INVOICE_FILTERS = ['All', 'Unpaid', 'Overdue', 'Paid', 'Draft'] as const;

export default function DocListScreen({ kind }: { kind: Kind }) {
  const { actor } = useBusiness();
  const router = useIonRouter();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof INVOICE_FILTERS)[number]>('All');

  const docs = useLiveQuery(
    async () => {
      const table = kind === 'invoice' ? db.invoices : db.estimates;
      const rows = await (table as typeof db.invoices)
        .where('[businessId+date]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .reverse()
        .filter((d) => !d.deleted)
        .toArray();
      return rows as (Invoice | Estimate)[];
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

  const base = kind === 'invoice' ? '/tabs/invoices' : '/tabs/estimates';

  return (
    <PageShell title={kind === 'invoice' ? 'Invoices' : 'Estimates'} padded={false}>
      <IonSegment value={kind} onIonChange={(e) => router.push(e.detail.value === 'invoice' ? '/tabs/invoices' : '/tabs/estimates', 'none', 'replace')}>
        <IonSegmentButton value="invoice">
          <IonLabel>Invoices</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="estimate">
          <IonLabel>Estimates</IonLabel>
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
          title={kind === 'invoice' ? 'No invoices yet' : 'No estimates yet'}
          text={kind === 'invoice' ? 'Tap + to create your first invoice. It works offline too.' : 'Send a quotation, then convert it to an invoice in one tap.'}
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
                  {kind === 'invoice' ? <StatusBadge invoice={d as Invoice} /> : <StatusBadge estimate={d as Estimate} />}
                  {pending > 0 && pending < d.totals.grandTotal && <small className="text-danger">{rupees(pending)} due</small>}
                </div>
              </IonItem>
            );
          })}
        </IonList>
      )}

      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink={`${base}/new`} aria-label={kind === 'invoice' ? 'New invoice' : 'New estimate'}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}
