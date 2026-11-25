import { IonButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonSegment, IonSegmentButton, IonSpinner, useIonToast } from '@ionic/react';
import { financialYearLabel, formatPaise, todayISO } from '@invoice/shared';
import { documentOutline, gridOutline } from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SelectField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { shareTable, type CellValue, type ExportTable } from '../../lib/exportTable';
import { t } from '../../lib/i18n';
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
  const { isOwner, settings } = useBusiness();
  return (r: ReportInfo) => (!r.ownerOnly || isOwner) && (!r.cost || isOwner || settings.staffSeeCost);
}

export function ReportsScreen() {
  const allowed = useAllowed();
  return (
    <PageShell title={t('Reports')} backHref="/tabs/more" padded={false}>
      {GROUPS.map((g) => {
        const list = REPORTS.filter((r) => r.group === g.id && allowed(r));
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
          </IonList>
        );
      })}
    </PageShell>
  );
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'fy' | 'custom';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetPeriod(p: Preset, custom: Period): Period {
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
      .run({ businessId: actor.businessId, ...period, staffId: isOwner ? staffId || null : null, stores })
      .then((tbl) => live && setTable(tbl))
      .catch((e) => toast({ message: (e as Error).message, duration: 2500, color: 'danger' }))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, period, staffId, actor.businessId, stores]);

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
      ) : null}
    </PageShell>
  );
}
