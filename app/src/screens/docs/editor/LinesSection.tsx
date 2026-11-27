

import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';

import { addOutline, barcodeOutline } from 'ionicons/icons';

import { FormSection } from '../../../components/Fields';

import { t } from '../../../lib/i18n';
import { lineSize, rupees } from '../../../lib/format';
import { newId } from '../../../lib/repo';

import BarcodeScanner from '../../../components/BarcodeScanner';

import type { EditorCtx } from './types';

/** The items on the bill: add, scan, tap a line to change it. */
export default function LinesSection({ c }: { c: EditorCtx }) {
  const { doc, locked, noTax, credit, totals, settings, setEditing, scanning, setScanning, scanToBill } = c;
  return (
    <>
        {/* ---------- lines ---------- */}
        <FormSection title={t('Items')}>
          <IonList className="line-list">
            {doc.lines.map((l, i) => {
              const r = totals.lines[i]!;
              return (
                <IonItem key={l.id} button={!locked} detail={false} onClick={() => !locked && setEditing({ line: l, isNew: false })}>
                  <IonLabel>
                    <h2>{l.name}</h2>
                    {lineSize(l) && <p>{lineSize(l)}</p>}
                    <p>
                      {l.qty} {l.unit} × {rupees(l.rate)}
                      {l.rateIncludesTax ? ` ${t('incl.')}` : ''}
                      {r.lineDiscount ? ` − ${rupees(r.lineDiscount)}` : ''}
                      {noTax ? '' : ` · ${t('tax {pct}%', { pct: l.taxPct })}`}
                      {l.hsn && !noTax ? ` · ${t('HSN {code}', { code: l.hsn })}` : ''}
                    </p>
                  </IonLabel>
                  <IonNote slot="end" className="amount-note">
                    {rupees(r.net)}
                  </IonNote>
                </IonItem>
              );
            })}
          </IonList>
          {!locked && !credit && (
            <div className="field-row">
              <IonButton
                expand="block"
                fill="outline"
                onClick={() => setEditing({ line: { id: newId(), name: '', qty: 1, unit: settings.units[0] ?? 'pcs', rate: 0, rateIncludesTax: false, taxPct: settings.defaultTaxPct }, isNew: true })}
              >
                <IonIcon icon={addOutline} slot="start" /> {t('Add item')}
              </IonButton>
              <IonButton expand="block" fill="outline" onClick={() => setScanning(true)}>
                <IonIcon icon={barcodeOutline} slot="start" /> {t('Scan')}
              </IonButton>
            </div>
          )}
          <BarcodeScanner
            isOpen={scanning}
            continuous
            title={t('Scan items')}
            onClose={() => setScanning(false)}
            onScan={(code) => {
              void scanToBill(code);
              return true;
            }}
          />
        </FormSection>

    </>
  );
}
