import { IonButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonSearchbar, IonSegment, IonSegmentButton, IonSpinner, useIonToast, IonChip, IonRouterLink } from '@ionic/react';
import { financialYearLabel, formatPaise, todayISO } from '@invoice/shared';
import { documentOutline, gridOutline } from 'ionicons/icons';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SelectField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import CustomerPicker from '../docs/CustomerPicker';
import ItemPicker from '../../components/ItemPicker';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { shareTable, type CellValue, type ExportTable } from '../../lib/exportTable';
import { t } from '../../lib/i18n';
import { extraOn } from '../../lib/shopExtras';
import { REPORTS, type ReportInfo, type Period } from '../../lib/reports';
import { useSession } from '../../lib/session';
import { sync } from '../../lib/sync';

const GROUPS: { id: ReportInfo['group']; title: () => string }[] = [
  { id: 'sales', title: () => t('Sales') },
  { id: 'stock', title: () => t('Stock') },
  { id: 'gst', title: () => t('GST') },
  { id: 'money', title: () => t('Money') },
  { id: 'people', title: () => t('Staff and stores') },
];

/** Reports this person may open. */
function useAllowed() {
  const { isOwner, perms, settings } = useBusiness();
  // The accountant (view-only login) sees the owner's reports too.
  return (r: ReportInfo) => perms.viewReports && (!r.ownerOnly || isOwner || perms.access === 'readonly') && (!r.cost || perms.seeCost) && (!r.extra || extraOn(settings, r.extra));
}

/** Shown as tiles at the top: the reports a shop opens most. */
const MOST_USED = ['sales', 'collections', 'receivables', 'stock', 'pnl', 'gstr3b'] as const;

export function ReportsScreen() {
  const allowed = useAllowed();
  const { isOwner, actor, perms } = useBusiness();
  const mine = useLiveQuery(() => db.savedReports.where('businessId').equals(actor.businessId).filter((r) => !r.deleted).toArray(), [actor.businessId]);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const match = (title: string) => !needle || title.toLowerCase().includes(needle);
  const top = MOST_USED.map((id) => REPORTS.find((r) => r.id === id)).filter((r): r is ReportInfo => !!r && allowed(r));
  return (
    <PageShell title={t('Reports')} backHref="/tabs/more" padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search reports')} />
      {!needle && top.length > 0 && (
        <div className="report-tiles">
          {top.map((r) => (
            <IonRouterLink key={r.id} routerLink={`/tabs/reports/${r.id}`} className="report-tile">
              {r.title()}
            </IonRouterLink>
          ))}
        </div>
      )}
      {isOwner && !needle && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('My reports')}</IonLabel>
            <IonButton routerLink="/tabs/reports/custom/new">{t('New report')}</IonButton>
          </IonListHeader>
          {(mine ?? []).map((r) => (
            <IonItem key={r.id} routerLink={`/tabs/reports/custom/${r.id}`} detail>
              <IonLabel>{r.name}</IonLabel>
            </IonItem>
          ))}
        </IonList>
      )}
      {GROUPS.map((g) => {
        const list = REPORTS.filter((r) => r.group === g.id && allowed(r) && match(r.title()));
        if (!list.length) return null;
        return (
          <IonList inset key={g.id}>
            <IonListHeader>
              <IonLabel>{g.title()}</IonLabel>
            </IonListHeader>
            {list.map((r) => (
              <IonItem key={r.id} routerLink={`/tabs/reports/${r.id}`} detail>
                <IonLabel>{r.title()}</IonLabel>
              </IonItem>
            ))}
            {g.id === 'gst' && (isOwner || perms.access === 'readonly') && match('GSTR-1') && (
              <IonItem routerLink="/tabs/reports/gstr1" detail>
                <IonLabel>{t('GSTR-1 (JSON for the GST portal)')}</IonLabel>
              </IonItem>
            )}
            {g.id === 'gst' && (isOwner || perms.access === 'readonly') && match('GSTR-2B') && (
              <IonItem routerLink="/tabs/reports/gstr2b" detail>
                <IonLabel>{t('GSTR-2B match (purchase bills vs the portal)')}</IonLabel>
              </IonItem>
            )}
            {g.id === 'gst' && (isOwner || perms.access === 'readonly') && (
              <IonItem routerLink="/tabs/reports/tally" detail>
                <IonLabel>{t('Export for Tally')}</IonLabel>
              </IonItem>
            )}
          </IonList>
        );
      })}
    </PageShell>
  );
}

export type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'fy' | 'lastFy' | 'custom';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function presetPeriod(p: Preset, custom: Period): Period {
  const now = new Date();
  const today = todayISO();
  if (p === 'today') return { from: today, to: today };
  if (p === 'yesterday') {
    const y = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    return { from: y, to: y };
  }
  if (p === 'week') {
    const day = (now.getDay() + 6) % 7; // Monday first
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)), to: today };
  }
  if (p === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (p === 'lastMonth') return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (p === 'fy') {
    const startYear = 2000 + Number(financialYearLabel(today).slice(0, 2));
    return { from: `${startYear}-04-01`, to: today };
  }
  if (p === 'lastFy') {
    const startYear = 2000 + Number(financialYearLabel(today).slice(0, 2)) - 1;
    return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
  }
  return custom;
}

function cell(v: CellValue, kind?: string) {
  if (v == null || v === '') return '';
  if (kind === 'money' && typeof v === 'number') return formatPaise(v);
  if (kind === 'date' && typeof v === 'string') return v.split('-').reverse().join('/');
  return String(v);
}

export function ReportScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const { me } = useSession();
  const [toast] = useIonToast();
  const allowed = useAllowed();
  const info = REPORTS.find((r) => r.id === id);
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState<Period>({ from: todayISO(), to: todayISO() });
  const [staffId, setStaffId] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [item, setItem] = useState<{ id: string; name: string } | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [picking, setPicking] = useState<'customer' | 'item' | null>(null);
  const categories = useLiveQuery(() => db.categories.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).sortBy('name'), [actor.businessId]);
  const [table, setTable] = useState<ExportTable | null>(null);
  const [busy, setBusy] = useState(false);
  const period = useMemo(() => presetPeriod(preset, custom), [preset, custom]);
  const stores = useMemo(() => (me?.memberships ?? []).filter((m) => m.role === 'owner').map((m) => ({ id: m.businessId, name: m.businessName })), [me]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // People who made bills in this store, for the staff filter.
    void db.invoices
      .where('businessId')
      .equals(actor.businessId)
      .toArray()
      .then((list) => {
        const m = new Map<string, string>();
        for (const i of list) if (i.createdBy && !m.has(i.createdBy)) m.set(i.createdBy, i.history?.[0]?.byName ?? i.createdBy.slice(0, 6));
        setPeople([...m.entries()].map(([pid, name]) => ({ id: pid, name })));
      });
  }, [actor.businessId]);

  useEffect(() => {
    if (!info || !allowed(info)) return;
    let live = true;
    setBusy(true);
    void info
      .run({ businessId: actor.businessId, ...period, staffId: isOwner ? staffId || null : null, stores, customerId: customer?.id ?? null, itemId: item?.id ?? null, categoryId: categoryId || null })
      .then((tbl) => live && setTable(tbl))
      .catch((e) => toast({ message: (e as Error).message, duration: 2500, color: 'danger' }))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, period, staffId, actor.businessId, stores, customer, item, categoryId]);

  if (!info || !allowed(info)) return null;
  const share = (as: 'pdf' | 'excel') => table && void shareTable(actor.businessId, table, as).catch((e) => toast({ message: (e as Error).message, duration: 2500, color: 'danger' }));
  const staffFilter = isOwner && (info.id === 'sales' || info.id === 'items' || info.id === 'categories') && people.length > 1;

  return (
    <PageShell title={info.title()} backHref="/tabs/reports">
      {info.period && (
        <>
          <IonSegment scrollable value={preset} onIonChange={(e) => setPreset(e.detail.value as Preset)}>
            {(
              [
                ['today', t('Today')],
                ['yesterday', t('Yesterday')],
                ['week', t('This week')],
                ['month', t('This month')],
                ['lastMonth', t('Last month')],
                ['fy', t('This year')],
                ['lastFy', t('Last year')],
                ['custom', t('Dates')],
              ] as const
            ).map(([v, label]) => (
              <IonSegmentButton key={v} value={v}>
                <IonLabel>{label}</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
          {preset === 'custom' && (
            <div className="period-row">
              <IonInput className="field" fill="outline" labelPlacement="floating" label={t('From')} type="date" value={custom.from} onIonInput={sync((e) => setCustom((c) => ({ ...c, from: String(e.detail.value || c.from) })))} />
              <IonInput className="field" fill="outline" labelPlacement="floating" label={t('To')} type="date" value={custom.to} onIonInput={sync((e) => setCustom((c) => ({ ...c, to: String(e.detail.value || c.to) })))} />
            </div>
          )}
        </>
      )}
      {staffFilter && (
        <SelectField label={t('Person')} value={staffId} options={[{ value: '', label: t('Everyone') }, ...people.map((p) => ({ value: p.id, label: p.name }))]} onChange={setStaffId} />
      )}
      {(info.filters ?? []).length > 0 && (
        <div className="filter-chips wrap">
          {info.filters!.includes('customer') && (
            <IonChip outline={!customer} color={customer ? 'primary' : undefined} onClick={() => (customer ? setCustomer(null) : setPicking('customer'))}>
              {customer ? `${customer.name} ✕` : t('All customers')}
            </IonChip>
          )}
          {info.filters!.includes('item') && (
            <IonChip outline={!item} color={item ? 'primary' : undefined} onClick={() => (item ? setItem(null) : setPicking('item'))}>
              {item ? `${item.name} ✕` : t('All items')}
            </IonChip>
          )}
          {info.filters!.includes('category') && (categories ?? []).length > 0 && (
            <SelectField label={t('Category')} value={categoryId} options={[{ value: '', label: t('All categories') }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} onChange={setCategoryId} />
          )}
        </div>
      )}
      <CustomerPicker
        isOpen={picking === 'customer'}
        onClose={() => setPicking(null)}
        onPick={(_p, c) => {
          setCustomer(c ? { id: c.id, name: c.name } : null);
          setPicking(null);
        }}
      />
      <ItemPicker
        isOpen={picking === 'item'}
        onClose={() => setPicking(null)}
        businessId={actor.businessId}
        onPick={(it) => {
          setItem({ id: it.id, name: it.name });
          setPicking(null);
        }}
      />
      <div className="detail-actions">
        <IonButton size="small" fill="outline" disabled={!table} onClick={() => share('pdf')}>
          <IonIcon icon={documentOutline} slot="start" /> PDF
        </IonButton>
        <IonButton size="small" fill="outline" disabled={!table} onClick={() => share('excel')}>
          <IonIcon icon={gridOutline} slot="start" /> Excel
        </IonButton>
      </div>
      {busy && !table ? (
        <div className="center-fill">
          <IonSpinner />
        </div>
      ) : table ? (
        <ReportTableView table={table} />
      ) : null}
    </PageShell>
  );
}

/** A report table as shown on screen (subtitle, table with totals, notes). */
export function ReportTableView({ table }: { table: ExportTable }) {
  return (
          <>
            {table.subtitle?.map((s) => (
              <p key={s} className="section-note">
                {s}
              </p>
            ))}
            <div className="report-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    {table.columns.map((c, i) => (
                      <th key={i} className={c.kind === 'money' || c.kind === 'qty' ? 'num' : undefined}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.length === 0 && (
                    <tr>
                      <td colSpan={table.columns.length}>{t('Nothing in this period.')}</td>
                    </tr>
                  )}
                  {table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((v, j) => (
                        <td key={j} className={table.columns[j]?.kind === 'money' || table.columns[j]?.kind === 'qty' ? 'num' : undefined}>
                          {cell(v, table.columns[j]?.kind)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {table.foot && table.rows.length > 0 && (
                  <tfoot>
                    {table.foot.map((r, i) => (
                      <tr key={i}>
                        {r.map((v, j) => (
                          <td key={j} className={table.columns[j]?.kind === 'money' || table.columns[j]?.kind === 'qty' ? 'num' : undefined}>
                            {cell(v, table.columns[j]?.kind)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>
            {table.after?.map((s) => (
              <p key={s} className="section-note">
                {s}
              </p>
            ))}
          </>
  );
}
