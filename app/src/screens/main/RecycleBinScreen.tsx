import { IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, useIonActionSheet, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { trashOutline } from 'ionicons/icons';
import { useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type SyncedTable } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { putRecord } from '../../lib/repo';

/** What can be deleted, by group. Payments and stock entries are never deleted (they are voided). */
export const BIN_TABLES: { table: SyncedTable; group: 'bills' | 'people' | 'items' | 'money'; label: () => string }[] = [
  { table: 'invoices', group: 'bills', label: () => t('Invoice') },
  { table: 'estimates', group: 'bills', label: () => t('Estimate') },
  { table: 'creditNotes', group: 'bills', label: () => t('Credit note') },
  { table: 'purchaseOrders', group: 'bills', label: () => t('Purchase order') },
  { table: 'purchases', group: 'bills', label: () => t('Purchase bill') },
  { table: 'customers', group: 'people', label: () => t('Customer') },
  { table: 'suppliers', group: 'people', label: () => t('Supplier') },
  { table: 'employees', group: 'people', label: () => t('Staff member') },
  { table: 'items', group: 'items', label: () => t('Item') },
  { table: 'categories', group: 'items', label: () => t('Category') },
  { table: 'offers', group: 'items', label: () => t('Offer') },
  { table: 'expenses', group: 'money', label: () => t('Expense') },
  { table: 'incomes', group: 'money', label: () => t('Other income') },
  { table: 'moneyMoves', group: 'money', label: () => t('Bank / cash move') },
  { table: 'loans', group: 'money', label: () => t('Loan') },
  { table: 'loanEntries', group: 'money', label: () => t('Loan entry') },
  { table: 'recurringExpenses', group: 'money', label: () => t('Repeating expense') },
  { table: 'bankAccounts', group: 'money', label: () => t('Bank account') },
  { table: 'upiIds', group: 'money', label: () => t('UPI ID') },
];

type Row = { table: SyncedTable; kind: string; id: string; title: string; detail: string; at: string; by: string; record: Record<string, unknown> };

/** A readable name for any deleted record. */
function describe(r: Record<string, unknown>): { title: string; detail: string } {
  const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
  const party = (r.billTo as { name?: string } | undefined)?.name ?? (r.supplier as { name?: string } | undefined)?.name ?? '';
  const total = (r.totals as { grandTotal?: number } | undefined)?.grandTotal ?? (typeof r.amount === 'number' ? (r.amount as number) : undefined);
  const title = s('number') || s('name') || s('title') || s('bankName') || s('upiId') || s('supplierBillNo') || s('category') || t('Draft');
  const detail = [party, s('date') ? dateIN(s('date')) : '', total != null ? rupees(total) : ''].filter(Boolean).join(' · ');
  return { title, detail };
}

/**
 * Recycle bin: nothing in ApnaGalla is erased; "delete" only hides a record. The owner sees
 * everything hidden here and can bring it back.
 */
export default function RecycleBinScreen() {
  const { actor, isOwner } = useBusiness();
  const [group, setGroup] = useState<'bills' | 'people' | 'items' | 'money'>('bills');
  const [sheet] = useIonActionSheet();
  const [toast] = useIonToast();
  const rows = useLiveQuery(async () => {
    const out: Row[] = [];
    for (const b of BIN_TABLES.filter((x) => x.group === group)) {
      const table = db.table(b.table);
      const recs = (await table.where('businessId').equals(actor.businessId).filter((r: { deleted?: boolean }) => !!r.deleted).toArray()) as Record<string, unknown>[];
      for (const r of recs) out.push({ table: b.table, kind: b.label(), id: r.id as string, ...describe(r), at: (r.updatedAt as string) ?? '', by: (r.updatedBy as string) ?? '', record: r });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [actor.businessId, group]);

  if (!isOwner) return <PageShell title={t('Deleted')} backHref="/tabs/more">{t('Only the owner can see this.')}</PageShell>;

  return (
    <PageShell title={t('Deleted')} backHref="/tabs/more" padded={false}>
      <p className="section-note ion-padding-horizontal">{t('Nothing is erased in ApnaGalla. Deleted records stay here; tap one to bring it back.')}</p>
      <IonSegment value={group} onIonChange={(e) => setGroup(e.detail.value as typeof group)}>
        <IonSegmentButton value="bills">
          <IonLabel>{t('Bills')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="people">
          <IonLabel>{t('People')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="items">
          <IonLabel>{t('Items')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="money">
          <IonLabel>{t('Money')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      {rows && rows.length === 0 ? (
        <EmptyState icon={trashOutline} title={t('Nothing deleted')} text={t('Deleted drafts, customers, items and entries appear here.')} />
      ) : (
        <IonList>
          {(rows ?? []).map((r) => (
            <IonItem
              key={`${r.table}:${r.id}`}
              button
              detail={false}
              onClick={() =>
                void sheet({
                  header: `${r.kind} · ${r.title}`,
                  buttons: [
                    {
                      text: t('Bring back'),
                      handler: () =>
                        void putRecord(r.table, actor, { ...r.record, id: r.id, deleted: false })
                          .then(() => toast({ message: t('Brought back'), duration: 1500, position: 'top', color: 'success' }))
                          .catch((e: Error) => toast({ message: e.message, duration: 2500, color: 'danger' })),
                    },
                    { text: t('Cancel'), role: 'cancel' },
                  ],
                })
              }
            >
              <IonLabel className="ion-text-wrap">
                <h3>
                  {r.kind} · {r.title}
                </h3>
                <p>{r.detail}</p>
              </IonLabel>
              <IonNote slot="end" className="ion-text-end">
                {r.at ? dateIN(r.at.slice(0, 10)) : ''}
              </IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
    </PageShell>
  );
}
