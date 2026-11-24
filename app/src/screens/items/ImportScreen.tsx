import { IonBadge, IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonSpinner, useIonToast } from '@ionic/react';
import { cloudDownloadOutline, documentAttachOutline } from 'ionicons/icons';
import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Customer, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { COLUMNS, MAX_IMPORT_ROWS, applyImport, buildPreview, readRows, templateCsv, type ImportKind, type ImportResult, type Preview } from '../../lib/importer';
import { sharePdf } from '../../lib/pdf';
import { sync } from '../../lib/sync';

const SHOWN = 200;

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
      <PageShell title="Import" backHref={back}>
        <p>Only the owner can import.</p>
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
    await sharePdf(`ApnaGalla-${kind}-template.csv`, { base64, blob }, `Fill this in and import it into ApnaGalla (${kind}).`);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const rows = await readRows(file);
      if (rows.length < 2) throw new Error('The file has no rows under the headings.');
      if (rows.length - 1 > MAX_IMPORT_ROWS) void toast({ message: `Only the first ${MAX_IMPORT_ROWS} rows are imported at a time.`, duration: 3000 });
      const existing = kind === 'items' ? await db.items.where('businessId').equals(actor.businessId).filter((i) => !i.deleted).toArray() : await db.customers.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).toArray();
      setPreview(kind === 'items' ? buildPreview('items', rows, existing as Item[]) : buildPreview('customers', rows, existing as Customer[]));
      setFileName(file.name);
    } catch (e) {
      void toast({ message: e instanceof Error ? e.message : 'Could not read that file', duration: 3500, color: 'danger' });
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
      void toast({ message: e instanceof Error ? e.message : 'Import failed', duration: 3000, color: 'danger' });
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
    <PageShell title={kind === 'items' ? 'Import items' : 'Import customers'} backHref={back}>
      <IonSegment value={kind} onIonChange={sync((e) => reset(e.detail.value as ImportKind))}>
        <IonSegmentButton value="items">
          <IonLabel>Items</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="customers">
          <IonLabel>Customers</IonLabel>
        </IonSegmentButton>
      </IonSegment>

      {result ? (
        <div className="ion-padding">
          <h2>Import finished</h2>
          <p>
            {result.added} added · {result.updated} updated · {result.skipped} skipped{result.failed ? ` · ${result.failed} not imported (problems)` : ''}
          </p>
          <div className="detail-actions">
            <IonButton routerLink={back}>Open {kind}</IonButton>
            <IonButton fill="outline" onClick={() => reset()}>
              Import another file
            </IonButton>
          </div>
        </div>
      ) : (
        <>
          <p className="section-note">
            Use an Excel (.xlsx) or CSV file with a heading row. Columns can be in any order:{' '}
            {COLUMNS[kind].map((c) => (c.required ? `${c.label}*` : c.label)).join(', ')}.
          </p>
          <div className="detail-actions">
            <IonButton fill="outline" onClick={() => void downloadTemplate()}>
              <IonIcon icon={cloudDownloadOutline} slot="start" /> Template
            </IonButton>
            <IonButton onClick={() => input.current?.click()} disabled={busy}>
              {busy && !preview ? <IonSpinner name="dots" /> : <IonIcon icon={documentAttachOutline} slot="start" />} Choose file
            </IonButton>
            <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>

          {preview && (
            <>
              <h3>{fileName}</h3>
              {blocked ? (
                <p className="text-danger">This file has no {preview.missing.join(' / ')} column. Rename the heading or start from the template.</p>
              ) : (
                <p>
                  <strong>{fresh}</strong> new · <strong>{matches}</strong> match existing {kind} · <strong className={bad ? 'text-danger' : undefined}>{bad}</strong> with problems (skipped)
                </p>
              )}
              {preview.ignored.length > 0 && <p className="section-note">Columns not used: {preview.ignored.join(', ')}</p>}

              {matches > 0 && !blocked && (
                <>
                  <p>When a row matches an existing {kind === 'items' ? 'item (same barcode, code or name)' : 'customer (same mobile, GSTIN or name)'}:</p>
                  <IonSegment value={onMatch ?? undefined} onIonChange={sync((e) => setOnMatch(e.detail.value as 'update' | 'skip'))}>
                    <IonSegmentButton value="update">
                      <IonLabel>Update it from the file</IonLabel>
                    </IonSegmentButton>
                    <IonSegmentButton value="skip">
                      <IonLabel>Skip it</IonLabel>
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
                {busy ? `Importing ${progress} / ${rows.length}…` : `Import ${fresh + (onMatch === 'skip' ? 0 : matches)} ${kind}`}
              </IonButton>

              <IonList>
                <IonListHeader>
                  <IonLabel>Rows{rows.length > SHOWN ? ` (first ${SHOWN} of ${rows.length})` : ''}</IonLabel>
                </IonListHeader>
                {rows.slice(0, SHOWN).map((r) => (
                  <IonItem key={r.line} lines="full">
                    <IonLabel className="ion-text-wrap">
                      <h3>
                        {r.line}. {r.name || '(no name)'}
                      </h3>
                      {r.errors.length > 0 ? (
                        <p className="text-danger">{r.errors.join(' · ')}</p>
                      ) : kind === 'items' ? (
                        <p>
                          {rupees((r.values as Partial<Item>).rate ?? 0)}
                          {(r.values as Partial<Item>).taxPct != null ? ` · GST ${(r.values as Partial<Item>).taxPct}%` : ''}
                          {r.categoryPath ? ` · ${r.categoryPath}` : ''}
                        </p>
                      ) : (
                        <p>{[(r.values as Partial<Customer>).phone, (r.values as Partial<Customer>).taxId, (r.values as Partial<Customer>).billingAddress?.city].filter(Boolean).join(' · ')}</p>
                      )}
                    </IonLabel>
                    <IonNote slot="end">
                      {r.errors.length ? (
                        <IonBadge color="danger">Problem</IonBadge>
                      ) : r.match ? (
                        <IonBadge color="warning">{onMatch === 'skip' ? 'Skip' : 'Update'}</IonBadge>
                      ) : (
                        <IonBadge color="success">New</IonBadge>
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
