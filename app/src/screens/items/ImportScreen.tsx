import { IonBadge, IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonSpinner, useIonToast } from '@ionic/react';
import { cloudDownloadOutline, documentAttachOutline } from 'ionicons/icons';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Customer, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { COLUMNS, MAX_IMPORT_ROWS, applyImport, buildPreview, readRows, templateCsv, type ImportKind, type ImportResult, type Preview } from '../../lib/importer';
import { sharePdf } from '../../lib/pdf';
import { sync } from '../../lib/sync';

const SHOWN = 200;

/** Renders a translated phrase, putting React nodes where its {name} placeholders are. */
function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 0 ? part : <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment>));
}

/** Owner: bring items or customers in from Excel / CSV, with a preview before anything is saved. */
export default function ImportScreen() {
  const { actor, isOwner, settings } = useBusiness();
  const [toast] = useIonToast();
  const initialKind = new URLSearchParams(useLocation().search).get('kind') === 'customers' ? 'customers' : 'items';
  const [kind, setKind] = useState<ImportKind>(initialKind);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview<Item> | Preview<Customer> | null>(null);
  const [onMatch, setOnMatch] = useState<'update' | 'skip' | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const back = kind === 'items' ? '/tabs/items' : '/tabs/customers';

  if (!isOwner) {
    return (
      <PageShell title={t('Import')} backHref={back}>
        <p>{t('Only the owner can import.')}</p>
      </PageShell>
    );
  }

  function reset(next?: ImportKind) {
    if (next) setKind(next);
    setPreview(null);
    setResult(null);
    setOnMatch(null);
    setFileName('');
    if (input.current) input.current.value = '';
  }

  async function downloadTemplate() {
    const csv = templateCsv(kind);
    const blob = new Blob([csv], { type: 'text/csv' });
    const base64 = btoa(unescape(encodeURIComponent(csv)));
    await sharePdf(`ApnaGalla-${kind}-template.csv`, { base64, blob }, kind === 'items' ? t('Fill this in and import it into ApnaGalla (items).') : t('Fill this in and import it into ApnaGalla (customers).'));
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const rows = await readRows(file);
      if (rows.length < 2) throw new Error(t('The file has no rows under the headings.'));
      if (rows.length - 1 > MAX_IMPORT_ROWS) void toast({ message: t('Only the first {count} rows are imported at a time.', { count: MAX_IMPORT_ROWS }), duration: 3000 });
      const existing = kind === 'items' ? await db.items.where('businessId').equals(actor.businessId).filter((i) => !i.deleted).toArray() : await db.customers.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).toArray();
      setPreview(kind === 'items' ? buildPreview('items', rows, existing as Item[]) : buildPreview('customers', rows, existing as Customer[]));
      setFileName(file.name);
    } catch (e) {
      void toast({ message: e instanceof Error ? e.message : t('Could not read that file'), duration: 3500, color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!preview || !onMatch) return;
    setBusy(true);
    setProgress(0);
    try {
      setResult(await applyImport(actor, preview, onMatch, { unit: settings.units[0] ?? 'pcs', taxPct: settings.defaultTaxPct }, setProgress));
    } catch (e) {
      void toast({ message: e instanceof Error ? e.message : t('Import failed'), duration: 3000, color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const rows = preview?.rows ?? [];
  const bad = rows.filter((r) => r.errors.length).length;
  const matches = rows.filter((r) => !r.errors.length && r.match).length;
  const fresh = rows.length - bad - matches;
  const blocked = !!preview?.missing.length;

  return (
    <PageShell title={kind === 'items' ? t('Import items') : t('Import customers')} backHref={back}>
      <IonSegment value={kind} onIonChange={sync((e) => reset(e.detail.value as ImportKind))}>
        <IonSegmentButton value="items">
          <IonLabel>{t('Items')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="customers">
          <IonLabel>{t('Customers')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>

      {result ? (
        <div className="ion-padding">
          <h2>{t('Import finished')}</h2>
          <p>
            {result.failed
              ? t('{added} added · {updated} updated · {skipped} skipped · {failed} not imported (problems)', { added: result.added, updated: result.updated, skipped: result.skipped, failed: result.failed })
              : t('{added} added · {updated} updated · {skipped} skipped', { added: result.added, updated: result.updated, skipped: result.skipped })}
          </p>
          <div className="detail-actions">
            <IonButton routerLink={back}>{kind === 'items' ? t('Open items') : t('Open customers')}</IonButton>
            <IonButton fill="outline" onClick={() => reset()}>
              {t('Import another file')}
            </IonButton>
          </div>
        </div>
      ) : (
        <>
          <p className="section-note">
            {t('Use an Excel (.xlsx) or CSV file with a heading row. Columns can be in any order: {columns}.', {
              columns: COLUMNS[kind].map((c) => (c.required ? `${c.label}*` : c.label)).join(', '),
            })}
          </p>
          <div className="detail-actions">
            <IonButton fill="outline" onClick={() => void downloadTemplate()}>
              <IonIcon icon={cloudDownloadOutline} slot="start" /> {t('Template')}
            </IonButton>
            <IonButton onClick={() => input.current?.click()} disabled={busy}>
              {busy && !preview ? <IonSpinner name="dots" /> : <IonIcon icon={documentAttachOutline} slot="start" />} {t('Choose file')}
            </IonButton>
            <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>

          {preview && (
            <>
              <h3>{fileName}</h3>
              {blocked ? (
                <p className="text-danger">{t('This file has no {columns} column. Rename the heading or start from the template.', { columns: preview.missing.join(' / ') })}</p>
              ) : (
                <p>
                  {rich(
                    kind === 'items'
                      ? t('{fresh} new · {matches} match existing items · {bad} with problems (skipped)')
                      : t('{fresh} new · {matches} match existing customers · {bad} with problems (skipped)'),
                    { fresh: <strong>{fresh}</strong>, matches: <strong>{matches}</strong>, bad: <strong className={bad ? 'text-danger' : undefined}>{bad}</strong> },
                  )}
                </p>
              )}
              {preview.ignored.length > 0 && <p className="section-note">{t('Columns not used: {columns}', { columns: preview.ignored.join(', ') })}</p>}

              {matches > 0 && !blocked && (
                <>
                  <p>{kind === 'items' ? t('When a row matches an existing item (same barcode, code or name):') : t('When a row matches an existing customer (same mobile, GSTIN or name):')}</p>
                  <IonSegment value={onMatch ?? undefined} onIonChange={sync((e) => setOnMatch(e.detail.value as 'update' | 'skip'))}>
                    <IonSegmentButton value="update">
                      <IonLabel>{t('Update it from the file')}</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="skip">
                      <IonLabel>{t('Skip it')}</IonLabel>
                    </IonSegmentButton>
                  </IonSegment>
                </>
              )}

              <IonButton
                expand="block"
                className="ion-margin-top"
                disabled={busy || blocked || fresh + matches === 0 || (matches > 0 && !onMatch)}
                onClick={() => void run()}
              >
                {busy
                  ? t('Importing {done} / {total}…', { done: progress, total: rows.length })
                  : kind === 'items'
                    ? t('Import {count} items', { count: fresh + (onMatch === 'skip' ? 0 : matches) })
                    : t('Import {count} customers', { count: fresh + (onMatch === 'skip' ? 0 : matches) })}
              </IonButton>

              <IonList>
                <IonListHeader>
                  <IonLabel>{rows.length > SHOWN ? t('Rows (first {shown} of {total})', { shown: SHOWN, total: rows.length }) : t('Rows')}</IonLabel>
                </IonListHeader>
                {rows.slice(0, SHOWN).map((r) => (
                  <IonItem key={r.line} lines="full">
                    <IonLabel className="ion-text-wrap">
                      <h3>
                        {r.line}. {r.name || t('(no name)')}
                      </h3>
                      {r.errors.length > 0 ? (
                        <p className="text-danger">{r.errors.join(' · ')}</p>
                      ) : kind === 'items' ? (
                        <p>
                          {rupees((r.values as Partial<Item>).rate ?? 0)}
                          {(r.values as Partial<Item>).taxPct != null ? ` · ${t('GST {taxPct}%', { taxPct: (r.values as Partial<Item>).taxPct! })}` : ''}
                          {r.categoryPath ? ` · ${r.categoryPath}` : ''}
                        </p>
                      ) : (
                        <p>{[(r.values as Partial<Customer>).phone, (r.values as Partial<Customer>).taxId, (r.values as Partial<Customer>).billingAddress?.city].filter(Boolean).join(' · ')}</p>
                      )}
                    </IonLabel>
                    <IonNote slot="end">
                      {r.errors.length ? (
                        <IonBadge color="danger">{t('Problem')}</IonBadge>
                      ) : r.match ? (
                        <IonBadge color="warning">{onMatch === 'skip' ? t('Skip') : t('Update')}</IonBadge>
                      ) : (
                        <IonBadge color="success">{t('New')}</IonBadge>
                      )}
                    </IonNote>
                  </IonItem>
                ))}
              </IonList>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
