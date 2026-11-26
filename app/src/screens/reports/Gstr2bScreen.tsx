import { IonButton, IonChip, IonItem, IonLabel, IonList, IonNote, useIonToast } from '@ionic/react';
import { useRef, useState } from 'react';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { shareTable } from '../../lib/exportTable';
import { dateIN, rupees } from '../../lib/format';
import { match2b, matchLabel, matchTable, parsePortalJson, type MatchRow, type MatchState } from '../../lib/gstr2b';
import { t } from '../../lib/i18n';

const COLOR: Record<MatchState, string> = { matched: 'success', differs: 'danger', notEntered: 'warning', notIn2b: 'tertiary' };

/** Upload the GSTR-2B JSON from the GST portal and see what matches the purchase bills. */
export default function Gstr2bScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [only, setOnly] = useState<MatchState | null>(null);
  const counts = (s: MatchState) => (rows ?? []).filter((r) => r.state === s).length;
  const shown = (rows ?? []).filter((r) => !only || r.state === only);

  return (
    <PageShell title={t('GSTR-2B match')} backHref="/tabs/reports" padded={false}>
      <div className="ion-padding">
        <p className="section-note">{t('On the GST portal: Returns → GSTR-2B → Download JSON. Choose that file here; the app matches it with your purchase bills by GSTIN and bill number.')}</p>
        <div className="detail-actions">
          <IonButton onClick={() => file.current?.click()}>{t('Choose GSTR-2B file')}</IonButton>
          {rows && (
            <IonButton fill="outline" onClick={() => void shareTable(actor.businessId, matchTable(shown), 'excel')}>
              {t('Share as Excel')}
            </IonButton>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const { invoices, period } = parsePortalJson(await f.text());
              setRows(await match2b(actor.businessId, invoices, period));
            } catch {
              void toast({ message: t('That file isn’t a GSTR-2B JSON from the GST portal'), duration: 3000, color: 'danger' });
            }
          }}
        />
      </div>
      {rows && (
        <div className="filter-chips wrap ion-padding-horizontal">
          {(['differs', 'notEntered', 'notIn2b', 'matched'] as MatchState[]).map((s) => (
            <IonChip key={s} color={COLOR[s]} outline={only !== s} onClick={() => setOnly(only === s ? null : s)}>
              {matchLabel(s)} · {counts(s)}
            </IonChip>
          ))}
        </div>
      )}
      <IonList>
        {shown.map((r, i) => (
          <IonItem key={i} routerLink={r.purchase ? `/tabs/purchases/${r.purchase.id}` : undefined} detail={false}>
            <IonLabel className="ion-text-wrap">
              <h3>
                {r.supplier} · {r.number}
              </h3>
              <p>
                {dateIN(r.date)} · {r.gstin}
              </p>
              <p>
                {r.portalTax != null ? t('2B tax {amount}', { amount: rupees(r.portalTax) }) : ''}
                {r.portalTax != null && r.bookTax != null ? ' · ' : ''}
                {r.bookTax != null ? t('books {amount}', { amount: rupees(r.bookTax) }) : ''}
              </p>
            </IonLabel>
            <IonNote slot="end" color={COLOR[r.state]}>
              {matchLabel(r.state)}
            </IonNote>
          </IonItem>
        ))}
      </IonList>
    </PageShell>
  );
}
