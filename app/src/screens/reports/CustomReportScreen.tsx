import { IonButton, IonCheckbox, IonIcon, IonItem, IonLabel, IonList, useIonRouter, useIonToast } from '@ionic/react';
import { REPORT_FIELDS, REPORT_PERIODS, REPORT_SOURCES, runCustomReport, todayISO, type ReportPeriod, type ReportSource, type ReportSpec } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { documentOutline, gridOutline } from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FormSection, SelectField, TextField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { flattenCategories, useCategories } from '../../lib/categories';
import { db, type SavedReport } from '../../lib/db';
import { shareTable, type ExportTable } from '../../lib/exportTable';
import { t } from '../../lib/i18n';
import { MODE_LABEL, modeLabel } from '../../lib/ledger';
import { expenseLabel } from '../../lib/purchases';
import { deleteRecord, newId, putRecord } from '../../lib/repo';
import { ReportTableView } from './ReportsScreen';

const SOURCE_TEXT: Record<ReportSource, () => string> = {
  bills: () => t('Bills'),
  billLines: () => t('Items sold'),
  payments: () => t('Money received'),
  purchases: () => t('Purchases'),
  expenses: () => t('Expenses'),
};
const PERIOD_TEXT: Record<ReportPeriod, () => string> = {
  today: () => t('Today'),
  yesterday: () => t('Yesterday'),
  week: () => t('This week'),
  month: () => t('This month'),
  lastMonth: () => t('Last month'),
  fy: () => t('This year'),
};

const blankSpec = (): ReportSpec => ({ source: 'bills', columns: ['date', 'number', 'customer', 'total'], groupBy: null, period: 'month', filters: {} });

/** Owner: build a report (what, columns, grouping, filters, period), save it, share it. */
export default function CustomReportScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const isNew = !id || id === 'new';
  const saved = useLiveQuery(() => (isNew ? undefined : db.savedReports.get(id!)), [id, isNew]);
  const [name, setName] = useState('');
  const [spec, setSpec] = useState<ReportSpec>(blankSpec());
  const [nightly, setNightly] = useState(false);
  const [editing, setEditing] = useState(isNew);
  const cats = flattenCategories(useCategories(actor.businessId));
  const people = useLiveQuery(async () => {
    const m = new Map<string, string>();
    for (const i of await db.invoices.where('businessId').equals(actor.businessId).toArray()) if (i.createdBy && !m.has(i.createdBy)) m.set(i.createdBy, i.history?.[0]?.byName ?? '');
    return [...m.entries()];
  }, [actor.businessId]);

  useEffect(() => {
    if (saved) {
      setName(saved.name);
      setSpec(saved.spec as ReportSpec);
      setNightly(!!saved.nightly);
    }
  }, [saved]);

  const result = useLiveQuery(async () => {
    const [invoices, payments, purchases, expenses, items, categories] = await Promise.all([
      db.invoices.where('businessId').equals(actor.businessId).toArray(),
      db.payments.where('businessId').equals(actor.businessId).toArray(),
      db.purchases.where('businessId').equals(actor.businessId).toArray(),
      db.expenses.where('businessId').equals(actor.businessId).toArray(),
      db.items.where('businessId').equals(actor.businessId).toArray(),
      db.categories.where('businessId').equals(actor.businessId).toArray(),
    ]);
    return runCustomReport(spec, { invoices, payments, purchases, expenses, items, categories } as never, todayISO());
  }, [spec, actor.businessId]);

  // Labels in the app's language; payment modes and expense kinds by name.
  const table = useMemo<ExportTable | null>(() => {
    if (!result) return null;
    const show = (v: string | number | null, label: string) =>
      typeof v === 'string' && label === 'Mode' && v in MODE_LABEL ? modeLabel(v as never) : typeof v === 'string' && label === 'For' ? expenseLabel(v as never) : typeof v === 'string' && label === 'Kind' ? t(v) : v;
    return {
      title: name || t('My report'),
      subtitle: [PERIOD_TEXT[spec.period]()],
      columns: result.columns.map((c) => ({ label: t(c.label), kind: c.kind })),
      rows: result.rows.map((r) => r.map((v, i) => show(v, result.columns[i]!.label))),
      foot: [result.foot.map((v, i) => (i === 0 && v === 'Total' ? t('Total') : v))],
      fileBase: name || 'Report',
    };
  }, [result, name, spec.period]);

  if (!isOwner) return null;
  const fields = REPORT_FIELDS[spec.source];
  const set = (p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p }));

  async function save() {
    const rec = await putRecord('savedReports', actor, { ...(saved ?? {}), id: saved?.id ?? newId(), name: name.trim(), spec, nightly } as SavedReport);
    setEditing(false);
    void toast({ message: t('Report saved'), duration: 1500, position: 'top', color: 'success' });
    if (isNew) router.push(`/tabs/reports/custom/${rec.id}`, 'none', 'replace');
  }

  return (
    <PageShell title={name || t('New report')} backHref="/tabs/reports">
      {editing ? (
        <FormSection>
          <TextField label={t('Report name')} required value={name} onChange={setName} />
          <SelectField
            label={t('What to list')}
            value={spec.source}
            options={REPORT_SOURCES.map((s) => ({ value: s, label: SOURCE_TEXT[s]() }))}
            onChange={(source) => set({ source, columns: REPORT_FIELDS[source].map((f) => f.key), groupBy: null, filters: {} })}
          />
          <SelectField label={t('Period')} value={spec.period} options={REPORT_PERIODS.map((p) => ({ value: p, label: PERIOD_TEXT[p]() }))} onChange={(period) => set({ period })} />
          <SelectField
            label={t('Group by')}
            value={spec.groupBy ?? ''}
            options={[
              { value: '', label: t('No grouping (list)') },
              { value: 'day', label: t('Day') },
              { value: 'month', label: t('Month') },
              ...fields.filter((f) => f.kind === 'text' && f.key !== 'number' && f.key !== 'reference' && f.key !== 'note').map((f) => ({ value: f.key, label: t(f.label) })),
            ]}
            onChange={(g) => set({ groupBy: g || null })}
          />
          {(spec.source === 'bills' || spec.source === 'billLines' || spec.source === 'payments') && (people?.length ?? 0) > 1 && (
            <SelectField
              label={t('Person')}
              value={spec.filters?.staffId ?? ''}
              options={[{ value: '', label: t('Everyone') }, ...(people ?? []).map(([pid, n]) => ({ value: pid, label: n || pid.slice(0, 6) }))]}
              onChange={(staffId) => set({ filters: { ...spec.filters, staffId: staffId || null } })}
            />
          )}
          {(spec.source === 'payments' || spec.source === 'expenses') && (
            <SelectField
              label={t('Mode')}
              value={spec.filters?.mode ?? ''}
              options={[{ value: '', label: t('All') }, ...(['cash', 'upi', 'card', 'bank', 'cheque', 'finance', 'other'] as const).map((m) => ({ value: m, label: modeLabel(m) }))]}
              onChange={(mode) => set({ filters: { ...spec.filters, mode: mode || null } })}
            />
          )}
          {spec.source === 'billLines' && cats.length > 0 && (
            <SelectField
              label={t('Category')}
              value={spec.filters?.categoryId ?? ''}
              options={[{ value: '', label: t('All') }, ...cats.map((c) => ({ value: c.cat.id, label: c.path }))]}
              onChange={(categoryId) => set({ filters: { ...spec.filters, categoryId: categoryId || null } })}
            />
          )}
          <p className="section-note">{t('Columns')}</p>
          <IonList className="flush-list">
            {fields.map((f) => (
              <IonItem key={f.key} lines="none">
                <IonCheckbox
                  slot="start"
                  checked={spec.columns.includes(f.key)}
                  onIonChange={(e) => set({ columns: e.detail.checked ? fields.filter((x) => x.key === f.key || spec.columns.includes(x.key)).map((x) => x.key) : spec.columns.filter((c) => c !== f.key) })}
                  aria-label={t(f.label)}
                />
                <IonLabel>{t(f.label)}</IonLabel>
              </IonItem>
            ))}
          </IonList>
          <ToggleRow label={t('Add to the nightly Excel')} note={t('Sent with the daily Excel backup, if it is set up.')} checked={nightly} onChange={setNightly} />
          <IonButton expand="block" disabled={!name.trim()} onClick={() => void save()}>
            {t('Save report')}
          </IonButton>
        </FormSection>
      ) : (
        <div className="detail-actions">
          <IonButton size="small" fill="outline" onClick={() => setEditing(true)}>
            {t('Change')}
          </IonButton>
          <IonButton size="small" fill="outline" disabled={!table} onClick={() => table && void shareTable(actor.businessId, table, 'pdf')}>
            <IonIcon icon={documentOutline} slot="start" /> PDF
          </IonButton>
          <IonButton size="small" fill="outline" disabled={!table} onClick={() => table && void shareTable(actor.businessId, table, 'excel')}>
            <IonIcon icon={gridOutline} slot="start" /> Excel
          </IonButton>
          {saved && (
            <IonButton size="small" fill="clear" color="danger" onClick={() => void deleteRecord('savedReports', actor, saved.id).then(() => router.push('/tabs/reports', 'back', 'replace'))}>
              {t('Delete')}
            </IonButton>
          )}
        </div>
      )}
      {table && <ReportTableView table={table} />}
    </PageShell>
  );
}
