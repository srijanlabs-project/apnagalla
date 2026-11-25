import { IonButton, IonInput, IonSpinner, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useEffect, useState } from 'react';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { shareFile, shareTable, type ExportTable } from '../../lib/exportTable';
import { t } from '../../lib/i18n';
import { buildGstr1 } from '../../lib/gstr1';
import { sync } from '../../lib/sync';

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Owner: the month's GSTR-1 as the GST offline tool's JSON, and a sheet to check it. */
export default function Gstr1Screen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [month, setMonth] = useState(lastMonth());
  const [data, setData] = useState<{ json: unknown; table: ExportTable; problems: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month) || month > todayISO().slice(0, 7)) return;
    setBusy(true);
    void buildGstr1(actor.businessId, month)
      .then(setData)
      .finally(() => setBusy(false));
  }, [actor.businessId, month]);

  if (!isOwner) return null;
  const json = data?.json as { b2b: unknown[]; b2cl: unknown[]; b2cs: unknown[]; cdnr: unknown[] } | undefined;
  const fail = (e: unknown) => void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });

  return (
    <PageShell title="GSTR-1" backHref="/tabs/reports">
      <IonInput className="field" fill="outline" labelPlacement="floating" label={t('Month')} type="month" value={month} onIonInput={sync((e) => setMonth(String(e.detail.value ?? month)))} />
      {busy || !data ? (
        <IonSpinner />
      ) : (
        <>
          <p>
            {t('B2B: {b2b} buyers · B2C large: {b2cl} states · B2C small: {b2cs} rows · Credit notes to registered buyers: {cdnr}', {
              b2b: json!.b2b.length,
              b2cl: json!.b2cl.length,
              b2cs: json!.b2cs.length,
              cdnr: json!.cdnr.length,
            })}
          </p>
          {data.problems.length > 0 && (
            <div className="section-note text-danger">
              {data.problems.slice(0, 10).map((p) => (
                <p key={p}>{p}</p>
              ))}
              {data.problems.length > 10 && <p>{t('…and {count} more (in the Excel).', { count: data.problems.length - 10 })}</p>}
            </div>
          )}
          <div className="detail-actions">
            <IonButton
              onClick={() =>
                void shareFile(`${data.table.fileBase}.json`, new Blob([JSON.stringify(data.json, null, 1)], { type: 'application/json' }), t('GSTR-1 for the GST offline tool')).catch(fail)
              }
            >
              {t('JSON for the GST portal')}
            </IonButton>
            <IonButton fill="outline" onClick={() => void shareTable(actor.businessId, data.table, 'excel').catch(fail)}>
              Excel
            </IonButton>
          </div>
          <p className="section-note">{t('Upload the JSON in the GST offline tool or portal (Returns → GSTR-1 → Prepare offline). Check the figures with your CA before filing.')}</p>
        </>
      )}
    </PageShell>
  );
}
