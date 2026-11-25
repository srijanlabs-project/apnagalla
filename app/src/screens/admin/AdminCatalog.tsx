import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonSearchbar, IonSegment, IonSegmentButton, IonTitle, IonToolbar, useIonToast } from '@ionic/react';
import { CATALOG_SECTIONS, catalogName, type CatalogRowInput, type CatalogSection, type CatalogSectionStat } from '@invoice/shared';
import { useEffect, useRef, useState } from 'react';
import { ToggleRow } from '../../components/Fields';
import { api } from '../../lib/api';
import { shareTable, type ExportTable } from '../../lib/exportTable';
import { readRows, type Cell } from '../../lib/importer';
import { sync } from '../../lib/sync';
import { t } from '../../lib/i18n';

/** Sheets of the review workbook (docs/product-list-review.xlsx) for each list. */
const SHEET_NAMES: Record<CatalogSection, string[]> = { kirana: ['Kirana'], hardware: ['Hardware & electrical', 'Hardware'], garments: ['Garments'] };

/** Sheet columns, in order (the same for upload and download). */
export const CATALOG_COLUMNS = ['Category', 'Item', 'Brand', 'Size', 'Size unit', 'Sell unit', 'HSN', 'GST %', 'Other names', 'Notes'];

const str = (c: Cell | undefined) => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();
const num = (c: Cell | undefined) => {
  const s = str(c).replace(/%$/, '');
  return s === '' ? null : Number(s);
};

/** Reads an uploaded sheet: rows to send, and problems by row number. */
export function parseCatalogSheet(rows: Cell[][]): { rows: CatalogRowInput[]; problems: string[] } {
  const head = (rows[0] ?? []).map((c) => str(c).toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const missing = CATALOG_COLUMNS.slice(0, 8).filter((c) => col(c) < 0);
  if (missing.length) return { rows: [], problems: [`Missing columns: ${missing.join(', ')}`] };
  const out: CatalogRowInput[] = [];
  const problems: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (name: string) => r[col(name)];
    const item = str(get('Item'));
    if (!item) return;
    const size = num(get('Size'));
    const gst = num(get('GST %'));
    const hsn = str(get('HSN')).replace(/\s/g, '');
    const bad: string[] = [];
    if (!str(get('Category'))) bad.push('no category');
    if (!str(get('Sell unit'))) bad.push('no sell unit');
    if (size != null && !(size > 0)) bad.push('bad size');
    if (gst != null && ![0, 3, 5, 18, 28, 40].includes(gst) && !(gst >= 0 && gst <= 40)) bad.push('bad GST %');
    if (hsn && !/^\d{4,8}$/.test(hsn)) bad.push('HSN must be 4–8 digits');
    if (bad.length) {
      problems.push(`Row ${line} (${item}): ${bad.join(', ')}`);
      return;
    }
    const others = col('Other names') >= 0 ? str(get('Other names')) : '';
    out.push({
      category: str(get('Category')),
      item,
      brand: str(get('Brand')) || null,
      size,
      sizeUnit: size ? str(get('Size unit')) || null : null,
      sellUnit: str(get('Sell unit')),
      hsn: hsn || null,
      gstPct: gst,
      otherNames: others ? others.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [],
      notes: col('Notes') >= 0 ? str(get('Notes')) || null : null,
    });
  });
  return { rows: out, problems };
}

type Listed = Awaited<ReturnType<typeof api.adminCatalogList>>['rows'][number];

/** ApnaGalla team: the shared product list by section — search, upload a sheet, download it. */
export default function AdminCatalog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [toast] = useIonToast();
  const [section, setSection] = useState<CatalogSection>('kirana');
  const [stats, setStats] = useState<CatalogSectionStat[]>([]);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Listed[]>([]);
  const [replace, setReplace] = useState(false);
  const [pending, setPending] = useState<{ rows: CatalogRowInput[]; problems: string[]; file: string } | null>(null);
  const [aliasPending, setAliasPending] = useState<{ word: string; means: string }[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const aliasFile = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) => void toast({ message: (e as Error).message, duration: 3000, color: 'danger' });
  const reload = () => {
    void api.adminCatalogStats().then((r) => setStats(r.sections)).catch(fail);
    void api.adminCatalogList(section, q).then((r) => setRows(r.rows)).catch(fail);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => (isOpen ? reload() : undefined), [isOpen, section, q]);
  const count = stats.find((s) => s.section === section)?.items ?? 0;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="wide-modal">
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Product list')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Close')}</IonButton>
          </IonButtons>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={section} onIonChange={sync((e) => setSection(e.detail.value as CatalogSection))}>
            {CATALOG_SECTIONS.map((s) => (
              <IonSegmentButton key={s} value={s}>
                <IonLabel>
                  {s} ({stats.find((x) => x.section === s)?.items ?? 0})
                </IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p className="section-note">
          {t('Upload an Excel or CSV sheet with the columns: {cols}. Other names are separated by ;. The same item + brand + size updates the row.', { cols: CATALOG_COLUMNS.join(', ') })}
        </p>
        <div className="detail-actions">
          <IonButton onClick={() => file.current?.click()}>{t('Upload sheet')}</IonButton>
          <IonButton
            fill="outline"
            onClick={async () => {
              try {
                const all = (await api.adminCatalogList(section, '', true)).rows;
                const table: ExportTable = {
                  title: `Product list ${section}`,
                  fileBase: `product-list-${section}`,
                  columns: CATALOG_COLUMNS.map((c) => ({ label: c, kind: c === 'Size' || c === 'GST %' ? ('qty' as const) : ('text' as const) })),
                  rows: all.map((r) => [r.category, r.item, r.brand ?? '', r.size, r.sizeUnit ?? '', r.sellUnit, r.hsn ?? '', r.gstPct, r.otherNames.join('; '), r.notes ?? '']),
                } as ExportTable;
                await shareTable('admin', table, 'excel');
              } catch (e) {
                fail(e);
              }
            }}
          >
            {t('Download Excel')}
          </IonButton>
          <IonButton fill="outline" onClick={() => aliasFile.current?.click()}>
            {t('Upload other spellings (Word, Means)')}
          </IonButton>
        </div>
        <input
          ref={file}
          type="file"
          accept=".xlsx,.csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              setPending({ ...parseCatalogSheet(await readRows(f, SHEET_NAMES[section])), file: f.name });
            } catch (err) {
              fail(err);
            }
          }}
        />
        <input
          ref={aliasFile}
          type="file"
          accept=".xlsx,.csv"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const all = await readRows(f, ['Other spellings']).catch((err) => (fail(err), [] as Cell[][]));
            setAliasPending(all.slice(1).map((r) => ({ word: str(r[0]), means: str(r[1]) })).filter((r) => r.word && r.means));
          }}
        />
        {pending && (
          <div className="private-notes">
            <p>
              <strong>{pending.file}</strong>: {t('{count} products ready for {section}', { count: pending.rows.length, section })}
              {pending.problems.length ? ` · ${t('{count} rows skipped', { count: pending.problems.length })}` : ''}
            </p>
            {pending.problems.slice(0, 15).map((p) => (
              <p key={p} className="text-danger">
                {p}
              </p>
            ))}
            <ToggleRow label={t('Replace the whole section (remove products not in this sheet)')} checked={replace} onChange={setReplace} note={replace ? t('Now {count} products; anything not in the sheet is removed from phones too.', { count }) : undefined} />
            <div className="detail-actions">
              <IonButton
                disabled={!pending.rows.length}
                onClick={async () => {
                  try {
                    const r = await api.adminCatalogImport({ section, rows: pending.rows, replace });
                    void toast({ message: t('Added {added}, changed {updated}, same {unchanged}, removed {removed}', { ...r }), duration: 4000, color: 'success' });
                    setPending(null);
                    reload();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                {t('Upload {count} products', { count: pending.rows.length })}
              </IonButton>
              <IonButton fill="clear" onClick={() => setPending(null)}>
                {t('Cancel')}
              </IonButton>
            </div>
          </div>
        )}
        {aliasPending && (
          <div className="private-notes">
            <p>{t('{count} other spellings ready', { count: aliasPending.length })}</p>
            <div className="detail-actions">
              <IonButton
                onClick={async () => {
                  try {
                    const r = await api.adminCatalogAliases({ rows: aliasPending, replace: false });
                    void toast({ message: t('Added {added}, changed {updated}, same {unchanged}, removed {removed}', { ...r }), duration: 4000, color: 'success' });
                    setAliasPending(null);
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                {t('Upload')}
              </IonButton>
              <IonButton fill="clear" onClick={() => setAliasPending(null)}>
                {t('Cancel')}
              </IonButton>
            </div>
          </div>
        )}
        <IonSearchbar value={q} debounce={300} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search item, brand or category')} />
        <IonList>
          <IonListHeader>
            <IonLabel>{t('{count} products', { count })}</IonLabel>
          </IonListHeader>
          {rows.map((r) => (
            <IonItem key={r.id}>
              <IonLabel>
                <h3>{catalogName(r)}</h3>
                <p>
                  {r.category} · {r.sellUnit} · HSN {r.hsn ?? '—'} · GST {r.gstPct ?? '—'}%{r.otherNames.length ? ` · ${r.otherNames.slice(0, 4).join(', ')}` : ''}
                </p>
              </IonLabel>
              {r.notes && <IonNote slot="end" color="warning">{r.notes}</IonNote>}
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonModal>
  );
}
